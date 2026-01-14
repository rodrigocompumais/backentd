import { Op, fn, col, literal } from "sequelize";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import Company from "../../models/Company";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { AIProviderSelector } from "./AIProviderSelector";
import { ChatMessage } from "./AIProviderInterface";

interface ChatGeminiParams {
  companyId: number;
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface ChatGeminiResponse {
  response: string;
}

interface DetectedEntities {
  attendantNames: string[];
  contactNames: string[];
  period: "today" | "yesterday" | "week" | "month" | "all";
  matchedUsers: Array<{ id: number; name: string }>;
  matchedContacts: Array<{ id: number; name: string; number: string }>;
}

// Função para formatar data/hora
const formatDateTime = (date: Date | string): string => {
  const d = new Date(date);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

// Função para detectar entidades na pergunta do usuário
const detectEntitiesInQuestion = async (
  question: string,
  companyId: number
): Promise<DetectedEntities> => {
  const questionLower = question.toLowerCase();
  
  // Detectar período mencionado
  let period: DetectedEntities["period"] = "week";
  if (questionLower.includes("hoje") || questionLower.includes("agora")) {
    period = "today";
  } else if (questionLower.includes("ontem")) {
    period = "yesterday";
  } else if (questionLower.includes("semana") || questionLower.includes("7 dias")) {
    period = "week";
  } else if (questionLower.includes("mês") || questionLower.includes("mes") || questionLower.includes("30 dias")) {
    period = "month";
  }

  // Buscar todos os usuários da empresa
  const users = await User.findAll({
    where: { companyId },
    attributes: ["id", "name"],
    raw: true
  }) as Array<{ id: number; name: string }>;

  // Buscar contatos mencionados
  const contacts = await Contact.findAll({
    where: { companyId },
    attributes: ["id", "name", "number"],
    raw: true
  }) as Array<{ id: number; name: string; number: string }>;

  // Detectar nomes de atendentes na pergunta
  const matchedUsers: Array<{ id: number; name: string }> = [];
  const attendantNames: string[] = [];
  
  for (const user of users) {
    const userName = user.name.toLowerCase();
    const nameParts = userName.split(" ");
    
    // Verificar nome completo ou partes do nome
    if (questionLower.includes(userName)) {
      matchedUsers.push(user);
      attendantNames.push(user.name);
    } else {
      // Verificar primeiro nome ou sobrenome (mínimo 3 caracteres)
      for (const part of nameParts) {
        if (part.length >= 3 && questionLower.includes(part)) {
          matchedUsers.push(user);
          attendantNames.push(user.name);
          break;
        }
      }
    }
  }

  // Detectar nomes de contatos na pergunta
  const matchedContacts: Array<{ id: number; name: string; number: string }> = [];
  const contactNames: string[] = [];
  
  for (const contact of contacts) {
    if (!contact.name) continue;
    const contactName = contact.name.toLowerCase();
    const nameParts = contactName.split(" ");
    
    if (questionLower.includes(contactName)) {
      matchedContacts.push(contact);
      contactNames.push(contact.name);
    } else {
      for (const part of nameParts) {
        if (part.length >= 3 && questionLower.includes(part)) {
          matchedContacts.push(contact);
          contactNames.push(contact.name);
          break;
        }
      }
    }
  }

  return {
    attendantNames,
    contactNames,
    period,
    matchedUsers,
    matchedContacts
  };
};

// Função para calcular datas do período
const getPeriodDates = (period: DetectedEntities["period"]): { start: Date; end: Date } => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getTime());

  switch (period) {
    case "today":
      return { start: today, end };
    case "yesterday":
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday, end: today };
    case "week":
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { start: weekAgo, end };
    case "month":
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { start: monthAgo, end };
    default:
      const defaultStart = new Date(today);
      defaultStart.setDate(defaultStart.getDate() - 7);
      return { start: defaultStart, end };
  }
};

