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
import pino from "pino";
import authState from "../helpers/authState";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import CloseTicketsByWhatsAppIdService from "../services/TicketServices/CloseTicketsByWhatsAppIdService";
import NodeCache from 'node-cache';
import { acquireSessionLock, releaseSessionLock } from "./sessionLock";
import { metricsConnectionClose, metricsReconnectAttempt, metricsReconnectSuccess } from "../utils/wbotMetrics";

const shouldSuppressBaileysErrorLog = (args: any[]): boolean => {
  if (!Array.isArray(args) || args.length === 0) return false;

  const firstArg = args[0];
  const secondArg = args[1];
  const statusCode =
    firstArg?.error?.output?.statusCode ||
    firstArg?.output?.statusCode ||
    firstArg?.statusCode;
  const payloadMessage =
    firstArg?.error?.output?.payload?.message ||
    firstArg?.output?.payload?.message;
  const msg = typeof secondArg === "string" ? secondArg : "";

  return statusCode === 428 && payloadMessage === "Connection Closed" && msg.includes("transaction failed");
};

// Usar pino diretamente ao invés de path interno do Baileys (compatível com Baileys 7.x)
const loggerBaileys = pino({
  level: "error",
  hooks: {
    logMethod(args, method) {
      // Ignora ruído transitório conhecido do Baileys para conexão já encerrada (428).
      if (shouldSuppressBaileysErrorLog(args as any[])) {
        return;
      }
      method.apply(this, args as any);
    }
  },
  transport: process.env.NODE_ENV === "development" ? {
    target: "pino-pretty",
    options: { colorize: true }
  } : undefined
});

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

// Mapa para rastrear sessões em processo de inicialização
const initializingSessions = new Map<number, boolean>();
const sessionLockHandles = new Map<number, Awaited<ReturnType<typeof acquireSessionLock>>>();
const reconnectAttemptsMap = new Map<number, number>();
const reconnectTimers = new Map<number, NodeJS.Timeout>();

const MAX_RECONNECT_DELAY_MS = Number(process.env.WBOT_RECONNECT_MAX_DELAY_MS || 60000);
const BASE_RECONNECT_DELAY_MS = Number(process.env.WBOT_RECONNECT_BASE_DELAY_MS || 2000);
const MAX_RECONNECT_ATTEMPTS_BEFORE_COOLDOWN = Number(process.env.WBOT_RECONNECT_MAX_ATTEMPTS || 10);
const RECONNECT_COOLDOWN_MS = Number(process.env.WBOT_RECONNECT_COOLDOWN_MS || 5 * 60 * 1000);
const TRANSIENT_RECONNECT_MIN_DELAY_MS = Number(process.env.WBOT_RECONNECT_TRANSIENT_MIN_DELAY_MS || 15000);
const USE_LATEST_BAILEYS_VERSION = process.env.WBOT_BAILEYS_USE_LATEST === "true";
const FIXED_BAILEYS_VERSION = process.env.WBOT_BAILEYS_VERSION || "2.3000.1033105955";

const calculateReconnectDelay = (attempt: number): number => {
  const exponentialDelay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, Math.max(attempt - 1, 0)),
    MAX_RECONNECT_DELAY_MS
  );
  const jitter = 0.6 + Math.random() * 0.8;
  return Math.floor(exponentialDelay * jitter);
};

const clearReconnectTimer = (whatsappId: number): void => {
  const timer = reconnectTimers.get(whatsappId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(whatsappId);
  }
};

const parseVersionString = (rawVersion: string): [number, number, number] => {
  const fallback: [number, number, number] = [2, 3000, 1033105955];
  const parts = rawVersion.split(".").map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => Number.isNaN(part))) {
    logger.warn("WBOT_BAILEYS_VERSION inválida, usando fallback", {
      configuredVersion: rawVersion,
      fallbackVersion: fallback.join(".")
    });
    return fallback;
  }
  return [parts[0], parts[1], parts[2]];
};

const resolveBaileysVersion = async (): Promise<{ version: [number, number, number]; isLatest: boolean }> => {
  if (USE_LATEST_BAILEYS_VERSION) {
    const latest = await fetchLatestBaileysVersion();
    return {
      version: [latest.version[0], latest.version[1], latest.version[2]],
      isLatest: latest.isLatest
    };
  }

  return {
    version: parseVersionString(FIXED_BAILEYS_VERSION),
    isLatest: false
  };
};

