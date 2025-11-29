import express from "express";
import * as MercadoPagoController from "../controllers/MercadoPagoController";

const mercadoPagoRoutes = express.Router();

// Criar intenção de pagamento
mercadoPagoRoutes.post(
  "/mercadopago/create-payment-intent",
  MercadoPagoController.createPaymentIntentController
);

// Processar pagamento
mercadoPagoRoutes.post(
  "/mercadopago/process-payment",
  MercadoPagoController.processPaymentController
);

// Webhook do Mercado Pago
mercadoPagoRoutes.post(
  "/mercadopago/webhook",
  MercadoPagoController.webhookController
);

// Consultar status do pagamento
mercadoPagoRoutes.get(
  "/mercadopago/payment-status/:paymentId",
  MercadoPagoController.getPaymentStatusController
);

export default mercadoPagoRoutes;

