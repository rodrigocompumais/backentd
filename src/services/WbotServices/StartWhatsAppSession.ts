import { initWASocket } from "../../libs/wbot";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  logger.info("StartWhatsAppSession", {
    whatsappId: whatsapp.id,
    companyId,
    name: whatsapp.name,
    provider: whatsapp.provider,
    type: whatsapp.type
  });

  // Se provider for Gupshup ou Instagram, não iniciar sessão Baileys
  if (whatsapp.provider === "gupshup" || whatsapp.type === "instagram") {
    logger.info(`Sessão ${whatsapp.name} é ${whatsapp.type || whatsapp.provider}. Não iniciando sessão Baileys.`);
    // Apenas garantir que o status está correto e inicializar Adapter se necessário
    if (whatsapp.status !== "CONNECTED") {
      await whatsapp.update({ status: "CONNECTED" });
    }
    return;
  }

  // Verificar se já existe uma sessão ativa antes de iniciar nova
  try {
    const { getWbot } = await import("../../libs/wbot");
    getWbot(whatsapp.id);
    // Se chegou aqui, a sessão já existe
    logger.info(`Sessão ${whatsapp.name} já está ativa. Não iniciando nova sessão.`);
    return;
  } catch (err) {
    // Se não existe sessão (erro ERR_WAPP_NOT_INITIALIZED), continuar com a inicialização
  }

  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
    action: "update",
    session: whatsapp
  });

  try {
    const wbot = await initWASocket(whatsapp);
    wbotMessageListener(wbot, companyId);
    wbotMonitor(wbot, whatsapp, companyId);
  } catch (err: any) {
    if (err?.message === "ERR_WAPP_LOCK_NOT_ACQUIRED") {
      logger.warn("Sessão WhatsApp em lock por outra instância/processo", {
        whatsappId: whatsapp.id,
        companyId
      });

      // Evita spinner infinito: se ninguém atualizar o status, sair de OPENING.
      setTimeout(async () => {
        const fresh = await Whatsapp.findByPk(whatsapp.id);
        if (!fresh) return;
        if (fresh.status === "OPENING") {
          await fresh.update({ status: "PENDING" });
          const io = getIO();
          io.to(`company-${fresh.companyId}-mainchannel`).emit("whatsappSession", {
            action: "update",
            session: fresh
          });
        }
      }, 8000);
      return;
    }

    Sentry.captureException(err);
    logger.error("Falha ao iniciar sessão WhatsApp", {
      whatsappId: whatsapp.id,
      companyId,
      error: (err as Error).message
    });

    // Evita tela travada em "carregando" em falhas inesperadas de inicialização.
    const fresh = await Whatsapp.findByPk(whatsapp.id);
    if (fresh && fresh.status === "OPENING") {
      await fresh.update({ status: "PENDING" });
      const io = getIO();
      io.to(`company-${fresh.companyId}-mainchannel`).emit("whatsappSession", {
        action: "update",
        session: fresh
      });
    }
  }
};
