import * as Sentry from "@sentry/node";
import makeWASocket, {
  WASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  CacheStore,
  isPnUser,
  WAMessageAddressingMode
} from "baileys";

import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import MAIN_LOGGER from "baileys/lib/Utils/logger";
import authState from "../helpers/authState";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import NodeCache from 'node-cache';

const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = "error";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

// Mapa para rastrear sessões em processo de inicialização
const initializingSessions = new Map<number, boolean>();

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      if (isLogout) {
        sessions[sessionIndex].logout();
        sessions[sessionIndex].ws.close();
      }

      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};

export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise(async (resolve, reject) => {
    try {
      (async () => {
        const io = getIO();

        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) return;

        const { id, name, provider } = whatsappUpdate;

        // Verificar se já existe uma sessão ativa ou em inicialização
        const existingSession = sessions.find(s => s.id === id);
        if (existingSession) {
          logger.info(`Sessão ${name} já existe. Retornando sessão existente.`);
          resolve(existingSession as Session);
          return;
        }

        // Verificar se já está em processo de inicialização
        if (initializingSessions.get(id)) {
          logger.warn(`Sessão ${name} já está em processo de inicialização. Aguardando...`);
          // Aguardar até 10 segundos para a inicialização completar
          let attempts = 0;
          while (initializingSessions.get(id) && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const session = sessions.find(s => s.id === id);
            if (session) {
              resolve(session as Session);
              return;
            }
            attempts++;
          }
          logger.warn(`Timeout aguardando inicialização da sessão ${name}.`);
        }

        // Marcar como em inicialização
        initializingSessions.set(id, true);

        const { version, isLatest } = await fetchLatestBaileysVersion();
        const isLegacy = provider === "stable" ? true : false;

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`isLegacy: ${isLegacy}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;
        // const store = makeInMemoryStore({
        //   logger: loggerBaileys
        // });

        const { state, saveState } = await authState(whatsapp);

        const msgRetryCounterCache = new NodeCache();
        const userDevicesCache: CacheStore = new NodeCache();

        wsocket = makeWASocket({
          logger: loggerBaileys,
          printQRInTerminal: false,
          browser: Browsers.appropriate("Desktop"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
          },
          version,
          msgRetryCounterCache,
          shouldIgnoreJid: jid => isJidBroadcast(jid),
          generateHighQualityLinkPreview: false,
          // Suporte para LIDs no Baileys v7
          markOnlineOnConnect: false,
        });

        // wsocket = makeWASocket({
        //   version,
        //   logger: loggerBaileys,
        //   printQRInTerminal: false,
        //   auth: state as AuthenticationState,
        //   generateHighQualityLinkPreview: false,
        //   shouldIgnoreJid: jid => isJidBroadcast(jid),
        //   browser: ["Chat", "Chrome", "10.15.7"],
        //   patchMessageBeforeSending: (message) => {
        //     const requiresPatch = !!(
        //       message.buttonsMessage ||
        //       // || message.templateMessage
        //       message.listMessage
        //     );
        //     if (requiresPatch) {
        //       message = {
        //         viewOnceMessage: {
        //           message: {
        //             messageContextInfo: {
        //               deviceListMetadataVersion: 2,
        //               deviceListMetadata: {},
        //             },
        //             ...message,
        //           },
        //         },
        //       };
        //     }

        //     return message;
        //   },
        // })

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const errorData = (lastDisconnect?.error as Boom)?.data;
            
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect ? `[Status: ${statusCode}]` : ""}`
            );

            // Log de estados intermediários para debug
            if (connection === "connecting") {
              logger.info(`🔄 ${name} está conectando...`);
            }

            if (connection === "close") {
              // Log detalhado do erro de desconexão
              if (lastDisconnect?.error) {
                const error = lastDisconnect.error as Boom;
                logger.info(`Socket  ${name} Connection Update close [Status: ${statusCode}]`);
                
                // Verificar se há conflito de dispositivo removido
                const hasDeviceRemoved = errorData?.content?.some?.(
                  (item: any) => item?.tag === "conflict" && item?.attrs?.type === "device_removed"
                );
                
                if (hasDeviceRemoved) {
                  logger.warn(`⚠️ Dispositivo removido detectado para ${name}. Limpando sessão completamente.`);
                  // Forçar limpeza completa quando dispositivo é removido
                  await whatsapp.update({ 
                    status: "DISCONNECTED", 
                    session: "",
                    qrcode: ""
                  });
                  await DeleteBaileysService(whatsapp.id);
                  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
                  removeWbot(id, false);
                  retriesQrCodeMap.delete(id);
                  initializingSessions.delete(id);
                  // Aguardar mais tempo antes de gerar novo QR code
                  setTimeout(
                    () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                    5000
                  );
                  return;
                }

                // Tratamento específico para erro 403 (Forbidden)
                if (statusCode === 403) {
                  logger.warn(`Erro 403 detectado para ${name}. Limpando sessão.`);
                  await whatsapp.update({ status: "PENDING", session: "" });
                  await DeleteBaileysService(whatsapp.id);
                  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
                  removeWbot(id, false);
                  initializingSessions.delete(id);
                  // Aguardar mais tempo antes de reconectar após erro 403
                  setTimeout(
                    () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                    5000
                  );
                  return;
                }

                // Tratamento para erro 401 (Connection Replaced) - dispositivo removido ou sessão duplicada
                if (statusCode === DisconnectReason.connectionReplaced || statusCode === 401) {
                  logger.warn(`⚠️ Erro 401 (Connection Replaced) detectado para ${name}. Sessão inválida - limpando completamente.`);
                  await whatsapp.update({ 
                    status: "DISCONNECTED", 
                    session: "",
                    qrcode: ""
                  });
                  await DeleteBaileysService(whatsapp.id);
                  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
                  removeWbot(id, false);
                  retriesQrCodeMap.delete(id);
                  initializingSessions.delete(id);
                  // Aguardar mais tempo antes de gerar novo QR code
                  setTimeout(
                    () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                    5000
                  );
                  return;
                }

                // Tratamento para erro 515 (Logged Out) - sessão expirada
                if (statusCode === DisconnectReason.loggedOut || statusCode === 515) {
                  logger.warn(`⚠️ Erro 515 (Logged Out) detectado para ${name}. Sessão expirada - limpando completamente.`);
                  await whatsapp.update({ 
                    status: "DISCONNECTED", 
                    session: "",
                    qrcode: ""
                  });
                  await DeleteBaileysService(whatsapp.id);
                  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
                  removeWbot(id, false);
                  retriesQrCodeMap.delete(id);
                  initializingSessions.delete(id);
                  // Aguardar mais tempo antes de gerar novo QR code
                  setTimeout(
                    () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                    5000
                  );
                  return;
                }

                // Para outros erros, tentar reconectar normalmente
                logger.info(`Reconectando ${name} após desconexão (Status: ${statusCode})`);
                removeWbot(id, false);
                initializingSessions.delete(id);
                setTimeout(
                  () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                  3000
                );
              } else {
                // Desconexão sem erro específico
                logger.info(`Desconexão normal para ${name}. Tentando reconectar.`);
                removeWbot(id, false);
                initializingSessions.delete(id);
                setTimeout(
                  () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                  3000
                );
              }
            }

            if (connection === "open") {
              logger.info(`✅ Conexão aberta para ${name}. Aguardando estabilização...`);
              
              try {
                // Salvar o estado imediatamente quando a conexão abre
                await saveState();
                logger.info(`✅ Estado da sessão salvo para ${name}.`);
                
                // Aguardar um pequeno delay para garantir que a conexão está estável
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Verificar se o socket ainda existe após o delay
                if (wsocket) {
                  // Salvar o estado novamente antes de marcar como conectado
                  await saveState();
                  
                  logger.info(`✅ Conexão estável confirmada para ${name}. Atualizando status para CONNECTED.`);
                  
                  await whatsapp.update({
                    status: "CONNECTED",
                    qrcode: "",
                    retries: 0
                  });

                  // Recarregar o whatsapp do banco para garantir que temos os dados mais recentes
                  const updatedWhatsapp = await Whatsapp.findByPk(whatsapp.id);
                  if (updatedWhatsapp) {
                    io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                      action: "update",
                      session: updatedWhatsapp
                    });
                  } else {
                    io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                      action: "update",
                      session: whatsapp
                    });
                  }

                  const sessionIndex = sessions.findIndex(
                    s => s.id === whatsapp.id
                  );
                  if (sessionIndex === -1) {
                    wsocket.id = whatsapp.id;
                    sessions.push(wsocket);
                  }

                  // Remover do mapa de inicialização
                  initializingSessions.delete(id);
                  
                  resolve(wsocket);
                } else {
                  logger.warn(`⚠️ Socket não encontrado após estabilização para ${name}.`);
                  initializingSessions.delete(id);
                }
              } catch (error) {
                logger.error(`❌ Erro ao processar conexão aberta para ${name}:`, error);
                initializingSessions.delete(id);
                // Mesmo com erro, tentar atualizar o status
                try {
                  await whatsapp.update({
                    status: "CONNECTED",
                    qrcode: "",
                    retries: 0
                  });
                  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
                  if (wsocket) {
                    const sessionIndex = sessions.findIndex(
                      s => s.id === whatsapp.id
                    );
                    if (sessionIndex === -1) {
                      wsocket.id = whatsapp.id;
                      sessions.push(wsocket);
                    }
                    initializingSessions.delete(id);
                    resolve(wsocket);
                  }
                } catch (updateError) {
                  logger.error(`❌ Erro ao atualizar status após erro:`, updateError);
                  initializingSessions.delete(id);
                }
              }
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await DeleteBaileysService(whatsappUpdate.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
                  action: "update",
                  session: whatsappUpdate
                });
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                // Log detalhado do QR code recebido do Baileys
                logger.info(`QR Code recebido do Baileys - Tipo: ${typeof qr}, Valor bruto: ${JSON.stringify(qr)}`);
                logger.info(`QR Code recebido do Baileys - Primeiros 100 caracteres: ${typeof qr === 'string' ? qr.substring(0, 100) : 'N/A'}`);
                
                // Validar e tratar o QR code antes de salvar
                const qrCodeValue = typeof qr === 'string' ? qr.trim() : String(qr || '').trim();
                
                // Verificar se o QR code contém URLs suspeitas - REJEITAR se contiver
                const hasSuspiciousURL = qrCodeValue.includes('linktr.ee') || 
                                         qrCodeValue.includes('http://') || 
                                         qrCodeValue.includes('https://') ||
                                         qrCodeValue.startsWith('http') ||
                                         qrCodeValue.match(/^https?:\/\//i);
                
                if (hasSuspiciousURL) {
                  logger.error(`⚠️ ERRO CRÍTICO: QR Code contém URL suspeita e será REJEITADO!`);
                  logger.error(`QR Code suspeito recebido: ${qrCodeValue.substring(0, 200)}`);
                  logger.error(`QR Code completo: ${qrCodeValue}`);
                  // NÃO salvar QR codes com URLs suspeitas
                  logger.error(`QR Code rejeitado - não será salvo no banco de dados.`);
                  return; // Não processar este QR code
                }
                
                // Log do valor processado
                logger.info(`QR Code processado - Tipo: ${typeof qrCodeValue}, Tamanho: ${qrCodeValue.length}, Primeiros 100 caracteres: ${qrCodeValue.substring(0, 100)}`);

                // Verificar se o QR code parece ser um código válido do WhatsApp
                // QR codes do WhatsApp geralmente começam com algo como "2@" ou são base64
                const isValidWhatsAppQR = qrCodeValue.length > 20 && 
                  (qrCodeValue.startsWith('2@') || 
                   qrCodeValue.includes('@') || 
                   /^[A-Za-z0-9+/=_-]+$/.test(qrCodeValue));
                
                if (!isValidWhatsAppQR && qrCodeValue.length > 0) {
                  logger.warn(`⚠️ QR Code pode não ser válido para WhatsApp. Formato suspeito detectado.`);
                  logger.warn(`QR Code recebido: ${qrCodeValue.substring(0, 150)}`);
                }

                await whatsapp.update({
                  qrcode: qrCodeValue,
                  status: "qrcode",
                  retries: 0
                });
                
                // Verificar o valor salvo no banco
                const whatsappAfterUpdate = await Whatsapp.findByPk(whatsapp.id);
                if (whatsappAfterUpdate) {
                  logger.info(`QR Code salvo no banco - Tamanho: ${whatsappAfterUpdate.qrcode?.length || 0}, Primeiros 100 caracteres: ${whatsappAfterUpdate.qrcode?.substring(0, 100) || 'VAZIO'}`);
                  if (whatsappAfterUpdate.qrcode !== qrCodeValue) {
                    logger.error(`⚠️ ERRO: QR Code foi modificado após salvar! Esperado: ${qrCodeValue.substring(0, 100)}, Obtido: ${whatsappAfterUpdate.qrcode?.substring(0, 100)}`);
                  }
                }
                
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
              }
            }
          }
        );
        wsocket.ev.on("creds.update", saveState);
        
        // Suporte para LID mapping no Baileys v7
        wsocket.ev.on("lid-mapping.update", (mapping) => {
          logger.info("New LID mapping received:", mapping);
          // Aqui você pode processar os novos mapeamentos LID/PN
        });

        //store.bind(wsocket.ev);
      })();
    } catch (error) {
      // Limpar o mapa de inicialização em caso de erro
      if (whatsapp?.id) {
        initializingSessions.delete(whatsapp.id);
      }
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
