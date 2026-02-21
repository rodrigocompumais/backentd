import express from "express";
import * as MercadoPagoController from "../controllers/MercadoPagoController";
import { webhookRateLimit } from "../middleware/rateLimiter";

const mercadoPagoRoutes = express.Router();

// Criar intenção de pagamento
mercadoPagoRoutes.post(
  "/mercadopago/create-payment-intent",
  MercadoPagoController.createPaymentIntentController
);

// Webhook do Mercado Pago - Aplicar rate limit para proteger contra abuso
mercadoPagoRoutes.post(
  "/mercadopago/webhook",
  webhookRateLimit,
  MercadoPagoController.webhookController
);

// Consultar status do pagamento
mercadoPagoRoutes.get(
  "/mercadopago/payment-status/:paymentId",
  MercadoPagoController.getPaymentStatusController
);

// Consultar status da preferência (para verificar pagamentos PIX)
mercadoPagoRoutes.get(
  "/mercadopago/preference-status/:preferenceId",
  MercadoPagoController.getPreferenceStatusController
);

mercadoPagoRoutes.get(
  "/diagnostic/mercadopago",
  MercadoPagoController.getMercadoPagoDiagnostic
);

export default mercadoPagoRoutes;

