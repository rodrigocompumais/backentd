import { Router } from "express";
import * as GupshupWebhookController from "../controllers/GupshupWebhookController";
import { webhookRateLimit } from "../middleware/rateLimiter";

const gupshupWebhookRoutes = Router();

// Rota para receber webhooks da Gupshup
// Esta rota não requer autenticação pois será chamada pela Gupshup
// Aplicar rate limit para proteger contra abuso
gupshupWebhookRoutes.post("/webhook/gupshup", webhookRateLimit, GupshupWebhookController.webhook);

export default gupshupWebhookRoutes;

