import { proto, WASocket } from "baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue,
  verifyMediaMessage,
  verifyMessage
} from "../WbotServices/wbotMessageListener";

import fs from "fs";
import path from "path";

import axios from "axios";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import Setting from "../../models/Setting";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

type Session = WASocket & {
  id?: number;
};

interface IGemini {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  queueId: number;
  maxMessages: number;
}

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

export const handleGemini = async (
  geminiSettings: IGemini,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  ticketTraking: TicketTraking
): Promise<void> => {
  // REGRA PARA DESABILITAR O BOT PARA ALGUM CONTATO
  if (contact.disableBot) {
    return;
  }

  const bodyMessage = getBodyMessage(msg);
  if (!bodyMessage) return;

  if (!geminiSettings) return;

  if (msg.messageStubType) return;

  // Buscar API key do Gemini das Settings da empresa
  const geminiSetting = await Setting.findOne({
    where: {
      key: "geminiApiKey",
      companyId: ticket.companyId
    }
  });

  let apiKey: string;
  try {
    apiKey = validateGeminiApiKey(geminiSetting?.value);
  } catch (err: any) {
    logger.error(`Erro ao validar API key do Gemini para empresa ${ticket.companyId}: ${err.message}`);
    return;
  }

  const publicFolder: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${ticket.companyId}`
  );

  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: geminiSettings.maxMessages
  });

  const promptSystem = `Nas respostas utilize o nome ${sanitizeName(
    contact.name || "Amigo(a)"
  )} para identificar o cliente.\nSua resposta deve usar no máximo ${
    geminiSettings.maxTokens
  } tokens e cuide para não truncar o final.\nSempre que possível, mencione o nome dele para ser mais personalizado o atendimento e mais educado. Quando a resposta requer uma transferência para o setor de atendimento, comece sua resposta com 'Ação: Transferir para o setor de atendimento'.\n
                ${geminiSettings.prompt}\n`;

  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    // Construir histórico de conversa no formato Gemini
    const contents: any[] = [];

    // Adicionar prompt do sistema como primeira mensagem
    contents.push({
      role: "user",
      parts: [{ text: promptSystem }]
    });
    contents.push({
      role: "model",
      parts: [{ text: "Entendido. Vou seguir essas instruções." }]
    });

    // Adicionar histórico de mensagens
    for (
      let i = 0;
      i < Math.min(geminiSettings.maxMessages, messages.length);
      i++
    ) {
      const message = messages[i];
      if (
        message.mediaType === "conversation" ||
        message.mediaType === "extendedTextMessage"
      ) {
        if (message.fromMe) {
          contents.push({
            role: "model",
            parts: [{ text: message.body }]
          });
        } else {
          contents.push({
            role: "user",
            parts: [{ text: message.body }]
          });
        }
      }
    }

    // Adicionar mensagem atual do usuário
    contents.push({
      role: "user",
      parts: [{ text: bodyMessage! }]
    });

    try {
      const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

      const { data } = await axios.post(
        `${url}?key=${apiKey}`,
        {
          contents: contents,
          generationConfig: {
            temperature: geminiSettings.temperature,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: geminiSettings.maxTokens
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_ONLY_HIGH"
            }
          ]
        },
        {
          timeout: 60000
        }
      );

      const candidates = data?.candidates || [];
      
      if (candidates.length === 0) {
        logger.error("Nenhum candidato retornado pelo Gemini");
        return;
      }

      const first = candidates[0];
      const parts = first?.content?.parts || [];
      let response = parts.map((p: any) => p.text).join("\n");

      if (!response) {
        logger.error("Resposta vazia do Gemini");
        return;
      }

      // Verificar se precisa transferir para fila
      if (response.includes("Ação: Transferir para o setor de atendimento")) {
        await transferQueue(geminiSettings.queueId, ticket, contact);
        response = response
          .replace("Ação: Transferir para o setor de atendimento", "")
          .trim();
      }

      // Enviar resposta
      if (geminiSettings.voice === "texto") {
        const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          text: `\u200e ${response}`
        });
        await verifyMessage(sentMessage!, ticket, contact);
      } else {
        const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
        convertTextToSpeechAndSaveToFile(
          keepOnlySpecifiedChars(response),
          `${publicFolder}/${fileNameWithOutExtension}`,
          geminiSettings.voiceKey,
          geminiSettings.voiceRegion,
          geminiSettings.voice,
          "mp3"
        ).then(async () => {
          try {
            const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
              audio: { url: `${publicFolder}/${fileNameWithOutExtension}.mp3` },
              mimetype: "audio/mpeg",
              ptt: true
            });
            await verifyMediaMessage(
              sendMessage!,
              ticket,
              contact,
              ticketTraking,
              false,
              false,
              wbot
            );
            fs.unlinkSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
            if (fs.existsSync(`${publicFolder}/${fileNameWithOutExtension}.wav`)) {
              fs.unlinkSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
            }
          } catch (error) {
            logger.error(`Erro para responder com audio: ${error}`);
          }
        });
      }
    } catch (err: any) {
      const status = err.response?.status;
      const errorData = err.response?.data;
      
      logger.error("Erro ao chamar Gemini API:", {
        status,
        data: errorData,
        message: err.message
      });
      
      if (status) {
        const userMessage = interpretGeminiError(status, errorData);
        logger.error(`Erro Gemini: ${userMessage}`);
      }
    }
  } else if (msg.message?.audioMessage) {
    // Nota: Gemini não tem transcrição de áudio nativa como Whisper
    // Por enquanto, vamos apenas logar que áudio foi recebido
    // Se necessário, pode-se usar Whisper da OpenAI ou outro serviço
    logger.warn("Áudio recebido, mas Gemini não suporta transcrição nativa. Use OpenAI para áudio.");
  }
};

