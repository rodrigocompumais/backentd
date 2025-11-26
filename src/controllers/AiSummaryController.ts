import { Request, Response } from "express";
import AgentSummaryGeminiService from "../services/ReportService/AgentSummaryGeminiService";
import ChatGeminiService from "../services/AiServices/ChatGeminiService";

export const agentSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { agentId, dateStart, dateEnd, maxMessages } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "agentId é obrigatório" });
    }

    const agentIdNumber = Number(agentId);

    if (isNaN(agentIdNumber)) {
      return res.status(400).json({ error: "agentId inválido" });
    }

    const summary = await AgentSummaryGeminiService({
      companyId,
      agentId: agentIdNumber,
      dateStart,
      dateEnd,
      maxMessages
    });

    return res.status(200).json(summary);
  } catch (err: any) {
    console.error("Erro ao gerar resumo IA:", err);
    
    if (err.message === "GEMINI_KEY_MISSING") {
      return res.status(400).json({ error: "GEMINI_KEY_MISSING" });
    }
    
    return res.status(500).json({ 
      error: "ERR_GEMINI_SUMMARY",
      message: err.message || "Erro ao gerar resumo com IA"
    });
  }
};

export const chat = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { message, conversationHistory } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Mensagem é obrigatória" });
    }

    const response = await ChatGeminiService({
      companyId,
      message: message.trim(),
      conversationHistory: conversationHistory || []
    });

    return res.status(200).json(response);
  } catch (err: any) {
    console.error("Erro no chat IA:", err);
    
    if (err.message === "GEMINI_KEY_MISSING") {
      return res.status(400).json({ error: "GEMINI_KEY_MISSING" });
    }
    
    return res.status(500).json({ 
      error: "ERR_GEMINI_CHAT",
      message: err.message || "Erro ao processar mensagem com IA"
    });
  }
};