const isTransientDisconnectReason = (reasonCode?: string, reasonMessage?: string, statusCode?: number): boolean => {
  if (statusCode === 428) return true;

  const code = (reasonCode || "").toUpperCase();
  const message = (reasonMessage || "").toLowerCase();

  return (
    code.includes("ECONNRESET") ||
    code.includes("ECONNABORTED") ||
    code.includes("UND_ERR_SOCKET") ||
    message.includes("terminated") ||
    message.includes("connection closed")
  );
};

const getDisconnectContext = (error: any) => {
  const statusCode =
    error?.output?.statusCode ||
    error?.output?.payload?.statusCode ||
    error?.statusCode;
  const reasonCode = error?.code || error?.output?.payload?.error || error?.name;
  const reasonMessage = error?.message || error?.output?.payload?.message;

  return {
    statusCode,
    reasonCode,
    reasonMessage
  };
};

const forceTeardownSocket = async (socket: Session | null | undefined, whatsappId: number): Promise<void> => {
  if (!socket) return;

  try {
    (socket.ev as any)?.removeAllListeners?.();
  } catch (err: any) {
    logger.debug("Falha ao remover listeners do socket", {
      whatsappId,
      error: err?.message
    });
  }

  try {
    if (typeof (socket as any).end === "function") {
      (socket as any).end();
    }
  } catch (err: any) {
    logger.debug("Falha ao encerrar socket.end()", {
      whatsappId,
      error: err?.message
    });
  }

  try {
    socket.ws?.close?.();
  } catch (err: any) {
    logger.debug("Falha ao fechar websocket", {
      whatsappId,
      error: err?.message
    });
  }

  try {
    (socket.ws as any)?.terminate?.();
  } catch (err: any) {
    logger.debug("Falha ao terminar websocket", {
      whatsappId,
      error: err?.message
    });
  }
};

