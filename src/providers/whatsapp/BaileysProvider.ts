import { WAMessage, MiscMessageGenerationOptions } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetWhatsappWbot from "../../helpers/GetWhatsappWbot";
import Whatsapp from "../../models/Whatsapp";
import {
  IWhatsAppProvider,
  SendMessageOptions,
  SendMediaOptions
} from "./IWhatsAppProvider";
import fs from "fs";
import { getMessageOptions } from "../../services/WbotServices/SendWhatsAppMedia";
import { logger } from "../../utils/logger";
import { classifyWhatsAppError, toAppError } from "../../utils/whatsappErrorClassifier";
import { metricsSendFailure, metricsSendSuccess } from "../../utils/wbotMetrics";
import { getWbot, removeWbot } from "../../libs/wbot";
import { StartWhatsAppSession } from "../../services/WbotServices/StartWhatsAppSession";

const SEND_MAX_ATTEMPTS = Math.max(1, Number(process.env.WBOT_SEND_MAX_ATTEMPTS || 2));
const SEND_RETRY_DELAY_MS = Math.max(0, Number(process.env.WBOT_SEND_RETRY_DELAY_MS || 1200));
const SOCKET_WAIT_TIMEOUT_MS = Math.max(1000, Number(process.env.WBOT_SEND_SOCKET_WAIT_TIMEOUT_MS || 12000));
const SOCKET_WAIT_STEP_MS = 300;

class BaileysProvider implements IWhatsAppProvider {
  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetrySend(kind: string): boolean {
    return kind === "connection_closed" || kind === "request_aborted" || kind === "not_initialized";
  }

  private async waitForSocketReady(whatsappId: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const socket = getWbot(whatsappId) as any;
        const readyState = socket?.ws?.readyState;
        if (readyState === undefined || readyState === 1) {
          return;
        }
      } catch (err) {
        // Sessão ainda não inicializada; continua aguardando.
      }
      await this.delay(SOCKET_WAIT_STEP_MS);
    }
  }

  private async recoverSession(whatsapp: Whatsapp): Promise<void> {
    try {
      await removeWbot(whatsapp.id, false);
    } catch (err: any) {
      logger.debug("Falha ao remover sessão durante recuperação de envio", {
        whatsappId: whatsapp.id,
        companyId: whatsapp.companyId,
        error: err?.message
      });
    }

    await StartWhatsAppSession(whatsapp, whatsapp.companyId);
    await this.waitForSocketReady(whatsapp.id, SOCKET_WAIT_TIMEOUT_MS);
  }

  private async executeWithTransientRetry<T>(
    whatsapp: Whatsapp,
    sendType: "message" | "media",
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await operation();
        metricsSendSuccess(whatsapp.companyId, whatsapp.id);
        return result;
      } catch (err: any) {
        lastError = err;
        const classification = classifyWhatsAppError(err);
        const canRetry = attempt < SEND_MAX_ATTEMPTS && classification.retryable && this.shouldRetrySend(classification.kind);

        if (canRetry) {
          logger.warn("Falha transitória no envio WhatsApp, tentando recuperar sessão", {
            companyId: whatsapp.companyId,
            whatsappId: whatsapp.id,
            provider: whatsapp.provider,
            sendType,
            attempt,
            maxAttempts: SEND_MAX_ATTEMPTS,
            errorCode: classification.code,
            statusCode: classification.statusCode
          });

          try {
            await this.recoverSession(whatsapp);
          } catch (recoveryError: any) {
            logger.warn("Falha ao recuperar sessão WhatsApp para retry", {
              companyId: whatsapp.companyId,
              whatsappId: whatsapp.id,
              sendType,
              attempt,
              error: recoveryError?.message
            });
          }

          await this.delay(SEND_RETRY_DELAY_MS);
          continue;
        }

        metricsSendFailure(whatsapp.companyId, whatsapp.id, classification.code);
        const logPayload = {
          companyId: whatsapp.companyId,
          whatsappId: whatsapp.id,
          provider: whatsapp.provider,
          sendType,
          errorCode: classification.code,
          retryable: classification.retryable,
          statusCode: classification.statusCode
        };
        if (classification.retryable) {
          logger.debug("Falha transitória ao enviar WhatsApp", logPayload);
        } else {
          logger.warn("Falha ao enviar WhatsApp", logPayload);
        }

        if (classification.kind === "unknown") {
          Sentry.captureException(err);
          throw new AppError("ERR_SENDING_WAPP_MSG");
        }

        throw toAppError(classification);
      }
    }

    throw lastError;
  }

  /**
   * Constrói o JID correto para envio de mensagens.
   * CORREÇÃO: Detecta se é grupo baseado no formato do número
   * - Se já contém @g.us ou @s.whatsapp.net, usa como está
   * - Se termina com padrão de grupo (números-números@g.us), usa @g.us
   * - Caso contrário, usa @s.whatsapp.net (chat privado)
   */
  private buildChatJid(number: string): string {
    // Se já é um JID completo, retorna como está
    if (number.includes("@")) {
      return number;
    }
    
    // Detecta se é um grupo pelo padrão (grupos geralmente têm formato: numerosrandom-timestamp)
    // Grupos têm formato como: 120363123456789012@g.us
    // Para simplificar, se o número limpo tiver mais de 15 dígitos, provavelmente é um grupo
    const cleanNumber = number.replace(/\D/g, "");
    
    // Grupos geralmente têm IDs maiores que números de telefone
    // Números de telefone raramente passam de 15 dígitos
    if (cleanNumber.length > 15) {
      return `${number}@g.us`;
    }
    
    return `${number}@s.whatsapp.net`;
  }

  async sendMessage(
    whatsapp: Whatsapp,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<WAMessage> {
    const chatId = this.buildChatJid(number);
    const formattedBody = `\u200e${body}`;

    // Converter opções para o formato esperado pelo Baileys
    const baileysOptions = options as MiscMessageGenerationOptions & { contextInfo?: { mentionedJid?: string[] } };

    // Baileys espera "mentions" no nível raiz do conteúdo (não contextInfo) - processa e injeta em contextInfo
    const messageContent: any = { text: formattedBody };
    const mentionedJid = baileysOptions?.contextInfo?.mentionedJid;
    if (mentionedJid?.length) {
      messageContent.mentions = mentionedJid;
    }

    return this.executeWithTransientRetry(whatsapp, "message", async () => {
      const wbot = await GetWhatsappWbot(whatsapp);
      return wbot.sendMessage(chatId, messageContent, baileysOptions);
    });
  }

  async sendMedia(
    whatsapp: Whatsapp,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<WAMessage> {
    // CORREÇÃO: Usar buildChatJid para suportar grupos corretamente
    const chatId = this.buildChatJid(number);

    const messageOptions = await getMessageOptions(
      options?.fileName || "",
      mediaPath,
      options?.caption,
      options?.mimetype
    );

    if (!messageOptions) {
      throw new AppError("ERR_INVALID_MEDIA");
    }

    return this.executeWithTransientRetry(whatsapp, "media", async () => {
      const wbot = await GetWhatsappWbot(whatsapp);
      return wbot.sendMessage(chatId, messageOptions);
    });
  }

  async getStatus(whatsapp: Whatsapp): Promise<string> {
    return whatsapp.status || "DISCONNECTED";
  }
}

export default new BaileysProvider();

