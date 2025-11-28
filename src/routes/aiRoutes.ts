import express from "express";
import isAuth from "../middleware/isAuth";
import * as AiSummaryController from "../controllers/AiSummaryController";
import * as ChatAIController from "../controllers/ChatAIController";
import * as CampaignAIController from "../controllers/CampaignAIController";

const routes = express.Router();

routes.post("/ai/summary/agent", isAuth, AiSummaryController.agentSummary);
routes.post("/ai/chat", isAuth, AiSummaryController.chat);
routes.get("/ai/test-key", isAuth, AiSummaryController.testApiKey);

// Rotas para IA no chat
routes.post("/chat-ai/analyze", isAuth, ChatAIController.analyze);
routes.post("/chat-ai/audio-summary", isAuth, ChatAIController.audioSummary);
routes.post("/chat-ai/improve", isAuth, ChatAIController.improve);

// Rotas para IA em campanhas
routes.post("/ai/campaign/initial", isAuth, CampaignAIController.generateCampaignInitialMessage);
routes.post("/ai/campaign/variations", isAuth, CampaignAIController.generateCampaignVariations);

export default routes;


