import axios from "axios";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import fs from "fs";

interface GupshupSendTextMessageParams {
  apiKey: string;
  appName: string;
  destination: string;
  message: string;
}

interface GupshupSendMediaMessageParams {
  apiKey: string;
  appName: string;
  destination: string;
  mediaPath: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption?: string;
  fileName?: string;
}

class GupshupApiClient {
  private baseURL = "https://api.gupshup.io/sm/api/v1";

  /**
   * Envia mensagem de texto via Gupshup
   */
  async sendTextMessage(params: GupshupSendTextMessageParams): Promise<any> {
    try {
      const { apiKey, appName, destination, message } = params;

      // Remove caracteres não numéricos do número
      const cleanNumber = destination.replace(/\D/g, "");

      const response = await axios.post(
        `${this.baseURL}/msg`,
        {
          channel: "whatsapp",
          source: appName,
          destination: cleanNumber,
          message: {
            type: "text",
            text: message
          }
        },
        {
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json"
          }
        }
      );

      return response.data;
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Gupshup API Error:", error.response?.data || error.message);
      throw new AppError(
        error.response?.data?.message || "ERR_SENDING_GUPSHUP_MSG"
      );
    }
  }

  /**
   * Envia mídia via Gupshup
   */
  async sendMediaMessage(params: GupshupSendMediaMessageParams): Promise<any> {
    try {
      const { apiKey, appName, destination, mediaPath, mediaType, caption, fileName } = params;

      // Remove caracteres não numéricos do número
      const cleanNumber = destination.replace(/\D/g, "");

      // Ler arquivo e converter para base64
      const fileBuffer = fs.readFileSync(mediaPath);
      const base64Media = fileBuffer.toString("base64");

      const response = await axios.post(
        `${this.baseURL}/msg`,
        {
          channel: "whatsapp",
          source: appName,
          destination: cleanNumber,
          message: {
            type: mediaType,
            caption: caption || "",
            media: base64Media,
            fileName: fileName || "file",
            mimetype: this.getContentType(mediaType)
          }
        },
        {
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json"
          }
        }
      );

      return response.data;
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Gupshup API Error:", error.response?.data || error.message);
      throw new AppError(
        error.response?.data?.message || "ERR_SENDING_GUPSHUP_MSG"
      );
    }
  }

  /**
   * Obtém o tipo de conteúdo baseado no tipo de mídia
   */
  private getContentType(mediaType: string): string {
    const contentTypes: { [key: string]: string } = {
      image: "image/jpeg",
      video: "video/mp4",
      audio: "audio/mpeg",
      document: "application/pdf"
    };

    return contentTypes[mediaType] || "application/octet-stream";
  }
}

export default new GupshupApiClient();