// Função para buscar tickets com mensagens detalhadas
const fetchTicketsWithMessages = async (
  companyId: number,
  period: DetectedEntities["period"],
  userId?: number,
  contactId?: number,
  limit: number = 100
): Promise<any[]> => {
  const { start, end } = getPeriodDates(period);
  
  const whereClause: any = {
    companyId,
    [Op.or]: [
      { createdAt: { [Op.gte]: start, [Op.lte]: end } },
      { updatedAt: { [Op.gte]: start, [Op.lte]: end } }
    ]
  };

  if (userId) {
    whereClause.userId = userId;
  }

  if (contactId) {
    whereClause.contactId = contactId;
  }

  const tickets = await Ticket.findAll({
    where: whereClause,
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]],
    limit
  });

  // Buscar mensagens para cada ticket
  const ticketsWithMessages = await Promise.all(
    tickets.map(async (ticket: any) => {
      const messages = await Message.findAll({
        where: {
          ticketId: ticket.id,
          companyId,
          createdAt: { 
            [Op.gte]: start,
            [Op.lte]: end
          }
        },
        order: [["createdAt", "ASC"]],
        limit: 50,
        raw: true
      });

      return {
        id: ticket.id,
        status: ticket.status,
        contact: {
          id: ticket.contact?.id,
          name: ticket.contact?.name || "Desconhecido",
          number: ticket.contact?.number || ""
        },
        attendant: {
          id: ticket.user?.id,
          name: ticket.user?.name || "Sem atendente"
        },
        queue: ticket.queue?.name || "Sem fila",
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        messagesCount: messages.length,
        messages: messages.map((msg: any) => ({
          id: msg.id,
          body: (msg.body || "").slice(0, 500),
          fromMe: msg.fromMe,
          createdAt: msg.createdAt,
          sender: msg.fromMe ? "ATENDENTE" : "CLIENTE"
        }))
      };
    })
  );

  return ticketsWithMessages;
};

// Função para buscar dados específicos de um atendente
const fetchUserSpecificData = async (
  companyId: number,
  userId: number,
  userName: string,
  period: DetectedEntities["period"]
): Promise<string> => {
  const { start, end } = getPeriodDates(period);
  const periodLabel = period === "today" ? "HOJE" : 
                      period === "yesterday" ? "ONTEM" :
                      period === "week" ? "ÚLTIMOS 7 DIAS" : "ÚLTIMOS 30 DIAS";

  // Buscar todos os tickets do atendente no período
  const tickets = await fetchTicketsWithMessages(companyId, period, userId, undefined, 50);

  if (tickets.length === 0) {
    return `\n📋 ATENDIMENTOS DE ${userName.toUpperCase()} (${periodLabel}):\n• Nenhum atendimento encontrado no período.\n`;
  }

  let output = `\n═══════════════════════════════════════════════════════════════════
📋 ATENDIMENTOS DETALHADOS DE ${userName.toUpperCase()} (${periodLabel})
Total de atendimentos: ${tickets.length}
═══════════════════════════════════════════════════════════════════\n`;

  for (const ticket of tickets) {
    output += `\n▶ TICKET #${ticket.id} | Status: ${ticket.status.toUpperCase()}
   Cliente: ${ticket.contact.name} (${ticket.contact.number})
   Fila: ${ticket.queue}
   Criado: ${formatDateTime(ticket.createdAt)}
   Atualizado: ${formatDateTime(ticket.updatedAt)}
   Total de mensagens: ${ticket.messagesCount}\n`;

    if (ticket.messages.length > 0) {
      output += `   --- CONVERSAS ---\n`;
      for (const msg of ticket.messages.slice(0, 20)) {
        const sender = msg.fromMe ? "🧑‍💼 ATENDENTE" : "👤 CLIENTE";
        const time = formatDateTime(msg.createdAt);
        const body = msg.body.replace(/\n/g, " ").slice(0, 200);
        output += `   [${time}] ${sender}: ${body}\n`;
      }
      if (ticket.messages.length > 20) {
        output += `   ... +${ticket.messages.length - 20} mensagens adicionais\n`;
      }
    }
    output += `   ─────────────────────────────────────\n`;
  }

  return output;
};

