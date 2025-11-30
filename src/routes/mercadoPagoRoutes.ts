import express from "express";
import * as MercadoPagoController from "../controllers/MercadoPagoController";
import { validateMercadoPago } from "../middleware/validateMercadoPago";

const mercadoPagoRoutes = express.Router();

// Criar intenção de pagamento
mercadoPagoRoutes.post(
  "/mercadopago/create-payment-intent",
  MercadoPagoController.createPaymentIntentController
);

// Processar pagamento (com validação de credenciais)
mercadoPagoRoutes.post(
  "/mercadopago/process-payment",
  validateMercadoPago,
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

// Criar token do cartão (AVISO: viola PCI DSS)
mercadoPagoRoutes.post(
  "/mercadopago/create-card-token",
  MercadoPagoController.createCardTokenController
);

// Obter informações do cartão por BIN
mercadoPagoRoutes.get(
  "/mercadopago/payment-methods",
  MercadoPagoController.getPaymentMethodsController
);

mercadoPagoRoutes.get(
  "/diagnostic/mercadopago",
  MercadoPagoController.getMercadoPagoDiagnostic
);

export default mercadoPagoRoutes;

