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
import CreateMessageService, { MessageData } from "../MessageServices/CreateMessageService";
import generateContextSummary from "../AiServices/GenerateContextSummaryService";
import findOnlineAgent from "../TicketServices/FindOnlineAgentService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Company from "../../models/Company";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne";

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
  canSendInternalMessages?: boolean;
  canTransferToAgent?: boolean;
  transferQueueId?: number | null;
}

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

/**
 * Envia mensagem automática de transferência para o cliente
 */
const sendTransferMessage = async (
  ticket: Ticket,
  contact: Contact,
  queueId: number | null,
  userId: number | null
): Promise<void> => {
  try {
    // Verificar se a configuração de mensagem automática está habilitada
    const settingsTransfTicket = await ListSettingsServiceOne({
      companyId: ticket.companyId,
      key: "sendMsgTransfTicket"
    });

    if (settingsTransfTicket?.value !== "enabled") {
      logger.info(`Mensagem automática de transferência desabilitada para empresa ${ticket.companyId}`);
      return;
    }

    const company = await Company.findByPk(ticket.companyId);
    const language = company?.language || "pt";
    const wbot = await GetTicketWbot(ticket);

    let translatedMessage: string;

    if (queueId && userId) {
      // Transferência para fila E atendente
      const queue = await Queue.findByPk(queueId);
      const user = await User.findByPk(userId);

      const messages = {
        pt: `*Mensagem automática*:\nVocê foi transferido para o departamento *${queue?.name || "Atendimento"}* e contará com a presença de *${user?.name || "um atendente"}*\naguarde, já vamos te atender!`,
        en: `*Automatic message*:\nYou have been transferred to the *${queue?.name || "Support"}* department and will be assisted by *${user?.name || "an agent"}*\nplease wait, we'll assist you soon!`,
        es: `*Mensaje automático*:\nHas sido transferido al departamento *${queue?.name || "Atención"}* y serás atendido por *${user?.name || "un agente"}*\npor favor espera, ¡te atenderemos pronto!`
      };
      translatedMessage = messages[language as keyof typeof messages] || messages.pt;
    } else if (userId) {
      // Transferência apenas para atendente
      const user = await User.findByPk(userId);

      const messages = {
        pt: `*Mensagem automática*:\nFoi transferido para o atendente *${user?.name || "Atendente"}*\naguarde, já vamos te atender!`,
        en: `*Automatic message*:\nYou have been transferred to agent *${user?.name || "Agent"}*\nplease wait, we'll assist you soon!`,
        es: `*Mensaje automático*:\nHas sido transferido al agente *${user?.name || "Agente"}*\npor favor espera, ¡te atenderemos pronto!`
      };
      translatedMessage = messages[language as keyof typeof messages] || messages.pt;
    } else if (queueId) {
      // Transferência apenas para fila
      const queue = await Queue.findByPk(queueId);

      const messages = {
        pt: `*Mensagem automática*:\nVocê foi transferido para o departamento *${queue?.name || "Atendimento"}*\naguarde, já vamos te atender!`,
        en: `*Automatic message*:\nYou have been transferred to the *${queue?.name || "Support"}* department\nplease wait, we'll assist you soon!`,
        es: `*Mensaje automático*:\nHas sido transferido al departamento *${queue?.name || "Atención"}*\npor favor espera, ¡te atenderemos pronto!`
      };
      translatedMessage = messages[language as keyof typeof messages] || messages.pt;
    } else {
      // Sem informações suficientes
      return;
    }

    const transferMessage = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      {
        text: translatedMessage
      }
    );
    await verifyMessage(transferMessage!, ticket, contact);
    logger.info(`Mensagem automática de transferência enviada para ticket ${ticket.id}`);
  } catch (error: any) {
    logger.error(`Erro ao enviar mensagem automática de transferência: ${error.message}`);
    // Não lançar erro para não interromper o fluxo de transferência
  }
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

  // Limitar histórico para não consumir todos os tokens
  // Pegar apenas as últimas mensagens relevantes (máximo 20 para não consumir muitos tokens)
  const maxHistoryMessages = Math.min(geminiSettings.maxMessages, 20);
  
  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "DESC"]],
    limit: maxHistoryMessages
  });

  // Prompt do sistema otimizado e mais curto
  let promptSystem = `Você é um assistente de atendimento. Use o nome ${sanitizeName(
    contact.name || "Amigo(a)"
  )} para personalizar.\n${geminiSettings.prompt}\n\nIMPORTANTE: Seja direto e objetivo. Para transferir, comece com 'Ação: Transferir para o setor de atendimento'.`;
  
  // Adicionar instruções sobre mensagens internas se habilitado
  if (geminiSettings.canSendInternalMessages) {
    promptSystem += `\n\nREGRA CRÍTICA - Anotações Internas:
- Use SEMPRE o formato [INTERNA]conteúdo[/INTERNA] para anotações internas
- As anotações internas devem vir ANTES ou DEPOIS da resposta ao cliente, NUNCA no meio
- SEMPRE forneça uma resposta ao cliente, mesmo que faça anotações internas
- Exemplo CORRETO: "Entendo seu problema. Vou verificar. [INTERNA]Cliente relatou erro técnico, precisa de suporte especializado[/INTERNA] Em breve retorno com a solução."
- Exemplo ERRADO: "Entendo [INTERNA]anotação[/INTERNA] seu problema."
- Se fizer anotação interna, SEMPRE termine com [/INTERNA] antes de continuar a resposta ao cliente`;
  }

  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    // Construir histórico de conversa no formato Gemini
    const contents: any[] = [];

    // Adicionar prompt do sistema de forma mais eficiente
    // Não adicionar resposta do modelo para economizar tokens
    contents.push({
      role: "user",
      parts: [{ text: promptSystem }]
    });

    // Adicionar histórico de mensagens (inverter ordem para ter do mais antigo ao mais recente)
    const sortedMessages = [...messages].reverse();
    for (
      let i = 0;
      i < Math.min(geminiSettings.maxMessages, sortedMessages.length);
      i++
    ) {
      const message = sortedMessages[i];
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
            // Garantir que há tokens suficientes para a resposta
            // Se maxTokens for muito baixo (menor que 500), usar no mínimo 1024 para garantir resposta
            maxOutputTokens: Math.max(geminiSettings.maxTokens, 1024)
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
        logger.error("Resposta completa da API:", JSON.stringify(data, null, 2));
        return;
      }

      const first = candidates[0];
      
      // Verificar finishReason
      if (first?.finishReason && first.finishReason !== "STOP") {
        logger.warn(`⚠️ finishReason: ${first.finishReason}`);
        
        if (first.finishReason === "SAFETY") {
          logger.error("Conteúdo bloqueado pelos filtros de segurança");
          return;
        }
        
        if (first.finishReason === "MAX_TOKENS") {
          logger.warn("⚠️ MAX_TOKENS atingido, resposta pode estar incompleta");
          // Continua para tentar extrair o que foi gerado
        }
        
        if (first.finishReason === "RECITATION") {
          logger.warn("⚠️ RECITATION detectado, resposta pode estar vazia");
        }
      }

      const parts = first?.content?.parts || [];
      let response = parts.map((p: any) => p.text || "").filter((t: string) => t.trim() !== "").join("\n");

      if (!response || response.trim() === "") {
        logger.error("Resposta vazia do Gemini");
        logger.error("Candidato completo:", JSON.stringify(first, null, 2));
        logger.error("Parts:", JSON.stringify(parts, null, 2));
        logger.error("FinishReason:", first?.finishReason);
        logger.error("Resposta completa da API:", JSON.stringify(data, null, 2));
        return;
      }

      logger.info(`✅ Resposta recebida do Gemini (${response.length} caracteres)`);

      // Detectar e processar mensagens internas
      // Primeiro, procurar por mensagens internas com fechamento [/INTERNA]
      const internalMessages: string[] = [];
      let cleanedResponse = response;

      if (geminiSettings.canSendInternalMessages) {
        // Regex para capturar [INTERNA]...[/INTERNA]
        const closedInternalRegex = /\[INTERNA\](.*?)\[\/INTERNA\]/gs;
        let match;
        
        // Processar todas as mensagens internas com fechamento
        while ((match = closedInternalRegex.exec(response)) !== null) {
          const internalContent = match[1].trim();
          if (internalContent) {
            internalMessages.push(internalContent);
            // Remover o marcador completo [INTERNA]...[/INTERNA] da resposta
            cleanedResponse = cleanedResponse.replace(match[0], "").trim();
          }
        }

        // Depois, procurar por mensagens internas sem fechamento (até próximo [INTERNA] ou final)
        const openInternalRegex = /\[INTERNA\]([^\[]*?)(?=\[INTERNA\]|$)/gs;
        while ((match = openInternalRegex.exec(cleanedResponse)) !== null) {
          const internalContent = match[1].trim();
          // Só adicionar se não contiver [/INTERNA] (já processado acima)
          if (internalContent && !internalContent.includes("[/INTERNA]")) {
            internalMessages.push(internalContent);
            // Remover o marcador [INTERNA] e conteúdo da resposta
            cleanedResponse = cleanedResponse.replace(match[0], "").trim();
          }
        }

        // Limpar espaços em branco extras e quebras de linha duplas
        cleanedResponse = cleanedResponse.replace(/\n\s*\n\s*\n/g, "\n\n").trim();

        // Enviar mensagens internas
        for (const internalContent of internalMessages) {
          try {
            const messageData: MessageData = {
              id: `${ticket.id}-${Date.now()}-${Math.random()}`,
              body: internalContent,
              ticketId: ticket.id,
              contactId: ticket.contactId,
              fromMe: true,
              read: true,
              isInternal: true,
              mediaType: "conversation"
            };
            await CreateMessageService({ messageData, companyId: ticket.companyId });
            logger.info(`Mensagem interna enviada: ${internalContent.substring(0, 50)}...`);
          } catch (err: any) {
            logger.error(`Erro ao enviar mensagem interna: ${err.message}`);
          }
        }
      }

      // Verificar se precisa transferir para fila/atendente
      if (response.includes("Ação: Transferir para o setor de atendimento")) {
        // Se canTransferToAgent estiver habilitado, gerar resumo e buscar atendente online
        if (geminiSettings.canTransferToAgent) {
          try {
            // Gerar resumo do contexto
            const summary = await generateContextSummary({
              ticketId: ticket.id,
              companyId: ticket.companyId,
              provider: "gemini",
              maxMessages: geminiSettings.maxMessages
            });

            // Enviar resumo como mensagem interna
            const summaryMessageData: MessageData = {
              id: `${ticket.id}-${Date.now()}-summary`,
              body: `📋 RESUMO DO CONTEXTO (antes da transferência):\n\n${summary}`,
              ticketId: ticket.id,
              contactId: ticket.contactId,
              fromMe: true,
              read: true,
              isInternal: true,
              mediaType: "conversation"
            };
            await CreateMessageService({ messageData: summaryMessageData, companyId: ticket.companyId });

            // Buscar atendente online
            const targetQueueId = geminiSettings.transferQueueId || geminiSettings.queueId;
            const onlineAgent = await findOnlineAgent({
              companyId: ticket.companyId,
              queueId: targetQueueId
            });

            if (onlineAgent) {
              // Transferir para atendente online
              await UpdateTicketService({
                ticketData: {
                  userId: onlineAgent.id,
                  queueId: targetQueueId,
                  status: "open"
                },
                ticketId: ticket.id,
                companyId: ticket.companyId
              });
              logger.info(`Ticket ${ticket.id} transferido para atendente online ${onlineAgent.name} (ID: ${onlineAgent.id})`);
              
              // Enviar mensagem automática de transferência
              await sendTransferMessage(ticket, contact, targetQueueId, onlineAgent.id);
            } else {
              // Se não encontrar atendente online, transferir apenas para fila
              await transferQueue(targetQueueId, ticket, contact);
              logger.info(`Nenhum atendente online encontrado. Ticket ${ticket.id} transferido para fila ${targetQueueId}`);
              
              // Enviar mensagem automática de transferência
              await sendTransferMessage(ticket, contact, targetQueueId, null);
            }
          } catch (err: any) {
            logger.error(`Erro ao processar transferência com resumo: ${err.message}`);
            // Fallback: transferir normalmente
            await transferQueue(geminiSettings.queueId, ticket, contact);
            
            // Enviar mensagem automática de transferência
            await sendTransferMessage(ticket, contact, geminiSettings.queueId, null);
          }
        } else {
          // Transferência normal (sem resumo)
          await transferQueue(geminiSettings.queueId, ticket, contact);
          
          // Enviar mensagem automática de transferência
          await sendTransferMessage(ticket, contact, geminiSettings.queueId, null);
        }

        cleanedResponse = cleanedResponse
          .replace("Ação: Transferir para o setor de atendimento", "")
          .trim();
      }

      // Enviar resposta (sem mensagens internas)
      // Se a resposta limpa estiver vazia mas havia mensagens internas, enviar mensagem padrão
      if (!cleanedResponse.trim() && internalMessages.length > 0) {
        logger.warn(`Resposta limpa vazia após remover mensagens internas. Enviando mensagem padrão.`);
        cleanedResponse = "Entendi sua solicitação. Estou verificando e em breve retorno com mais informações.";
      }

      if (cleanedResponse.trim()) {
        if (geminiSettings.voice === "texto") {
          const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
            text: `\u200e ${cleanedResponse}`
          });
          await verifyMessage(sentMessage!, ticket, contact);
        } else {
          const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
          convertTextToSpeechAndSaveToFile(
            keepOnlySpecifiedChars(cleanedResponse),
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

