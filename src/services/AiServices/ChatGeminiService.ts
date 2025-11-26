import axios from "axios";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import Company from "../../models/Company";

interface ChatGeminiParams {
  companyId: number;
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface ChatGeminiResponse {
  response: string;
}

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

  if (!geminiSetting || !geminiSetting.value) {
    throw new AppError("GEMINI_KEY_MISSING", 400);
  }

  // Buscar informações da empresa para contexto
  const company = await Company.findByPk(companyId);
  
  // Buscar estatísticas básicas para contexto
  const totalTickets = await Ticket.count({ where: { companyId } });
  const totalMessages = await Message.count({ where: { companyId } });
  const totalContacts = await Contact.count({ where: { companyId } });

  const systemContext = `Você é um assistente de IA especializado em ajudar com análises e perguntas sobre a base de dados de uma empresa de atendimento ao cliente.

INFORMAÇÕES DA EMPRESA:
- Nome: ${company?.name || "Não informado"}
- Total de tickets: ${totalTickets}
- Total de mensagens: ${totalMessages}
- Total de contatos: ${totalContacts}

Você pode ajudar com:
- Análises sobre tickets, atendimentos e conversas
- Estatísticas e métricas
- Perguntas sobre a operação de atendimento
- Sugestões de melhoria

Responda sempre em português, de forma clara e objetiva. Se a pergunta for sobre dados específicos que você não tem acesso direto, explique o que seria necessário para obter essa informação.`;

  // Construir histórico de conversa
  const contents = [];

  // Se não há histórico, adicionar contexto do sistema
  if (conversationHistory.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: systemContext + "\n\nPor favor, confirme que entendeu e está pronto para ajudar." }]
    });
  } else {
    // Adicionar histórico de conversa existente
    for (const hist of conversationHistory) {
      contents.push({
        role: hist.role === "user" ? "user" : "model",
        parts: [{ text: hist.content }]
      });
    }
  }

  // Adicionar mensagem atual
  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  try {
    const apiKey = geminiSetting.value.trim();
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      {
        contents: contents
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
      response: text
    };
  } catch (err: any) {
    console.error("Erro ao chamar Gemini API (Chat):", err.response?.data || err.message);
    if (err.response?.status === 400) {
      throw new AppError("GEMINI_API_ERROR", 400);
    }
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new AppError("GEMINI_KEY_INVALID", 401);
    }
    throw new AppError("ERR_GEMINI_CHAT", 500);
  }
};

export default ChatGeminiService;