const scheduleReconnect = (whatsapp: Whatsapp, reason?: any): void => {
  const { id, companyId } = whatsapp;
  clearReconnectTimer(id);

  const { statusCode, reasonCode, reasonMessage } = getDisconnectContext(reason as Boom);
  const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 403;
  if (isLoggedOut || whatsapp.type === "instagram" || whatsapp.provider === "gupshup") {
    logger.warn("Reconexão automática ignorada", {
      whatsappId: id,
      companyId,
      statusCode,
      reasonCode,
      reasonMessage,
      type: whatsapp.type,
      provider: whatsapp.provider
    });
    return;
  }

  const attempts = (reconnectAttemptsMap.get(id) || 0) + 1;
  reconnectAttemptsMap.set(id, attempts);
  metricsReconnectAttempt(companyId, id);

  let delay = calculateReconnectDelay(attempts);
  if (isTransientDisconnectReason(reasonCode, reasonMessage, statusCode)) {
    delay = Math.max(delay, TRANSIENT_RECONNECT_MIN_DELAY_MS);
  }
  if (attempts > MAX_RECONNECT_ATTEMPTS_BEFORE_COOLDOWN) {
    delay = Math.max(delay, RECONNECT_COOLDOWN_MS);
  }

  logger.warn("Agendando reconexão da sessão WhatsApp", {
    whatsappId: id,
    companyId,
    attempts,
    delay,
    statusCode,
    reasonCode,
    reasonMessage
  });

  const timer = setTimeout(() => {
    reconnectTimers.delete(id);
    if (!initializingSessions.get(id)) {
      StartWhatsAppSession(whatsapp, companyId);
    }
  }, delay);
  reconnectTimers.set(id, timer);
};

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
    clearReconnectTimer(whatsappId);
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      const session = sessions[sessionIndex];
      if (isLogout) {
        try {
          session.logout();
        } catch (logoutErr: any) {
          // Erros de "Connection Closed" são esperados quando a conexão já está fechada
          if (logoutErr?.message === "Connection Closed" || 
              logoutErr?.output?.payload?.message === "Connection Closed" ||
              logoutErr?.output?.statusCode === 428) {
            logger.debug(`Conexão WhatsApp ${whatsappId} já estava fechada ao tentar logout`);
          } else {
            logger.warn(`Erro ao fazer logout da sessão ${whatsappId}:`, logoutErr);
          }
        }
      }

      await forceTeardownSocket(session, whatsappId);
      sessions.splice(sessionIndex, 1);
    }
    const lockHandle = sessionLockHandles.get(whatsappId) || null;
    await releaseSessionLock(lockHandle);
    sessionLockHandles.delete(whatsappId);
  } catch (err: any) {
    // Verificar se é erro de conexão fechada (esperado)
    if (err?.message === "Connection Closed" || 
        err?.output?.payload?.message === "Connection Closed" ||
        err?.output?.statusCode === 428) {
      logger.debug(`Erro esperado ao remover sessão ${whatsappId}: conexão já fechada`);
    } else {
      logger.error(`Erro ao remover sessão ${whatsappId}:`, err);
    }
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

        if (!whatsappUpdate) {
          initializingSessions.delete(whatsapp.id);
          reject(new AppError("ERR_WAPP_NOT_FOUND", 404));
          return;
        }

        const { id, name } = whatsappUpdate;

        // Verificar se já existe uma sessão ativa
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

        const lockHandle = await acquireSessionLock(id);
        if (!lockHandle) {
          initializingSessions.delete(id);
          logger.warn("Sessão já está sendo gerenciada por outra instância", {
            whatsappId: id,
            companyId: whatsapp.companyId
          });
          reject(new AppError("ERR_WAPP_LOCK_NOT_ACQUIRED", 423));
          return;
        }
        sessionLockHandles.set(id, lockHandle);

        const { version, isLatest } = await resolveBaileysVersion();

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
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
          async ({ connection, lastDisconnect, qr }) => {
            const disconnectCtx = getDisconnectContext(lastDisconnect?.error);
            logger.info("Socket Connection Update", {
              whatsappName: name,
              whatsappId: id,
              companyId: whatsapp.companyId,
              connection: connection || "",
              disconnectStatusCode: disconnectCtx.statusCode,
              disconnectReasonCode: disconnectCtx.reasonCode,
              disconnectReasonMessage: disconnectCtx.reasonMessage
            });

            if (connection === "close") {
              metricsConnectionClose(
                whatsapp.companyId,
                id,
                disconnectCtx.statusCode,
                disconnectCtx.reasonCode
              );

              // Limpar flag de inicialização
              initializingSessions.delete(id);
              await releaseSessionLock(sessionLockHandles.get(id) || null);
              sessionLockHandles.delete(id);
              
              const disconnectStatusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
              const isForbidden = disconnectStatusCode === 403;
              const isLoggedOut = disconnectStatusCode === DisconnectReason.loggedOut;

              if (isForbidden || isLoggedOut) {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
                await removeWbot(id, false);
                return;
              }

              await removeWbot(id, false);
              scheduleReconnect(whatsapp, lastDisconnect?.error);
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

              // Remover do mapa de inicialização
              initializingSessions.delete(id);
              reconnectAttemptsMap.delete(id);
              clearReconnectTimer(id);
              metricsReconnectSuccess(whatsapp.companyId, whatsapp.id);
              
              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await CloseTicketsByWhatsAppIdService(whatsappUpdate.id);
                await DeleteBaileysService(whatsappUpdate.id);
                io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
                  action: "update",
                  session: whatsappUpdate
                });
                wsocket.ev.removeAllListeners("connection.update");
                await forceTeardownSocket(wsocket, id);
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
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

        //store.bind(wsocket.ev);
      })();
    } catch (error) {
      // Limpar flag de inicialização em caso de erro
      if (whatsapp?.id) {
        initializingSessions.delete(whatsapp.id);
        clearReconnectTimer(whatsapp.id);

        const lockHandle = sessionLockHandles.get(whatsapp.id) || null;
        await releaseSessionLock(lockHandle);
        sessionLockHandles.delete(whatsapp.id);
      }

      if ((error as Error)?.message !== "ERR_WAPP_LOCK_NOT_ACQUIRED") {
        Sentry.captureException(error);
        scheduleReconnect(whatsapp, error);
      }

      reject(error);
    }
  });
};
