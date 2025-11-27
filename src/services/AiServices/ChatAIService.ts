import axios from "axios";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";

interface AnalyzeChatParams {
  ticketId: number;
  companyId: number;
  question?: string;
  suggestResponse?: boolean;
}

interface AudioSummaryParams {
  ticketId: number;
  companyId: number;
}

interface AnalyzeChatResponse {
  analysis: string;
  suggestions?: string[];
  keyPoints: string[];
}

interface AudioSummaryResponse {
  summary: string;
  audioCount: number;
  transcripts: Array<{
    messageId: string;
    timestamp: string;
    summary: string;
  }>;
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

// Buscar últimas 20 mensagens do ticket
const fetchLastMessages = async (
  ticketId: number,
  companyId: number
): Promise<any[]> => {
  const messages = await Message.findAll({
    where: {
      ticketId,
      companyId,
      isDeleted: false
    },
    include: [
      "contact"
    ],
    order: [["createdAt", "DESC"]],
    limit: 20,
    raw: false
  });

  return messages.reverse().map((msg: any) => ({
    id: msg.id,
    body: msg.body || "",
    fromMe: msg.fromMe,
    createdAt: formatDateTime(msg.createdAt),
    sender: msg.fromMe ? "ATENDENTE" : "CLIENTE",
    contactName: msg.contact?.name || "Desconhecido",
    mediaType: msg.mediaType,
    mediaUrl: msg.mediaUrl
  }));
};

// Analisar contexto do chat
export const analyzeChatContext = async ({
  ticketId,
  companyId,
  question,
  suggestResponse = false
}: AnalyzeChatParams): Promise<AnalyzeChatResponse> => {
  const apiKey = validateGeminiApiKey(process.env.GEMINI_API_KEY);

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar informações do ticket
  const ticketData = await Ticket.findByPk(ticketId, {
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ]
  });

  // Buscar últimas 20 mensagens
  const messages = await fetchLastMessages(ticketId, companyId);

  if (messages.length === 0) {
    throw new AppError("ERR_NO_MESSAGES_FOUND", 404);
  }

  // Construir contexto das mensagens
  const messagesContext = messages.map((msg, index) => {
    return `[${msg.createdAt}] ${msg.sender} (${msg.contactName}): ${msg.body || "[Mídia]"}`;
  }).join("\n");

  // Construir prompt
  let systemPrompt = `Você é o Compuchat, um assistente de IA especializado em análise de conversas de atendimento.

CONTEXTO DO TICKET:
- Status: ${ticketData.status}
- Contato: ${ticketData.contact?.name || "Desconhecido"}
- Atendente: ${ticketData.user?.name || "Sem atendente"}
- Fila: ${ticketData.queue?.name || "Sem fila"}
- Criado em: ${formatDateTime(ticketData.createdAt)}
- Última atualização: ${formatDateTime(ticketData.updatedAt)}

ÚLTIMAS 20 MENSAGENS DA CONVERSA:
${messagesContext}

INSTRUÇÕES:
${suggestResponse 
  ? `- Analise o contexto da conversa
- Gere 3-5 sugestões de resposta curtas e objetivas que o atendente pode usar
- As sugestões devem ser profissionais, empáticas e diretas
- Foque em resolver o problema do cliente de forma eficiente`
  : question
  ? `- Responda a seguinte pergunta do usuário sobre a conversa: "${question}"
- Seja objetivo e preciso
- Use apenas as informações fornecidas no contexto`
  : `- Analise o contexto da conversa
- Identifique os pontos principais discutidos
- Resuma a situação atual do atendimento
- Destaque informações importantes que o atendente deve saber
- Seja objetivo e conciso`}

FORMATO DE RESPOSTA:
${suggestResponse 
  ? `Retorne APENAS um JSON válido com este formato:
{
  "suggestions": ["sugestão 1", "sugestão 2", "sugestão 3"],
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"]
}`
  : `Retorne APENAS um JSON válido com este formato:
{
  "analysis": "análise detalhada da conversa",
  "keyPoints": ["ponto principal 1", "ponto principal 2", "ponto principal 3"]
}`}`;

