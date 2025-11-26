import axios from "axios";
import { Op, fn, col, literal } from "sequelize";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import Company from "../../models/Company";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";

interface ChatGeminiParams {
  companyId: number;
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface ChatGeminiResponse {
  response: string;
}

// Função para buscar dados completos da empresa
const fetchCompanyData = async (companyId: number) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Dados da empresa
  const company = await Company.findByPk(companyId);

  // Contagens gerais
  const totalTickets = await Ticket.count({ where: { companyId } });
  const totalMessages = await Message.count({ where: { companyId } });
  const totalContacts = await Contact.count({ where: { companyId } });

  // Tickets por status
  const ticketsOpen = await Ticket.count({ where: { companyId, status: "open" } });
  const ticketsPending = await Ticket.count({ where: { companyId, status: "pending" } });
  const ticketsClosed = await Ticket.count({ where: { companyId, status: "closed" } });

  // Tickets hoje
  const ticketsToday = await Ticket.count({
    where: { companyId, createdAt: { [Op.gte]: today } }
  });

  // Tickets últimos 7 dias
  const ticketsWeek = await Ticket.count({
    where: { companyId, createdAt: { [Op.gte]: startOfWeek } }
  });

  // Tickets últimos 30 dias
  const ticketsMonth = await Ticket.count({
    where: { companyId, createdAt: { [Op.gte]: last30Days } }
  });

  // Mensagens hoje
  const messagesToday = await Message.count({
    where: { companyId, createdAt: { [Op.gte]: today } }
  });

  // Buscar atendentes (usuários)
  const users = await User.findAll({
    where: { companyId },
    attributes: ["id", "name", "email", "profile"],
    raw: true
  });

  // Tickets por atendente (últimos 30 dias)
  const ticketsByUser = await Ticket.findAll({
    where: { 
      companyId, 
      userId: { [Op.ne]: null },
      createdAt: { [Op.gte]: last30Days }
    },
    attributes: [
      "userId",
      [fn("COUNT", col("id")), "total"]
    ],
    group: ["userId"],
    raw: true
  }) as any[];

  // Mapear tickets por usuário
  const userTicketStats = ticketsByUser.map((stat: any) => {
    const user = users.find((u: any) => u.id === stat.userId);
    return {
      userId: stat.userId,
      userName: user?.name || "Desconhecido",
      ticketsCount: parseInt(stat.total, 10)
    };
  }).sort((a, b) => b.ticketsCount - a.ticketsCount);

  // Buscar filas
  const queues = await Queue.findAll({
    where: { companyId },
    attributes: ["id", "name", "color"],
    raw: true
  });

  // Tickets por fila (últimos 30 dias)
  const ticketsByQueue = await Ticket.findAll({
    where: { 
      companyId, 
      queueId: { [Op.ne]: null },
      createdAt: { [Op.gte]: last30Days }
    },
    attributes: [
      "queueId",
      [fn("COUNT", col("id")), "total"]
    ],
    group: ["queueId"],
    raw: true
  }) as any[];

  const queueStats = ticketsByQueue.map((stat: any) => {
    const queue = queues.find((q: any) => q.id === stat.queueId);
    return {
      queueId: stat.queueId,
      queueName: queue?.name || "Sem fila",
      ticketsCount: parseInt(stat.total, 10)
    };
  }).sort((a, b) => b.ticketsCount - a.ticketsCount);

  // Buscar tags
  const tags = await Tag.findAll({
    where: { companyId },
    attributes: ["id", "name", "color"],
    raw: true
  });

  // Conexões WhatsApp
  const whatsapps = await Whatsapp.findAll({
    where: { companyId },
    attributes: ["id", "name", "status", "isDefault"],
    raw: true
  });

