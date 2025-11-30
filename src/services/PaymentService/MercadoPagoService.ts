import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

// Validar credenciais do Mercado Pago
const validateMercadoPagoCredentials = (): void => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  
  if (!accessToken || accessToken.trim() === "") {
    logger.error("MERCADOPAGO_ACCESS_TOKEN não configurado");
    throw new AppError("Configuração de pagamento incompleta. Entre em contato com o suporte.", 500);
  }

  // Detectar ambiente baseado no token (test tokens geralmente começam com TEST_)
  const isTestToken = accessToken.startsWith("TEST_");
  const isProductionToken = accessToken.startsWith("APP_USR_");
  
  if (process.env.NODE_ENV === "production" && isTestToken) {
    logger.warn("⚠️ ATENÇÃO: Usando credenciais de TESTE em PRODUÇÃO!");
  }
  
  if (process.env.NODE_ENV !== "production" && isProductionToken) {
    logger.warn("⚠️ ATENÇÃO: Usando credenciais de PRODUÇÃO em ambiente de desenvolvimento!");
  }
};

// Traduzir erros do Mercado Pago para mensagens amigáveis
const translateMercadoPagoError = (error: any): string => {
  const errorMessage = error.message || "";
  const errorCause = error.cause?.[0]?.description || error.cause?.[0]?.message || "";
  const fullError = `${errorMessage} ${errorCause}`.trim();

  const errorMessages: Record<string, string> = {
    "Unauthorized use of live credentials": "Erro de configuração do pagamento. Verifique as credenciais do Mercado Pago.",
    "Different parameters for the bin": "Dados do cartão inválidos. Verifique os dados informados e tente novamente.",
    "invalid_card_data": "Dados do cartão inválidos. Verifique os dados informados.",
    "invalid_card_number": "Número do cartão inválido. Verifique e tente novamente.",
    "invalid_security_code": "Código de segurança inválido. Verifique o CVV do cartão.",
    "invalid_expiration_date": "Data de expiração inválida. Verifique a data de validade do cartão.",
    "insufficient_amount": "Saldo insuficiente no cartão.",
    "card_disabled": "Cartão desabilitado. Entre em contato com o banco emissor.",
    "card_error": "Erro ao processar cartão. Tente novamente ou use outro cartão.",
    "invalid_token": "Token do cartão inválido. Por favor, preencha os dados novamente.",
    "expired_token": "Token do cartão expirado. Por favor, preencha os dados novamente.",
  };

  // Procurar por chaves parciais
  for (const [key, message] of Object.entries(errorMessages)) {
    if (fullError.toLowerCase().includes(key.toLowerCase())) {
      return message;
    }
  }

  // Se não encontrou tradução, retornar mensagem genérica ou original
  if (errorCause) {
    return errorCause;
  }
  
  if (errorMessage) {
    return errorMessage;
  }

  return "Erro ao processar pagamento. Por favor, tente novamente ou entre em contato com o suporte.";
};

// Inicializar cliente do Mercado Pago
let client: MercadoPagoConfig;
let payment: Payment;
let preference: Preference;

