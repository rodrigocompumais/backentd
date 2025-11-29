import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import {
  createPaymentIntent,
  processPayment,
  getPaymentStatus,
  processWebhook,
  validateCardData,
} from "../services/PaymentService/MercadoPagoService";
import { logger } from "../utils/logger";
import Company from "../models/Company";
import Invoices from "../models/Invoices";
import { getIO } from "../libs/socket";
import moment from "moment";

export const createPaymentIntentController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const schema = Yup.object().shape({
    transactionAmount: Yup.number().required().positive(),
    description: Yup.string().required(),
    metadata: Yup.object().optional(),
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  try {
    const paymentIntent = await createPaymentIntent(req.body);
    return res.status(200).json(paymentIntent);
  } catch (error: any) {
    logger.error("Erro no createPaymentIntentController:", error);
    throw new AppError(
      error.message || "Erro ao criar intenção de pagamento",
      400
    );
  }
};

export const processPaymentController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const schema = Yup.object().shape({
    transactionAmount: Yup.number().required().positive(),
    description: Yup.string().required(),
    paymentMethodId: Yup.string().required(),
    token: Yup.string().required(),
    installments: Yup.number().required().min(1).max(12),
    identificationType: Yup.string().required(),
    identificationNumber: Yup.string().required(),
    payer: Yup.object().shape({
      email: Yup.string().email().required(),
      firstName: Yup.string().optional(),
      lastName: Yup.string().optional(),
    }).required(),
    metadata: Yup.object().optional(),
    issuerId: Yup.string().optional(),
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  // Validar dados do cartão
  if (!validateCardData(req.body)) {
    throw new AppError("Dados do cartão inválidos", 400);
  }

  try {
    const paymentResult = await processPayment(req.body);
    return res.status(200).json(paymentResult);
  } catch (error: any) {
    logger.error("Erro no processPaymentController:", error);
    throw new AppError(
      error.message || "Erro ao processar pagamento",
      400
    );
  }
};

export const webhookController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    // Validar assinatura do webhook se configurado
    if (process.env.MERCADOPAGO_WEBHOOK_SECRET) {
      // Implementar validação de assinatura se necessário
      // const signature = req.headers["x-signature"];
      // if (!validateWebhookSignature(signature, req.body)) {
      //   throw new AppError("Assinatura inválida", 401);
      // }
    }

    const webhookData = await processWebhook(req.body);

    if (webhookData && webhookData.metadata) {
      const { companyId, invoiceId } = webhookData.metadata;

      if (companyId && invoiceId) {
        const company = await Company.findByPk(companyId);
        const invoice = await Invoices.findByPk(invoiceId);

        if (company && invoice) {
          // Atualizar invoice e company conforme status
          if (webhookData.status === "approved") {
            // Ativar empresa e atualizar dueDate
            const newDueDate = moment().add(30, "days").format();
            await company.update({
              status: true,
              dueDate: newDueDate,
            });

            await invoice.update({
              status: "paid",
            });

            // Emitir evento via Socket.IO
            const io = getIO();
            io.to(`company-${companyId}-mainchannel`).emit(
              `company-${companyId}-payment`,
              {
                action: "approved",
                company: await company.reload(),
                payment: webhookData,
              }
            );

            logger.info(
              `Pagamento aprovado - Empresa ${companyId} ativada via webhook`
            );
          } else if (webhookData.status === "rejected") {
            await invoice.update({
              status: "rejected",
            });

            logger.warn(`Pagamento rejeitado - Invoice ${invoiceId}`);
          } else if (webhookData.status === "pending") {
            await invoice.update({
              status: "pending",
            });
          }
        }
      }
    }

    return res.status(200).json({ received: true, data: webhookData });
  } catch (error: any) {
    logger.error("Erro no webhookController:", error);
    // Retornar 200 mesmo em caso de erro para o MP não reenviar
    return res.status(200).json({ received: true, error: error.message });
  }
};

export const getPaymentStatusController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { paymentId } = req.params;

  if (!paymentId) {
    throw new AppError("Payment ID é obrigatório", 400);
  }

  try {
    const paymentStatus = await getPaymentStatus(paymentId);
    return res.status(200).json(paymentStatus);
  } catch (error: any) {
    logger.error("Erro no getPaymentStatusController:", error);
    throw new AppError(
      error.message || "Erro ao consultar status do pagamento",
      400
    );
  }
};