  try {
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
          maxOutputTokens: 2048
        }
      },
      {
        timeout: 90000
      }
    );

    const responseText = response.data.candidates[0]?.content?.parts[0]?.text || "";
    
    // Tentar extrair JSON da resposta
    let parsedResponse: any = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        // Se não encontrar JSON, usar resposta completa como análise
        parsedResponse = {
          analysis: responseText,
          keyPoints: []
        };
      }
    } catch (parseError) {
      parsedResponse = {
        analysis: responseText,
        keyPoints: []
      };
    }

    return {
      analysis: parsedResponse.analysis || responseText,
      suggestions: parsedResponse.suggestions || [],
      keyPoints: parsedResponse.keyPoints || []
    };
  } catch (error: any) {
    const status = error.response?.status;
    if (status) {
      const errorMessage = interpretGeminiError(status, error.response?.data);
      throw new AppError(errorMessage, status);
    }
    throw new AppError("Erro ao processar análise do chat", 500);
  }
};

// Resumir áudios não ouvidos
export const summarizeUnreadAudios = async ({
  ticketId,
  companyId
}: AudioSummaryParams): Promise<AudioSummaryResponse> => {
  const apiKey = validateGeminiApiKey(process.env.GEMINI_API_KEY);

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar mensagens de áudio não ouvidas
  const audioMessages = await Message.findAll({
    where: {
      ticketId,
      companyId,
      read: false,
      mediaType: "audio",
      isDeleted: false
    },
    include: [
      "contact"
    ],
    order: [["createdAt", "ASC"]],
    raw: false
  });

  if (audioMessages.length === 0) {
    return {
      summary: "Nenhum áudio não ouvido encontrado neste ticket.",
      audioCount: 0,
      transcripts: []
    };
  }

  // Construir contexto dos áudios
  const audioContext = audioMessages.map((msg: any, index: number) => {
    const timestamp = formatDateTime(msg.createdAt);
    const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
    const contactName = msg.contact?.name || "Desconhecido";
    
    // Se houver transcrição no body, usar. Caso contrário, indicar que precisa transcrição
    const transcript = msg.body && msg.body.trim() 
      ? msg.body 
      : "[Áudio sem transcrição disponível]";
    
    return `ÁUDIO ${index + 1}:
- Data/Hora: ${timestamp}
- Remetente: ${sender} (${contactName})
- Transcrição: ${transcript}`;
  }).join("\n\n");

  const systemPrompt = `Você é o Compuchat, um assistente de IA especializado em resumir conversas de áudio.

CONTEXTO:
Foram recebidos ${audioMessages.length} áudio(s) não ouvido(s) neste ticket de atendimento.

TRANSCRIÇÕES DOS ÁUDIOS:
${audioContext}

INSTRUÇÕES:
- Crie um resumo objetivo e conciso de todos os áudios
- Destaque os pontos principais mencionados em cada áudio
- Organize por ordem cronológica
- Seja claro e direto
- Se algum áudio não tiver transcrição, indique isso no resumo

FORMATO:
Retorne APENAS um JSON válido:
{
  "summary": "resumo completo dos áudios",
  "transcripts": [
    {
      "messageId": "id da mensagem",
      "timestamp": "data/hora",
      "summary": "resumo deste áudio específico"
    }
  ]
}`;

  try {
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
          maxOutputTokens: 2048
        }
      },
      {
        timeout: 90000
      }
    );

    const responseText = response.data.candidates[0]?.content?.parts[0]?.text || "";
    
    // Tentar extrair JSON da resposta
    let parsedResponse: any = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = {
          summary: responseText,
          transcripts: []
        };
      }
    } catch (parseError) {
      parsedResponse = {
        summary: responseText,
        transcripts: []
      };
    }

    // Garantir que temos os IDs corretos nos transcripts
    const transcripts = audioMessages.map((msg: any, index: number) => ({
      messageId: msg.id,
      timestamp: formatDateTime(msg.createdAt),
      summary: parsedResponse.transcripts?.[index]?.summary || `Áudio ${index + 1}`
    }));

    return {
      summary: parsedResponse.summary || responseText,
      audioCount: audioMessages.length,
      transcripts
    };
  } catch (error: any) {
    const status = error.response?.status;
    if (status) {
      const errorMessage = interpretGeminiError(status, error.response?.data);
      throw new AppError(errorMessage, status);
    }
    throw new AppError("Erro ao processar resumo de áudios", 500);
  }
};

