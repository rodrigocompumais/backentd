import axios from "axios";
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

  const messagesWhere: any = {
    companyId
  };

  if (dateStart) {
    messagesWhere.createdAt = {
      ...(messagesWhere.createdAt || {}),
      $gte: new Date(`${dateStart} 00:00:00`)
    };
  }

  if (dateEnd) {
    messagesWhere.createdAt = {
      ...(messagesWhere.createdAt || {}),
      $lte: new Date(`${dateEnd} 23:59:59`)
    };
  }

  const tickets = await Ticket.findAll({
    where: ticketWhere,
    include: [
      {
        model: Message,
        where: messagesWhere,
        required: false,
        order: [["createdAt", "ASC"]]
      },
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

  const lines: string[] = [];
  let messagesCount = 0;

  for (const ticket of tickets) {
    const anyTicket: any = ticket as any;
    const contact: Contact | undefined = anyTicket.contact;
    const ticketMessages: Message[] = (anyTicket.messages || []).sort(
      (a: any, b: any) =>
        new Date(a.createdAt as any).getTime() -
        new Date(b.createdAt as any).getTime()
    );

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

  const systemPrompt =
    "Você é uma IA especializada em resumir atendimentos de suporte ao cliente.\n" +
    "Com base nas conversas abaixo, produza um resumo por atendente com:\n" +
    "1) Visão geral do que aconteceu nas conversas.\n" +
    "2) Principais problemas reportados pelos clientes.\n" +
    "3) Situações não resolvidas ou que exigem acompanhamento (destaque quais clientes e datas).\n" +
    "4) Pontos fortes do atendimento do agente.\n" +
    "5) Oportunidades de melhoria e recomendações práticas.\n" +
    "Responda em português claro, organizado em seções e, se possível, em formato de bullet points.\n";

  const finalPrompt = `${systemPrompt}\n\nCONVERSAS DO ATENDENTE (até ${maxMessages} mensagens):\n\n${conversationsText}`;

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
  } catch (err) {
    throw new AppError("ERR_GEMINI_SUMMARY", 500);
  }
};

export default AgentSummaryGeminiService;


