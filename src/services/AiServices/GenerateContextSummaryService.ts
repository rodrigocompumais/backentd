import axios from "axios";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Setting from "../../models/Setting";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey } from "../../config/gemini";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface GenerateContextSummaryParams {
  ticketId: number;
  companyId: number;
  provider: "gemini" | "openai";
  maxMessages?: number;
}

const formatDateTime = (date: Date | string): string => {
  try {
    return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return new Date(date).toLocaleString("pt-BR");
  }
};

/**
 * Gera um resumo objetivo do contexto da conversa para transferência
 */
export const generateContextSummary = async ({
  ticketId,
  companyId,
  provider,
  maxMessages = 20
}: GenerateContextSummaryParams): Promise<string> => {
  try {
    const ticket = await ShowTicketService(ticketId, companyId);
    if (!ticket) {
      throw new AppError("Ticket não encontrado", 404);
    }

    // Buscar informações do ticket
    const ticketData = await Ticket.findByPk(ticketId, {
      include: [
        { model: Contact, attributes: ["id", "name", "number"] },
        { model: User, attributes: ["id", "name"], required: false },
        { model: Queue, attributes: ["id", "name"], required: false }
      ]
    });

    // Buscar últimas mensagens
    const messages = await Message.findAll({
      where: {
        ticketId,
        companyId,
        isDeleted: false
      },
      include: [
        { model: Contact, attributes: ["id", "name"] }
      ],
      order: [["createdAt", "DESC"]],
      limit: maxMessages
    });

    if (messages.length === 0) {
      return "Nenhuma mensagem encontrada no ticket.";
    }

    // Construir contexto das mensagens (do mais antigo para o mais recente)
    const messagesContext = messages
      .reverse()
      .map((msg) => {
        const timestamp = formatDateTime(msg.createdAt);
        const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
        const contactName = msg.contact?.name || "Desconhecido";
        const body = msg.body || "[Mídia]";
        return `[${timestamp}] ${sender} (${contactName}): ${body}`;
      })
      .join("\n");

    // Construir prompt para resumo
    const systemPrompt = `Você é um assistente de IA especializado em criar resumos objetivos de conversas de atendimento.

CONTEXTO DO TICKET:
- Status: ${ticketData.status}
- Contato: ${ticketData.contact?.name || "Desconhecido"}
- Atendente atual: ${ticketData.user?.name || "Sem atendente"}
- Fila atual: ${ticketData.queue?.name || "Sem fila"}
- Criado em: ${formatDateTime(ticketData.createdAt)}
- Última atualização: ${formatDateTime(ticketData.updatedAt)}

ÚLTIMAS ${messages.length} MENSAGENS DA CONVERSA:
${messagesContext}

INSTRUÇÕES:
- Crie um resumo objetivo e conciso do contexto da conversa
- Identifique o status da conversa (ex: "Venda fechada", "Dúvida técnica", "Reclamação", "Solicitação de informação")
- Liste os pontos principais discutidos
- Indique próximos passos necessários (se houver)
- Seja direto e objetivo (máximo 200 palavras)
- Use linguagem profissional

FORMATO:
Retorne APENAS o texto do resumo, sem formatação adicional, sem JSON, sem prefixos.`;

    if (provider === "gemini") {
      // Usar Gemini
      const geminiSetting = await Setting.findOne({
        where: {
          key: "geminiApiKey",
          companyId
        }
      });

      let apiKey: string;
      try {
        apiKey = validateGeminiApiKey(geminiSetting?.value);
      } catch (err: any) {
        throw new AppError("Chave da API do Gemini não configurada", 400);
      }

      const response = await axios.post(
        `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: systemPrompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024
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

      const candidates = response.data?.candidates || [];
      if (candidates.length === 0) {
        throw new AppError("Nenhuma resposta do Gemini", 500);
      }

      const first = candidates[0];
      const parts = first?.content?.parts || [];
      const summary = parts
        .map((p: any) => p.text || "")
        .filter((t: string) => t.trim() !== "")
        .join("\n")
        .trim();

      if (!summary) {
        throw new AppError("Resumo vazio do Gemini", 500);
      }

      logger.info(`Resumo gerado com sucesso para ticket ${ticketId} (${summary.length} caracteres)`);
      return summary;
    } else {
      // Usar OpenAI
      const openai = require("openai");
      const openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      if (!process.env.OPENAI_API_KEY) {
        throw new AppError("Chave da API do OpenAI não configurada", 400);
      }

      const completion = await openaiClient.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const summary = completion.choices[0]?.message?.content?.trim();
      if (!summary) {
        throw new AppError("Resumo vazio do OpenAI", 500);
      }

      logger.info(`Resumo gerado com sucesso para ticket ${ticketId} (${summary.length} caracteres)`);
      return summary;
    }
  } catch (error: any) {
    logger.error(`Erro ao gerar resumo do contexto: ${error.message}`);
    throw error;
  }
};

export default generateContextSummary;