try {
  validateMercadoPagoCredentials();
  client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
    options: {
      timeout: 5000,
      idempotencyKey: "abc",
    },
  });
  payment = new Payment(client);
  preference = new Preference(client);
} catch (error: any) {
  logger.error("Erro ao inicializar Mercado Pago:", error);
  // Continuar mesmo com erro para não quebrar a aplicação, mas logar o erro
}

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
    [key: string]: any; // Permite campos adicionais para flexibilidade
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
          id: `item-${Date.now()}`,
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
    // Validar credenciais antes de processar
    validateMercadoPagoCredentials();

    // Validar token do cartão
    if (!paymentData.token || paymentData.token.trim() === "") {
      logger.error("Token do cartão vazio ou inválido");
      throw new AppError("Token do cartão inválido. Por favor, preencha os dados novamente.", 400);
    }

    // Validar dados básicos
    if (!paymentData.transactionAmount || paymentData.transactionAmount <= 0) {
      throw new AppError("Valor da transação inválido.", 400);
    }

    if (!paymentData.paymentMethodId) {
      throw new AppError("Método de pagamento não informado.", 400);
    }

    logger.info("Processando pagamento:", {
      transactionAmount: paymentData.transactionAmount,
      paymentMethodId: paymentData.paymentMethodId,
      installments: paymentData.installments,
      hasToken: !!paymentData.token,
      payerEmail: paymentData.payer.email,
    });

    const paymentBody: any = {
      transaction_amount: paymentData.transactionAmount,
      description: paymentData.description,
      payment_method_id: paymentData.paymentMethodId,
      token: paymentData.token,
      installments: paymentData.installments,
      payer: {
        identification: {
          type: paymentData.identificationType,
          number: paymentData.identificationNumber,
        },
        email: paymentData.payer.email,
        first_name: paymentData.payer.firstName || "",
        last_name: paymentData.payer.lastName || "",
      },
      metadata: paymentData.metadata || {},
    };

    // issuer_id precisa ser number ou não ser incluído se não existir
    if (paymentData.issuerId && paymentData.issuerId.trim() !== "") {
      const issuerIdNumber = parseInt(paymentData.issuerId, 10);
      if (!isNaN(issuerIdNumber)) {
        paymentBody.issuer_id = issuerIdNumber;
      }
    }

    const response = await payment.create({ body: paymentBody });

    logger.info("Pagamento processado com sucesso:", {
      paymentId: response.id,
      status: response.status,
      statusDetail: response.status_detail,
    });

    return {
      id: response.id,
      status: response.status,
      statusDetail: response.status_detail,
      transactionAmount: response.transaction_amount,
      dateCreated: response.date_created,
      dateApproved: response.date_approved,
    };
  } catch (error: any) {
    logger.error("Erro ao processar pagamento:", {
      message: error.message,
      cause: error.cause,
      stack: error.stack,
    });
    
    // Traduzir erro para mensagem amigável
    const friendlyMessage = translateMercadoPagoError(error);
    throw new AppError(friendlyMessage, 400);
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

export const createCardToken = async (cardData: {
  cardNumber: string;
  cardholderName: string;
  expirationMonth: string;
  expirationYear: string;
  securityCode: string;
  identificationType: string;
  identificationNumber: string;
}): Promise<any> => {
  try {
    // AVISO: Esta implementação viola PCI DSS pois os dados do cartão passam pelo servidor
    // O ideal é usar Secure Fields no frontend
    
    const tokenData = {
      card_number: cardData.cardNumber.replace(/\s/g, ""),
      cardholder: {
        name: cardData.cardholderName,
        identification: {
          type: cardData.identificationType,
          number: cardData.identificationNumber.replace(/\D/g, ""),
        },
      },
      security_code: cardData.securityCode,
      expiration_month: cardData.expirationMonth,
      expiration_year: `20${cardData.expirationYear}`,
    };

    // Usar API REST do Mercado Pago para criar token
    const response = await fetch("https://api.mercadopago.com/v1/card_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(tokenData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      logger.error("Erro ao criar token:", errorData);
      throw new AppError(
        errorData.message || "Erro ao criar token do cartão",
        400
      );
    }

    const token = await response.json();
    return token;
  } catch (error: any) {
    logger.error("Erro ao criar card token:", error);
    throw new AppError(
      error.message || "Erro ao criar token do cartão",
      400
    );
  }
};

export const getPaymentMethodsByBin = async (bin: string): Promise<any> => {
  try {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payment_methods/card_issuers?bin=${bin}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      logger.warn("Erro ao obter informações do cartão:", await response.text());
      return [];
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    logger.error("Erro ao obter payment methods:", error);
    return [];
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

