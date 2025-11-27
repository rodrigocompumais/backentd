import express from "express";
import isAuth from "../middleware/isAuth";
import * as AiSummaryController from "../controllers/AiSummaryController";
import * as ChatAIController from "../controllers/ChatAIController";

const routes = express.Router();

routes.post("/ai/summary/agent", isAuth, AiSummaryController.agentSummary);
routes.post("/ai/chat", isAuth, AiSummaryController.chat);
routes.get("/ai/test-key", isAuth, AiSummaryController.testApiKey);

// Rotas para IA no chat
routes.post("/chat-ai/analyze", isAuth, ChatAIController.analyze);
routes.post("/chat-ai/audio-summary", isAuth, ChatAIController.audioSummary);

export default routes;


