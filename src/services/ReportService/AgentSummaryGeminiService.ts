import axios from "axios";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import User from "../../models/User";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";

interface AgentSummaryParams {
  companyId: number;
  agentId?: number; // Agora é opcional
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

  let apiKey: string;
  try {
    apiKey = validateGeminiApiKey(geminiSetting?.value);
  } catch (err: any) {
    throw new AppError(err.message || "GEMINI_KEY_MISSING", 400);
  }

  // Determinar se é resumo de atendente específico ou geral
  const isGeneralSummary = !agentId;
  let agentName = "Todos os Atendentes";
  
  if (agentId) {
    const agent = await User.findByPk(agentId);
    agentName = agent?.name || "Atendente";
  }

  // Montar filtro de tickets
  const ticketWhere: any = {
    companyId
  };

  // Se tiver agentId, filtrar por ele
  if (agentId) {
    ticketWhere.userId = agentId;
  }

  // Filtrar por período se fornecido
  if (dateStart || dateEnd) {
    ticketWhere.createdAt = {};
    if (dateStart) {
      ticketWhere.createdAt[Op.gte] = new Date(`${dateStart} 00:00:00`);
    }
    if (dateEnd) {
      ticketWhere.createdAt[Op.lte] = new Date(`${dateEnd} 23:59:59`);
    }
  }

  // Buscar tickets
  const tickets = await Ticket.findAll({
    where: ticketWhere,
    include: [
      { model: Contact },
      { model: User, attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: 100 // Limitar para não sobrecarregar
  });

  if (!tickets.length) {
    return {
      summary: isGeneralSummary 
        ? "Nenhuma conversa encontrada no período informado."
        : "Nenhuma conversa encontrada para o atendente e período informados.",
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
    const ticketUser: any = anyTicket.user;
    const ticketMessages: Message[] = messagesByTicket[ticket.id] || [];

    if (!ticketMessages.length) {
      continue;
    }

    // Incluir nome do atendente no resumo geral
    const attendantInfo = isGeneralSummary && ticketUser?.name 
      ? ` | Atendente: ${ticketUser.name}` 
      : "";

    lines.push(
      `=== Ticket #${ticket.id} | Contato: ${
        contact?.name || contact?.number || "Desconhecido"
      }${attendantInfo} | Criado em: ${formatDate(ticket.createdAt)} ===`
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

  const summaryType = isGeneralSummary ? "RESUMO GERAL DA OPERAÇÃO" : `RESUMO DO ATENDENTE: ${agentName}`;
  
  const systemPrompt = `Você é um ANALISTA DE QUALIDADE DE ATENDIMENTO especializado em avaliar conversas de suporte ao cliente via WhatsApp.

═══════════════════════════════════════════════════════════════════
📋 SUA MISSÃO: ${summaryType}
═══════════════════════════════════════════════════════════════════
${isGeneralSummary 
  ? "Analise TODAS as conversas da empresa abaixo e produza um RELATÓRIO EXECUTIVO GERAL completo."
  : "Analise as conversas do atendente abaixo e produza um RELATÓRIO EXECUTIVO completo e detalhado."}

═══════════════════════════════════════════════════════════════════
📊 ESTRUTURA DO RELATÓRIO (OBRIGATÓRIA)
═══════════════════════════════════════════════════════════════════

## 1. 📈 RESUMO EXECUTIVO
- Quantidade de atendimentos analisados
- Período coberto
- ${isGeneralSummary ? "Visão geral da operação" : "Avaliação geral (Excelente/Bom/Regular/Precisa Melhorar)"}

## 2. 🎯 PRINCIPAIS DEMANDAS DOS CLIENTES
- Liste os TOP 5 assuntos mais frequentes
- Categorize por tipo (dúvida, reclamação, solicitação, etc.)

## 3. ✅ CASOS RESOLVIDOS
- Quantos foram resolvidos satisfatoriamente
- Exemplos de bons atendimentos (cite ticket e cliente)

## 4. ⚠️ PENDÊNCIAS E FOLLOW-UPS NECESSÁRIOS
- Liste TODOS os casos não resolvidos
- Para cada um, informe: Ticket #, Cliente, ${isGeneralSummary ? "Atendente, " : ""}Problema, Ação necessária
- Ordene por prioridade (Alta/Média/Baixa)

${isGeneralSummary ? `## 5. 👥 DESEMPENHO POR ATENDENTE
- Liste cada atendente com quantidade de atendimentos
- Destaque os melhores desempenhos
- Identifique quem precisa de suporte

## 6. 💪 PONTOS FORTES DA EQUIPE
- Boas práticas identificadas
- Exemplos de excelência no atendimento

## 7. 🔧 OPORTUNIDADES DE MELHORIA
- Aspectos gerais a desenvolver
- Sugestões de treinamento para a equipe
- Processos que podem ser otimizados

## 8. 📌 RECOMENDAÇÕES ESTRATÉGICAS
- Ações imediatas sugeridas
- Insights para a gestão
- Tendências identificadas` 
: `## 5. 💪 PONTOS FORTES DO ATENDENTE
- Habilidades demonstradas
- Boas práticas identificadas
- Exemplos específicos

## 6. 🔧 OPORTUNIDADES DE MELHORIA
- Aspectos a desenvolver
- Sugestões práticas de treinamento
- Situações que poderiam ter sido melhor conduzidas

## 7. 📌 RECOMENDAÇÕES ESTRATÉGICAS
- Ações imediatas sugeridas
- Processos que podem ser otimizados
- Insights para a gestão`}

═══════════════════════════════════════════════════════════════════
⚙️ REGRAS DE ANÁLISE
═══════════════════════════════════════════════════════════════════
1. Seja ESPECÍFICO - cite números de tickets e nomes quando relevante
2. Seja OBJETIVO - baseie-se apenas nos dados fornecidos
3. Seja CONSTRUTIVO - foque em melhorias, não críticas
4. Use FORMATAÇÃO clara com bullets, números e emojis
5. Responda em PORTUGUÊS BRASILEIRO
6. Se houver poucos dados, informe e faça o melhor com o disponível

`;

  // Limitar o tamanho do prompt para evitar exceder limites da API
  const maxPromptLength = 30000; // Limite conservador
  let finalConversationsText = conversationsText;
  if (conversationsText.length > maxPromptLength) {
    finalConversationsText = conversationsText.slice(0, maxPromptLength) + "\n\n[... conteúdo truncado devido ao tamanho ...]";
  }

  const conversationsLabel = isGeneralSummary 
    ? `CONVERSAS DA EMPRESA (até ${maxMessages} mensagens de ${tickets.length} tickets)` 
    : `CONVERSAS DO ATENDENTE ${agentName} (até ${maxMessages} mensagens)`;
  
  const finalPrompt = `${systemPrompt}\n\n${conversationsLabel}:\n\n${finalConversationsText}`;

  try {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

    console.log(`📤 Enviando requisição para Gemini (${GEMINI_MODEL})...`);

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

    console.log(`✅ Resumo gerado com sucesso (${text.length} caracteres)`);

    return {
      summary: text,
      ticketsCount: tickets.length
    };
  } catch (err: any) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    
    console.error("❌ Erro ao chamar Gemini API (Resumo):", {
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
    
    throw new AppError(`Erro ao gerar resumo: ${err.message || "Erro desconhecido ao comunicar com a API do Gemini"}`, 500);
  }
};

export default AgentSummaryGeminiService;


