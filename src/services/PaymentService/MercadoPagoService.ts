import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
  options: {
    timeout: 5000,
    idempotencyKey: "abc",
  },
});

const payment = new Payment(client);
const preference = new Preference(client);

interface PaymentData {
  transactionAmount: number;
  description: string;
  paymentMethodId: string;
  issuerId?: string;
  token: string;
  installments: number;
  identificationType: string;
  identificationNumber: string;
  payer: {
    email: string;
    firstName?: string;
    lastName?: string;
  };
  metadata?: {
    companyId?: number;
    invoiceId?: number;
    planId?: number;
  };
}

interface PaymentIntentData {
  transactionAmount: number;
  description: string;
  metadata?: {
    companyId?: number;
    invoiceId?: number;
    planId?: number;
  };
}

export const createPaymentIntent = async (
  data: PaymentIntentData
): Promise<any> => {
  try {
    // Criar preferência de pagamento para obter public key e outros dados necessários
    const preferenceData = {
      items: [
        {
          title: data.description,
          quantity: 1,
          unit_price: data.transactionAmount,
        },
      ],
      metadata: data.metadata || {},
      back_urls: {
        success: `${process.env.FRONTEND_URL}/signup/success`,
        failure: `${process.env.FRONTEND_URL}/signup/failure`,
        pending: `${process.env.FRONTEND_URL}/signup/pending`,
      },
      auto_return: "approved",
    };

    const response = await preference.create({ body: preferenceData });

    return {
      preferenceId: response.id,
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY,
      initPoint: response.init_point,
    };
  } catch (error: any) {
    logger.error("Erro ao criar payment intent:", error);
    throw new AppError(
      error.message || "Erro ao criar intenção de pagamento",
      400
    );
  }
};

export const processPayment = async (
  paymentData: PaymentData
): Promise<any> => {
  try {
    const paymentBody = {
      transaction_amount: paymentData.transactionAmount,
      description: paymentData.description,
      payment_method_id: paymentData.paymentMethodId,
      issuer_id: paymentData.issuerId,
      token: paymentData.token,
      installments: paymentData.installments,
      payer: {
        identification: {
          type: paymentData.identificationType,
          number: paymentData.identificationNumber,
        },
        email: paymentData.payer.email,
        first_name: paymentData.payer.firstName,
        last_name: paymentData.payer.lastName,
      },
      metadata: paymentData.metadata || {},
    };

    const response = await payment.create({ body: paymentBody });

    return {
      id: response.id,
      status: response.status,
      statusDetail: response.status_detail,
      transactionAmount: response.transaction_amount,
      dateCreated: response.date_created,
      dateApproved: response.date_approved,
    };
  } catch (error: any) {
    logger.error("Erro ao processar pagamento:", error);
    
    // Extrair mensagem de erro mais amigável
    let errorMessage = "Erro ao processar pagamento";
    if (error.cause && error.cause.length > 0) {
      errorMessage = error.cause[0].description || errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new AppError(errorMessage, 400);
  }
};

export const getPaymentStatus = async (paymentId: string): Promise<any> => {
  try {
    const response = await payment.get({ id: paymentId });

    return {
      id: response.id,
      status: response.status,
      statusDetail: response.status_detail,
      transactionAmount: response.transaction_amount,
      dateCreated: response.date_created,
      dateApproved: response.date_approved,
      metadata: response.metadata,
    };
  } catch (error: any) {
    logger.error("Erro ao consultar status do pagamento:", error);
    throw new AppError(
      error.message || "Erro ao consultar status do pagamento",
      400
    );
  }
};

export const processWebhook = async (data: any): Promise<any> => {
  try {
    // Mercado Pago envia notificações em diferentes formatos
    // Pode vir como { type: "payment", data: { id: "..." } }
    // Ou diretamente como { action: "payment.updated", data: { id: "..." } }
    
    let paymentId: string | null = null;

    if (data.type === "payment" && data.data?.id) {
      paymentId = data.data.id.toString();
    } else if (data.action === "payment.updated" && data.data?.id) {
      paymentId = data.data.id.toString();
    } else if (data.data?.id) {
      paymentId = data.data.id.toString();
    } else if (data.id) {
      paymentId = data.id.toString();
    }

    if (!paymentId) {
      logger.warn("Webhook recebido sem payment ID:", data);
      return null;
    }

    const paymentInfo = await getPaymentStatus(paymentId);

    return {
      paymentId: paymentInfo.id,
      status: paymentInfo.status,
      statusDetail: paymentInfo.statusDetail,
      metadata: paymentInfo.metadata,
    };
  } catch (error: any) {
    logger.error("Erro ao processar webhook:", error);
    throw new AppError(error.message || "Erro ao processar webhook", 400);
  }
};

export const validateCardData = (cardData: any): boolean => {
  // Validação básica da estrutura dos dados do cartão
  if (!cardData.cardNumber || !cardData.cardholderName) {
    return false;
  }

  // Validar número do cartão (remover espaços e traços)
  const cardNumber = cardData.cardNumber.replace(/\s|-/g, "");
  if (cardNumber.length < 13 || cardNumber.length > 19) {
    return false;
  }

  // Validar CVV
  if (!cardData.securityCode || cardData.securityCode.length < 3 || cardData.securityCode.length > 4) {
    return false;
  }

  // Validar data de expiração
  if (!cardData.expirationDate || !cardData.expirationDate.match(/^\d{2}\/\d{2}$/)) {
    return false;
  }

  return true;
};

