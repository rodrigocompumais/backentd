import * as Sentry from "@sentry/node";
import makeWASocket, {
  WASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  // makeInMemoryStore,
  isJidBroadcast
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

        wsocket = makeWASocket({
          logger: loggerBaileys,
          printQRInTerminal: false,
          browser: Browsers.appropriate("Desktop"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
          },
          version,
          // defaultQueryTimeoutMs: 60000,
          // retryRequestDelayMs: 250,
          // keepAliveIntervalMs: 1000 * 60 * 10 * 3,
          msgRetryCounterCache,
          shouldIgnoreJid: jid => isJidBroadcast(jid),
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
          async (update) => {
            const { connection, lastDisconnect, qr } = update;
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            
            // LOG DETALHADO PARA DIAGNÓSTICO
            console.log("🔍 CONNECTION UPDATE:", {
              connection: connection || "undefined",
              statusCode: statusCode || "N/A",
              hasLastDisconnect: !!lastDisconnect,
              hasQr: qr !== undefined,
              qrLength: qr ? (typeof qr === 'string' ? qr.length : 'not-string') : 0,
              name: name
            });
            
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect ? `[Status: ${statusCode}]` : ""}`
            );

            // Log estados intermediários
            if (connection === "connecting") {
              console.log(`🔄 ${name} está conectando...`);
              logger.info(`🔄 ${name} está conectando...`);
            }

            if (connection === "close") {
              console.log(`❌ CONEXÃO FECHADA para ${name}:`, {
                statusCode: statusCode,
                error: lastDisconnect?.error ? String(lastDisconnect.error) : "N/A"
              });
              logger.info(`❌ CONEXÃO FECHADA para ${name} - Status: ${statusCode}`);
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
              console.log(`✅ CONEXÃO ABERTA para ${name}`);
              logger.info(`✅ CONEXÃO ABERTA para ${name}`);
              logger.info(`✅ Sessão validada e aberta para ${name}`);
              
              // AGORA SIM - salvar sessão apenas após conexão estar realmente aberta
              console.log(`💾 Tentando salvar estado para ${name}...`);
              await saveState();
              console.log(`✅ Estado da sessão salvo para ${name}`);
              logger.info(`✅ Estado da sessão salvo para ${name}`);

              console.log(`📝 Atualizando status no banco para CONNECTED...`);
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0
              });
              console.log(`✅ Status atualizado no banco para CONNECTED`);

              // Recarregar whatsapp do banco para garantir dados atualizados
              const updatedWhatsapp = await Whatsapp.findByPk(whatsapp.id);
              const sessionToEmit = updatedWhatsapp || whatsapp;
              
              console.log(`📡 Emitindo evento Socket.IO: company-${whatsapp.companyId}-whatsappSession`, {
                action: "update",
                sessionId: sessionToEmit.id,
                sessionStatus: sessionToEmit.status,
                sessionQrcode: sessionToEmit.qrcode ? "presente" : "vazio"
              });
              
              io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                action: "update",
                session: sessionToEmit
              });
              
              console.log(`✅ Evento Socket.IO emitido com sucesso`);

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
              console.log(`📱 QR CODE recebido para ${name}:`, {
                qrType: typeof qr,
                qrLength: typeof qr === 'string' ? qr.length : 'not-string',
                qrPreview: typeof qr === 'string' ? qr.substring(0, 50) : 'N/A',
                retries: retriesQrCodeMap.get(id) || 0
              });
              
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

                console.log(`📝 Atualizando QR code no banco...`);
                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
                console.log(`✅ QR code atualizado no banco`);
                
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                // Recarregar whatsapp do banco para garantir dados atualizados
                const updatedWhatsappForQr = await Whatsapp.findByPk(whatsapp.id);
                const sessionToEmitQr = updatedWhatsappForQr || whatsapp;
                
                console.log(`📡 Emitindo evento Socket.IO para QR: company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  sessionId: sessionToEmitQr.id,
                  sessionStatus: sessionToEmitQr.status,
                  hasQrcode: !!sessionToEmitQr.qrcode
                });
                
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: sessionToEmitQr
                });
                
                console.log(`✅ Evento Socket.IO para QR emitido com sucesso`);
              }
            }
          }
        );
        // REMOVIDO: wsocket.ev.on("creds.update", saveState);
        // Agora salvamos apenas quando connection === "open" para evitar salvar sessão incompleta

        //store.bind(wsocket.ev);
      })();
    } catch (error) {
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
