import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import {
  createPaymentIntent,
  processPayment,
  getPaymentStatus,
  processWebhook,
  validateCardData,
  createCardToken,
  getPaymentMethodsByBin,
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

export const createCardTokenController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const schema = Yup.object().shape({
    cardNumber: Yup.string().required(),
    cardholderName: Yup.string().required(),
    expirationMonth: Yup.string().required(),
    expirationYear: Yup.string().required(),
    securityCode: Yup.string().required(),
    identificationType: Yup.string().required(),
    identificationNumber: Yup.string().required(),
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  try {
    const token = await createCardToken(req.body);
    return res.status(200).json(token);
  } catch (error: any) {
    logger.error("Erro no createCardTokenController:", error);
    throw new AppError(
      error.message || "Erro ao criar token do cartão",
      400
    );
  }
};

export const getPaymentMethodsController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { bin } = req.query;

  if (!bin || typeof bin !== "string") {
    throw new AppError("BIN do cartão é obrigatório", 400);
  }

  try {
    const paymentMethods = await getPaymentMethodsByBin(bin);
    return res.status(200).json(paymentMethods);
  } catch (error: any) {
    logger.error("Erro no getPaymentMethodsController:", error);
    throw new AppError(
      error.message || "Erro ao obter informações do cartão",
      400
    );
  }
};

export const getMercadoPagoDiagnostic = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || "NÃO CONFIGURADO";
    const tokenType = accessToken.startsWith("TEST_") ? "TESTE" : 
                     accessToken.startsWith("APP_USR_") ? "PRODUÇÃO" : "DESCONHECIDO";
    const isProduction = process.env.NODE_ENV === "production";
    
    // Verificar se o cliente foi inicializado (precisa importar do service)
    // Por enquanto, vamos verificar se o token está configurado
    let clientStatus = "não inicializado";
    try {
      if (accessToken !== "NÃO CONFIGURADO") {
        clientStatus = "configurado";
      }
    } catch (e) {
      clientStatus = "erro na inicialização";
    }
    
    const compatibility = {
      valid: (tokenType === "TESTE" && !isProduction) ||
             (tokenType === "PRODUÇÃO" && isProduction),
      warning: tokenType === "PRODUÇÃO" && !isProduction,
      error: tokenType === "TESTE" && isProduction,
    };
    
    const diagnostic = {
      status: clientStatus,
      credentials: {
        type: tokenType,
        prefix: accessToken.substring(0, 15) + "...",
        configured: accessToken !== "NÃO CONFIGURADO",
        length: accessToken.length,
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || "não configurado",
        isProduction,
      },
      compatibility,
      recommendations: [
        ...(compatibility.error ? [
          "ERRO: Credenciais de TESTE em ambiente de PRODUÇÃO. Use credenciais de produção (APP_USR_...) ou altere NODE_ENV."
        ] : []),
        ...(compatibility.warning ? [
          "AVISO: Credenciais de PRODUÇÃO em desenvolvimento. Use credenciais de teste (TEST_...) para desenvolvimento."
        ] : []),
        ...(tokenType === "DESCONHECIDO" ? [
          "ERRO: Formato de token não reconhecido. Deve começar com 'TEST_' ou 'APP_USR_'."
        ] : []),
        ...(accessToken === "NÃO CONFIGURADO" ? [
          "ERRO: MERCADOPAGO_ACCESS_TOKEN não configurado. Configure a variável de ambiente."
        ] : []),
      ],
      timestamp: new Date().toISOString(),
    };
    
    return res.status(200).json(diagnostic);
  } catch (error: any) {
    logger.error("Erro no getMercadoPagoDiagnostic:", error);
    throw new AppError(
      error.message || "Erro ao obter diagnóstico do Mercado Pago",
      500
    );
  }
};

