import axios from "axios";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";

interface AgentSummaryParams {
  companyId: number;
  agentId: number;
  dateStart?: string;
  dateEnd?: string;
  maxMessages?: number;
}

interface AgentSummaryResponse {
  summary: string;
  ticketsCount: number;
}

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 19).replace("T", " ");
};

const AgentSummaryGeminiService = async ({
  companyId,
  agentId,
  dateStart,
  dateEnd,
  maxMessages = 200
}: AgentSummaryParams): Promise<AgentSummaryResponse> => {
  const geminiSetting = await Setting.findOne({
    where: {
      key: "geminiApiKey",
      companyId
    }
  });

  if (!geminiSetting || !geminiSetting.value) {
    throw new AppError("GEMINI_KEY_MISSING", 400);
  }

  const ticketWhere: any = {
    companyId,
    userId: agentId
  };

  // Buscar tickets primeiro
  const tickets = await Ticket.findAll({
    where: ticketWhere,
    include: [
      {
        model: Contact
      }
    ],
    order: [["createdAt", "DESC"]]
  });

  if (!tickets.length) {
    return {
      summary:
        "Nenhuma conversa encontrada para o atendente e período informados.",
      ticketsCount: 0
    };
  }

  // Buscar mensagens separadamente para cada ticket
  const ticketIds = tickets.map(t => t.id);
  const messagesWhere: any = {
    ticketId: { [Op.in]: ticketIds },
    companyId
  };

  if (dateStart || dateEnd) {
    messagesWhere.createdAt = {};
    if (dateStart) {
      messagesWhere.createdAt[Op.gte] = new Date(`${dateStart} 00:00:00`);
    }
    if (dateEnd) {
      messagesWhere.createdAt[Op.lte] = new Date(`${dateEnd} 23:59:59`);
    }
  }

  const allMessages = await Message.findAll({
    where: messagesWhere,
    order: [["createdAt", "ASC"]]
  });

  // Agrupar mensagens por ticket
  const messagesByTicket: { [key: number]: Message[] } = {};
  for (const msg of allMessages) {
    if (!messagesByTicket[msg.ticketId]) {
      messagesByTicket[msg.ticketId] = [];
    }
    messagesByTicket[msg.ticketId].push(msg);
  }

  const lines: string[] = [];
  let messagesCount = 0;

  for (const ticket of tickets) {
    const anyTicket: any = ticket as any;
    const contact: Contact | undefined = anyTicket.contact;
    const ticketMessages: Message[] = messagesByTicket[ticket.id] || [];

    if (!ticketMessages.length) {
      continue;
    }

    lines.push(
      `=== Ticket #${ticket.id} | Contato: ${
        contact?.name || contact?.number || "Desconhecido"
      } | Criado em: ${formatDate(ticket.createdAt)} ===`
    );

    for (const msg of ticketMessages) {
      if (messagesCount >= maxMessages) break;
      if (!msg.body) continue;

      const role = msg.fromMe ? "ATENDENTE" : "CLIENTE";
      lines.push(
        `[${role}] (${formatDate(msg.createdAt)}): ${(msg.body || "").slice(
          0,
          500
        )}`
      );
      messagesCount += 1;
    }

    lines.push("");

    if (messagesCount >= maxMessages) {
      break;
    }
  }

  const conversationsText = lines.join("\n");

  if (!conversationsText || conversationsText.trim().length === 0) {
    return {
      summary: "Não foi possível processar as conversas. Verifique se há mensagens válidas no período selecionado.",
      ticketsCount: tickets.length
    };
  }

  const systemPrompt =
    "Você é uma IA especializada em resumir atendimentos de suporte ao cliente.\n" +
    "Com base nas conversas abaixo, produza um resumo por atendente com:\n" +
    "1) Visão geral do que aconteceu nas conversas.\n" +
    "2) Principais problemas reportados pelos clientes.\n" +
    "3) Situações não resolvidas ou que exigem acompanhamento (destaque quais clientes e datas).\n" +
    "4) Pontos fortes do atendimento do agente.\n" +
    "5) Oportunidades de melhoria e recomendações práticas.\n" +
    "Responda em português claro, organizado em seções e, se possível, em formato de bullet points.\n";

  // Limitar o tamanho do prompt para evitar exceder limites da API
  const maxPromptLength = 30000; // Limite conservador
  let finalConversationsText = conversationsText;
  if (conversationsText.length > maxPromptLength) {
    finalConversationsText = conversationsText.slice(0, maxPromptLength) + "\n\n[... conteúdo truncado devido ao tamanho ...]";
  }

  const finalPrompt = `${systemPrompt}\n\nCONVERSAS DO ATENDENTE (até ${maxMessages} mensagens):\n\n${finalConversationsText}`;

  try {
    const apiKey = geminiSetting.value.trim();
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: finalPrompt
              }
            ]
          }
        ]
      },
      {
        timeout: 30000
      }
    );

    const candidates = data?.candidates || [];
    const first = candidates[0];
    const parts = first?.content?.parts || [];
    const text = parts.map((p: any) => p.text).join("\n");

    if (!text) {
      throw new Error("Resposta vazia do Gemini");
    }

    return {
      summary: text,
      ticketsCount: tickets.length
    };
  } catch (err: any) {
    console.error("Erro ao chamar Gemini API:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
      stack: err.stack
    });
    
    if (err.response?.status === 400) {
      const errorMessage = err.response?.data?.error?.message || "Erro na requisição para a API do Gemini";
      throw new AppError(`GEMINI_API_ERROR: ${errorMessage}`, 400);
    }
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new AppError("GEMINI_KEY_INVALID", 401);
    }
    if (err.response?.status === 429) {
      throw new AppError("GEMINI_RATE_LIMIT", 429);
    }
    throw new AppError(`ERR_GEMINI_SUMMARY: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export default AgentSummaryGeminiService;


