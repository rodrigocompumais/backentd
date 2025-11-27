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
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect || ""
              }`
            );

            if (connection === "close") {
              if ((lastDisconnect?.error as Boom)?.output?.statusCode === 403) {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
                removeWbot(id, false);
              }
              if (
                (lastDisconnect?.error as Boom)?.output?.statusCode !==
                DisconnectReason.loggedOut
              ) {
                removeWbot(id, false);
                setTimeout(
                  () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                  2000
                );
              } else {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
                removeWbot(id, false);
                setTimeout(
                  () => StartWhatsAppSession(whatsapp, whatsapp.companyId),
                  2000
                );
              }
            }

            if (connection === "open") {
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0
              });

              io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                action: "update",
                session: whatsapp
              });

              const sessionIndex = sessions.findIndex(
                s => s.id === whatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = whatsapp.id;
                sessions.push(wsocket);
              }

              resolve(wsocket);
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
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
