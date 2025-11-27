import { Request, Response } from "express";
import { analyzeChatContext, summarizeUnreadAudios, improveMessage } from "../services/AiServices/ChatAIService";
import AppError from "../errors/AppError";

export const analyze = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId, question, suggestResponse } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    const result = await analyzeChatContext({
      ticketId: Number(ticketId),
      companyId,
      question,
      suggestResponse: Boolean(suggestResponse)
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao analisar chat:", err);
    
    if (err.message?.includes("GEMINI_KEY")) {
      return res.status(400).json({ error: "GEMINI_KEY_MISSING" });
    }
    
    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao analisar chat"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_ANALYZE",
      message: err.message || "Erro ao analisar chat com IA"
    });
  }
};

export const audioSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    const result = await summarizeUnreadAudios({
      ticketId: Number(ticketId),
      companyId
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao resumir áudios:", err);
    
    if (err.message?.includes("GEMINI_KEY")) {
      return res.status(400).json({ error: "GEMINI_KEY_MISSING" });
    }
    
    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao resumir áudios"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_AUDIO_SUMMARY",
      message: err.message || "Erro ao resumir áudios com IA"
    });
  }
};

export const improve = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId, draftText } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    const result = await improveMessage({
      ticketId: Number(ticketId),
      companyId,
      draftText: draftText || ""
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao melhorar mensagem:", err);
    
    if (err.message?.includes("GEMINI_KEY")) {
      return res.status(400).json({ error: "GEMINI_KEY_MISSING" });
    }
    
    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao melhorar mensagem"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_IMPROVE",
      message: err.message || "Erro ao melhorar mensagem com IA"
    });
  }
};

