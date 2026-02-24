import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";
import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    const whatsapps = await ListWhatsAppsService({ companyId });
    if (whatsapps.length === 0) return;

    const startupConcurrency = Number(process.env.WBOT_STARTUP_CONCURRENCY || 2);
    const startupStaggerMs = Number(process.env.WBOT_STARTUP_STAGGER_MS || 300);
    logger.info("Iniciando bootstrap controlado de sessões WhatsApp", {
      companyId,
      totalSessions: whatsapps.length,
      startupConcurrency,
      startupStaggerMs
    });

    let index = 0;
    const workers = Array.from({ length: startupConcurrency }).map(async () => {
      while (index < whatsapps.length) {
        const currentIndex = index++;
        const whatsapp = whatsapps[currentIndex];

        if (whatsapp.type === "instagram" || whatsapp.provider === "instagram") {
          logger.info("StartAllWhatsAppsSessions: Skipping Instagram session", {
            companyId,
            whatsappId: whatsapp.id,
            name: whatsapp.name
          });
          continue;
        }

        await StartWhatsAppSession(whatsapp, companyId);
        if (startupStaggerMs > 0) {
          await new Promise(resolve => setTimeout(resolve, startupStaggerMs));
        }
      }
    });

    await Promise.all(workers);
  } catch (e) {
    Sentry.captureException(e);
    logger.error("Erro ao inicializar sessões WhatsApp da empresa", {
      companyId,
      error: (e as Error).message
    });
  }
};
