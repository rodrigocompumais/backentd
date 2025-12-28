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

class BaileysProvider implements IWhatsAppProvider {
  async sendMessage(
    whatsapp: Whatsapp,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<WAMessage> {
    try {
      const wbot = await GetWhatsappWbot(whatsapp);
      const chatId = `${number}@s.whatsapp.net`;
      const formattedBody = `\u200e${body}`;

      // Converter opções para o formato esperado pelo Baileys
      const baileysOptions: MiscMessageGenerationOptions = options as any;

      const sentMessage = await wbot.sendMessage(
        chatId,
        { text: formattedBody },
        baileysOptions
      );

      return sentMessage;
    } catch (err) {
      Sentry.captureException(err);
      console.log(err);
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }
  }

  async sendMedia(
    whatsapp: Whatsapp,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<WAMessage> {
    try {
      const wbot = await GetWhatsappWbot(whatsapp);
      const chatId = `${number}@s.whatsapp.net`;

      const messageOptions = await getMessageOptions(
        options?.fileName || "",
        mediaPath,
        options?.caption
      );

      if (!messageOptions) {
        throw new AppError("ERR_INVALID_MEDIA");
      }

      const sentMessage = await wbot.sendMessage(chatId, messageOptions);

      return sentMessage;
    } catch (err) {
      Sentry.captureException(err);
      console.log(err);
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }
  }

  async getStatus(whatsapp: Whatsapp): Promise<string> {
    return whatsapp.status || "DISCONNECTED";
  }
}

export default new BaileysProvider();

