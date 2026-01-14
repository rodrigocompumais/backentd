import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import ShowTicketService from "../TicketServices/ShowTicketService";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AIProviderSelector } from "./AIProviderSelector";

interface GenerateContextSummaryParams {
  ticketId: number;
  companyId: number;
  provider?: "gemini" | "openai"; // Opcional, se não fornecido usa configuração automática
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

    // Selecionar provider automaticamente usando a configuração da funcionalidade
    // Se provider foi especificado explicitamente, criar diretamente, senão usar selector
    let selectedProvider;
    if (provider) {
      const AIProviderFactory = require("./AIProviderFactory").AIProviderFactory;
      if (provider === "gemini") {
        selectedProvider = await AIProviderFactory.createGeminiProvider(companyId);
      } else {
        selectedProvider = await AIProviderFactory.createOpenAIProvider(companyId);
      }
    } else {
      selectedProvider = await AIProviderSelector.getProvider(companyId, "summaries");
    }

    // Gerar resumo usando o provider selecionado
    const summary = await selectedProvider.generateText(systemPrompt, {
      temperature: 0.3,
      maxTokens: 1024,
      topP: 0.95
    });

    if (!summary || summary.trim() === "") {
      throw new AppError("Resumo vazio retornado pela IA", 500);
    }

    logger.info(`Resumo gerado com sucesso para ticket ${ticketId} usando ${selectedProvider.name} (${summary.length} caracteres)`);
    return summary.trim();
  } catch (error: any) {
    logger.error(`Erro ao gerar resumo do contexto: ${error.message}`);
    throw error;
  }
};

export default generateContextSummary;

