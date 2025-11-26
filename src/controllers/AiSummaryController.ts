import { Request, Response } from "express";
import AgentSummaryGeminiService from "../services/ReportService/AgentSummaryGeminiService";

export const agentSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { agentId, dateStart, dateEnd, maxMessages } = req.body;

  const agentIdNumber = Number(agentId);

  const summary = await AgentSummaryGeminiService({
    companyId,
    agentId: agentIdNumber,
    dateStart,
    dateEnd,
    maxMessages
  });

  return res.status(200).json(summary);
};