  // Últimos 10 tickets com detalhes
  const recentTickets = await Ticket.findAll({
    where: { companyId },
    include: [
      { model: Contact, attributes: ["name", "number"] },
      { model: User, attributes: ["name"] },
      { model: Queue, attributes: ["name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: 10
  });

  const recentTicketsList = recentTickets.map((t: any) => ({
    id: t.id,
    status: t.status,
    contactName: t.contact?.name || "Desconhecido",
    contactNumber: t.contact?.number || "",
    attendantName: t.user?.name || "Sem atendente",
    queueName: t.queue?.name || "Sem fila",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  }));

  // Tempo médio de resposta (aproximado)
  const avgResponseInfo = "Dados de tempo médio de resposta requerem análise mais profunda das mensagens.";

  return {
    company: company?.name || "Empresa",
    stats: {
      total: {
        tickets: totalTickets,
        messages: totalMessages,
        contacts: totalContacts
      },
      ticketsByStatus: {
        open: ticketsOpen,
        pending: ticketsPending,
        closed: ticketsClosed
      },
      period: {
        ticketsToday,
        ticketsWeek,
        ticketsMonth,
        messagesToday
      }
    },
    users: users.map((u: any) => ({ id: u.id, name: u.name, profile: u.profile })),
    userTicketStats,
    queues: queues.map((q: any) => ({ id: q.id, name: q.name })),
    queueStats,
    tags: tags.map((t: any) => ({ id: t.id, name: t.name })),
    whatsapps: whatsapps.map((w: any) => ({ 
      id: w.id, 
      name: w.name, 
      status: w.status, 
      isDefault: w.isDefault 
    })),
    recentTickets: recentTicketsList
  };
};

const ChatGeminiService = async ({
  companyId,
  message,
  conversationHistory = []
}: ChatGeminiParams): Promise<ChatGeminiResponse> => {
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
    throw new AppError(err.message || "GEMINI_KEY_MISSING", 400);
  }

  // Buscar dados completos da empresa
  const companyData = await fetchCompanyData(companyId);

  const systemContext = `Você é um ASSISTENTE DE IA ESPECIALIZADO para a empresa "${companyData.company}". Você tem ACESSO REAL aos dados do sistema de atendimento ao cliente via WhatsApp.

═══════════════════════════════════════════════════════════════════
📊 DADOS ATUAIS DA BASE (ATUALIZADOS EM TEMPO REAL)
═══════════════════════════════════════════════════════════════════

📈 ESTATÍSTICAS GERAIS:
• Total de Tickets: ${companyData.stats.total.tickets}
• Total de Mensagens: ${companyData.stats.total.messages}
• Total de Contatos: ${companyData.stats.total.contacts}

📋 TICKETS POR STATUS:
• Abertos (em atendimento): ${companyData.stats.ticketsByStatus.open}
• Pendentes (aguardando): ${companyData.stats.ticketsByStatus.pending}
• Fechados: ${companyData.stats.ticketsByStatus.closed}

📅 ATIVIDADE POR PERÍODO:
• Tickets HOJE: ${companyData.stats.period.ticketsToday}
• Tickets esta SEMANA: ${companyData.stats.period.ticketsWeek}
• Tickets últimos 30 DIAS: ${companyData.stats.period.ticketsMonth}
• Mensagens HOJE: ${companyData.stats.period.messagesToday}

👥 EQUIPE DE ATENDENTES (${companyData.users.length} usuários):
${companyData.users.map((u: any) => `• ${u.name} (${u.profile})`).join('\n')}

🏆 RANKING DE ATENDIMENTOS (últimos 30 dias):
${companyData.userTicketStats.length > 0 
  ? companyData.userTicketStats.slice(0, 5).map((s: any, i: number) => 
      `${i + 1}º ${s.userName}: ${s.ticketsCount} tickets`
    ).join('\n')
  : '• Nenhum dado de atendimento no período'}

📁 FILAS/SETORES (${companyData.queues.length} filas):
${companyData.queues.map((q: any) => `• ${q.name}`).join('\n') || '• Nenhuma fila cadastrada'}

📊 TICKETS POR FILA (últimos 30 dias):
${companyData.queueStats.length > 0
  ? companyData.queueStats.map((s: any) => `• ${s.queueName}: ${s.ticketsCount} tickets`).join('\n')
  : '• Nenhum dado disponível'}

🏷️ TAGS DISPONÍVEIS:
${companyData.tags.map((t: any) => `• ${t.name}`).join('\n') || '• Nenhuma tag cadastrada'}

📱 CONEXÕES WHATSAPP:
${companyData.whatsapps.map((w: any) => 
  `• ${w.name} - Status: ${w.status}${w.isDefault ? ' (Principal)' : ''}`
).join('\n') || '• Nenhuma conexão cadastrada'}

🕐 ÚLTIMOS 10 TICKETS:
${companyData.recentTickets.map((t: any) => 
  `• #${t.id} | ${t.status.toUpperCase()} | ${t.contactName} | Atendente: ${t.attendantName} | Fila: ${t.queueName}`
).join('\n')}

═══════════════════════════════════════════════════════════════════
📌 INSTRUÇÕES PARA RESPOSTAS
═══════════════════════════════════════════════════════════════════

1. USE OS DADOS ACIMA para responder perguntas sobre a operação.
2. Responda SEMPRE em português brasileiro, de forma clara e objetiva.
3. Use números e estatísticas dos dados fornecidos quando relevante.
4. Para análises, baseie-se nos dados reais apresentados.
5. Se perguntarem sobre algo específico não listado acima, explique que pode fornecer informações sobre os dados disponíveis.
6. Seja proativo em sugerir insights baseados nos dados.
7. Use formatação clara com bullets e números quando apropriado.

CAPACIDADES:
✅ Estatísticas de tickets, mensagens, contatos
✅ Performance de atendentes
✅ Distribuição por filas/setores
✅ Status das conexões WhatsApp
✅ Análises de período (hoje, semana, mês)
✅ Sugestões de melhoria baseadas nos dados`;

  // Construir histórico de conversa
  const contents = [];

  // Sempre adicionar contexto do sistema na primeira mensagem
  if (conversationHistory.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: systemContext }]
    });
    contents.push({
      role: "model",
      parts: [{ text: "Entendido! Sou o assistente de IA da sua empresa e tenho acesso aos dados atualizados do sistema. Estou pronto para ajudar com análises, estatísticas e informações sobre seus atendimentos. O que gostaria de saber?" }]
    });
  } else {
    // Adicionar contexto atualizado mesmo com histórico
    contents.push({
      role: "user",
      parts: [{ text: systemContext }]
    });
    contents.push({
      role: "model",
      parts: [{ text: "Dados atualizados carregados. Continuando nossa conversa..." }]
    });
    
    // Adicionar histórico de conversa existente
    for (const hist of conversationHistory) {
      contents.push({
        role: hist.role === "user" ? "user" : "model",
        parts: [{ text: hist.content }]
      });
    }
  }

  // Adicionar mensagem atual do usuário
  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  try {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

    console.log(`📤 Enviando mensagem para Gemini (${GEMINI_MODEL})...`);
    console.log(`📊 Contexto: ${companyData.stats.total.tickets} tickets, ${companyData.users.length} usuários`);

    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      {
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      },
      {
        timeout: 60000
      }
    );

    const candidates = data?.candidates || [];
    const first = candidates[0];
    const parts = first?.content?.parts || [];
    const text = parts.map((p: any) => p.text).join("\n");

    if (!text) {
      throw new Error("Resposta vazia do Gemini");
    }

    console.log(`✅ Resposta recebida do Gemini (${text.length} caracteres)`);

    return {
      response: text
    };
  } catch (err: any) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    
    console.error("❌ Erro ao chamar Gemini API (Chat):", {
      status,
      data: errorData,
      message: err.message,
      model: GEMINI_MODEL,
      url: err.config?.url
    });
    
    if (status) {
      const userMessage = interpretGeminiError(status, errorData);
      throw new AppError(userMessage, status === 429 ? 429 : status >= 400 && status < 500 ? 400 : 500);
    }
    
    throw new AppError(`Erro no chat: ${err.message || "Erro desconhecido ao comunicar com a API do Gemini"}`, 500);
  }
};

export default ChatGeminiService;