// Função para buscar dados completos da empresa
const fetchCompanyData = async (companyId: number, period: DetectedEntities["period"] = "week") => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { start: periodStart } = getPeriodDates(period);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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
    where: { companyId, createdAt: { [Op.gte]: last7Days } }
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

  // Tickets por atendente (período)
  const ticketsByUser = await Ticket.findAll({
    where: { 
      companyId, 
      userId: { [Op.ne]: null },
      createdAt: { [Op.gte]: periodStart }
    },
    attributes: [
      "userId",
      [fn("COUNT", col("id")), "total"]
    ],
    group: ["userId"],
    raw: true
  }) as any[];

  // Tickets HOJE por atendente
  const ticketsTodayByUser = await Ticket.findAll({
    where: { 
      companyId, 
      userId: { [Op.ne]: null },
      createdAt: { [Op.gte]: today }
    },
    attributes: [
      "userId",
      [fn("COUNT", col("id")), "total"]
    ],
    group: ["userId"],
    raw: true
  }) as any[];

  // Mapear tickets por usuário
  const userTicketStats = users.map((user: any) => {
    const periodStat = ticketsByUser.find((s: any) => s.userId === user.id);
    const todayStat = ticketsTodayByUser.find((s: any) => s.userId === user.id);
    return {
      userId: user.id,
      userName: user.name,
      ticketsPeriod: periodStat ? parseInt(periodStat.total, 10) : 0,
      ticketsToday: todayStat ? parseInt(todayStat.total, 10) : 0
    };
  }).sort((a, b) => b.ticketsPeriod - a.ticketsPeriod);

  // Buscar filas
  const queues = await Queue.findAll({
    where: { companyId },
    attributes: ["id", "name", "color"],
    raw: true
  });

  // Tickets por fila
  const ticketsByQueue = await Ticket.findAll({
    where: { 
      companyId, 
      queueId: { [Op.ne]: null },
      createdAt: { [Op.gte]: periodStart }
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

  // Buscar tickets da semana com detalhes básicos
  const weekTickets = await fetchTicketsWithMessages(companyId, "week", undefined, undefined, 100);

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
    weekTickets
  };
};

const ChatGeminiService = async ({
  companyId,
  message,
  conversationHistory = []
}: ChatGeminiParams): Promise<ChatGeminiResponse> => {
  // Selecionar provider usando configuração automática
  const provider = await AIProviderSelector.getProvider(companyId, "chat");

  // Detectar entidades na pergunta do usuário
  const entities = await detectEntitiesInQuestion(message, companyId);
  console.log(`🔍 Entidades detectadas:`, {
    atendentes: entities.attendantNames,
    contatos: entities.contactNames,
    periodo: entities.period
  });

  // Buscar dados completos da empresa
  const companyData = await fetchCompanyData(companyId, entities.period);

  // Preparar dados específicos se detectou atendente ou contato na pergunta
  let specificData = "";
  
  // Buscar dados específicos dos atendentes mencionados
  for (const user of entities.matchedUsers) {
    specificData += await fetchUserSpecificData(companyId, user.id, user.name, entities.period);
  }

  // Buscar tickets de contatos específicos mencionados
  if (entities.matchedContacts.length > 0) {
    for (const contact of entities.matchedContacts) {
      const contactTickets = await fetchTicketsWithMessages(
        companyId, 
        entities.period, 
        undefined, 
        contact.id, 
        20
      );
      
      if (contactTickets.length > 0) {
        specificData += `\n═══════════════════════════════════════════════════════════════════
📋 ATENDIMENTOS DO CONTATO: ${contact.name} (${contact.number})
Total: ${contactTickets.length} tickets
═══════════════════════════════════════════════════════════════════\n`;
        
        for (const ticket of contactTickets) {
          specificData += `\n▶ TICKET #${ticket.id} | Status: ${ticket.status.toUpperCase()}
   Atendente: ${ticket.attendant.name}
   Fila: ${ticket.queue}
   Criado: ${formatDateTime(ticket.createdAt)}
   Mensagens: ${ticket.messagesCount}\n`;
          
          if (ticket.messages.length > 0) {
            specificData += `   --- CONVERSAS ---\n`;
            for (const msg of ticket.messages.slice(0, 15)) {
              const sender = msg.fromMe ? "🧑‍💼 ATENDENTE" : "👤 CLIENTE";
              const time = formatDateTime(msg.createdAt);
              const body = msg.body.replace(/\n/g, " ").slice(0, 200);
              specificData += `   [${time}] ${sender}: ${body}\n`;
            }
          }
        }
      }
    }
  }

  // Gerar lista de tickets da semana para o contexto
  const weekTicketsList = companyData.weekTickets.slice(0, 50).map((t: any) => 
    `#${t.id} | ${t.status} | ${t.contact.name} | Atendente: ${t.attendant.name} | ${formatDateTime(t.updatedAt)} | Msgs: ${t.messagesCount}`
  ).join('\n');

  const systemContext = `Você é um ASSISTENTE DE IA ESPECIALIZADO para a empresa "${companyData.company}". Você tem ACESSO TOTAL E COMPLETO aos dados do sistema de atendimento ao cliente via WhatsApp.

═══════════════════════════════════════════════════════════════════
📊 ESTATÍSTICAS GERAIS (TEMPO REAL)
═══════════════════════════════════════════════════════════════════

📈 TOTAIS GERAIS:
• Total de Tickets (histórico): ${companyData.stats.total.tickets}
• Total de Mensagens: ${companyData.stats.total.messages}
• Total de Contatos: ${companyData.stats.total.contacts}

📋 TICKETS POR STATUS (AGORA):
• Abertos (em atendimento): ${companyData.stats.ticketsByStatus.open}
• Pendentes (aguardando): ${companyData.stats.ticketsByStatus.pending}
• Fechados: ${companyData.stats.ticketsByStatus.closed}

📅 ATIVIDADE:
• Tickets HOJE: ${companyData.stats.period.ticketsToday}
• Tickets últimos 7 DIAS: ${companyData.stats.period.ticketsWeek}
• Mensagens HOJE: ${companyData.stats.period.messagesToday}

═══════════════════════════════════════════════════════════════════
👥 EQUIPE DE ATENDENTES (${companyData.users.length} usuários)
═══════════════════════════════════════════════════════════════════
${companyData.userTicketStats.map((s: any) => 
  `• ${s.userName}: ${s.ticketsToday} tickets HOJE | ${s.ticketsPeriod} na semana`
).join('\n') || '• Nenhum atendente cadastrado'}

═══════════════════════════════════════════════════════════════════
📁 FILAS/SETORES
═══════════════════════════════════════════════════════════════════
${companyData.queueStats.length > 0
  ? companyData.queueStats.map((s: any) => `• ${s.queueName}: ${s.ticketsCount} tickets`).join('\n')
  : '• Nenhuma fila cadastrada'}

═══════════════════════════════════════════════════════════════════
📱 CONEXÕES WHATSAPP
═══════════════════════════════════════════════════════════════════
${companyData.whatsapps.map((w: any) => 
  `• ${w.name} - Status: ${w.status}${w.isDefault ? ' (Principal)' : ''}`
).join('\n') || '• Nenhuma conexão'}

═══════════════════════════════════════════════════════════════════
📋 TICKETS DOS ÚLTIMOS 7 DIAS (${companyData.weekTickets.length} tickets)
═══════════════════════════════════════════════════════════════════
${weekTicketsList || '• Nenhum ticket no período'}

${specificData}

═══════════════════════════════════════════════════════════════════
⚠️ INSTRUÇÕES IMPORTANTES - LEIA COM ATENÇÃO
═══════════════════════════════════════════════════════════════════

1. VOCÊ TEM ACESSO COMPLETO aos dados acima. USE-OS para responder.
2. Quando perguntarem sobre um ATENDENTE específico, verifique a seção "ATENDIMENTOS DETALHADOS DE [NOME]" acima.
3. Quando perguntarem sobre um CONTATO/CLIENTE, verifique a seção "ATENDIMENTOS DO CONTATO" acima.
4. Quando perguntarem "com quem conversou", liste TODOS os contatos/clientes dos tickets do atendente.
5. Responda SEMPRE com DADOS CONCRETOS - nomes, números de ticket, datas, horários.
6. NUNCA diga "não tenho acesso" se os dados estiverem listados acima.
7. Se um atendente não teve atendimentos no período, informe isso claramente.
8. Responda em português brasileiro, de forma clara e direta.

VOCÊ PODE RESPONDER SOBRE:
✅ Quem cada atendente atendeu (hoje, semana, etc)
✅ Conversas completas de cada atendimento
✅ Conteúdo das mensagens trocadas
✅ Estatísticas por atendente, fila, período
✅ Status de tickets e conexões
✅ Qualquer dado listado acima`;

  // Construir histórico de conversa no formato da interface
  const chatMessages: ChatMessage[] = [];

  // Sempre adicionar contexto do sistema na primeira mensagem
  if (conversationHistory.length === 0) {
    chatMessages.push({
      role: "system",
      content: systemContext
    });
    chatMessages.push({
      role: "assistant",
      content: "Entendido! Tenho acesso completo aos dados do sistema. Posso informar sobre atendimentos, conversas, estatísticas de cada atendente e muito mais. O que você gostaria de saber?"
    });
  } else {
    // Adicionar contexto atualizado mesmo com histórico
    chatMessages.push({
      role: "system",
      content: systemContext
    });
    chatMessages.push({
      role: "assistant",
      content: "Dados atualizados. Continuando..."
    });
    
    // Adicionar histórico de conversa existente
    for (const hist of conversationHistory) {
      chatMessages.push({
        role: hist.role === "user" ? "user" : "assistant",
        content: hist.content
      });
    }
  }

  // Adicionar mensagem atual do usuário
  chatMessages.push({
    role: "user",
    content: message
  });

  try {
    console.log(`📤 Enviando mensagem para ${provider.name}...`);
    console.log(`📊 Contexto: ${companyData.stats.total.tickets} tickets, ${companyData.users.length} usuários`);
    if (entities.matchedUsers.length > 0) {
      console.log(`👤 Atendentes detectados: ${entities.matchedUsers.map(u => u.name).join(", ")}`);
    }

    // Usar o provider selecionado para realizar o chat
    const text = await provider.chat(chatMessages, {
      temperature: 0.3,
      maxTokens: 4096,
      topP: 0.95
    });

    if (!text || text.trim() === "") {
      throw new AppError("Resposta vazia da IA", 500);
    }

    console.log(`✅ Resposta recebida do ${provider.name} (${text.length} caracteres)`);

    return {
      response: text.trim()
    };
  } catch (err: any) {
    console.error(`❌ Erro ao chamar ${provider.name} API (Chat):`, {
      message: err.message
    });
    
    if (err instanceof AppError) {
      throw err;
    }
    
    throw new AppError(`Erro no chat: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export default ChatGeminiService;

