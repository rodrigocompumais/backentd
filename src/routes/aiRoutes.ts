import express from "express";
import isAuth from "../middleware/isAuth";
import validateGeminiApiKey from "../middleware/validateGeminiApiKey";
import * as AiSummaryController from "../controllers/AiSummaryController";
import * as ChatAIController from "../controllers/ChatAIController";
import * as CampaignAIController from "../controllers/CampaignAIController";

const routes = express.Router();

// Rota de teste da API key não precisa de validação (ela mesma valida)
routes.get("/ai/test-key", isAuth, AiSummaryController.testApiKey);

// Todas as outras rotas de IA precisam validar a API key antes de acessar
routes.post("/ai/summary/agent", isAuth, validateGeminiApiKey, AiSummaryController.agentSummary);
routes.post("/ai/chat", isAuth, validateGeminiApiKey, AiSummaryController.chat);

// Rotas para IA no chat
routes.post("/chat-ai/analyze", isAuth, validateGeminiApiKey, ChatAIController.analyze);
routes.post("/chat-ai/audio-summary", isAuth, validateGeminiApiKey, ChatAIController.audioSummary);
routes.post("/chat-ai/improve", isAuth, validateGeminiApiKey, ChatAIController.improve);
routes.post("/chat-ai/transcribe/:messageId", isAuth, validateGeminiApiKey, ChatAIController.transcribe);

// Rotas para IA em campanhas
routes.post("/ai/campaign/initial", isAuth, validateGeminiApiKey, CampaignAIController.generateCampaignInitialMessage);
routes.post("/ai/campaign/variations", isAuth, validateGeminiApiKey, CampaignAIController.generateCampaignVariations);

export default routes;


