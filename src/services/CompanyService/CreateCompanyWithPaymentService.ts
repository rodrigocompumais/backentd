import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import CreateCompanyService from "./CreateCompanyService";
import CreateInvoiceService from "../InvoicesService/CreateInvoiceService";
import { processPayment } from "../PaymentService/MercadoPagoService";
import { getIO } from "../../libs/socket";
import moment from "moment";
import { logger } from "../../utils/logger";

interface CompanyData {
  name: string;
  phone?: string;
  email?: string;
  password?: string;
  status?: boolean;
  planId?: number;
  campaignsEnabled?: boolean;
  recurrence?: string;
}

interface PaymentData {
  transactionAmount: number;
  paymentMethodId: string;
  token: string;
  installments: number;
  identificationType: string;
  identificationNumber: string;
  payer: {
    email: string;
    firstName?: string;
    lastName?: string;
  };
  issuerId?: string;
}

interface CreateCompanyWithPaymentData {
  companyData: CompanyData;
  paymentData: PaymentData;
}

const CreateCompanyWithPaymentService = async (
  data: CreateCompanyWithPaymentData
): Promise<{ company: Company; payment: any; invoice: any }> => {
  const { companyData, paymentData } = data;

  // Validar se o plano existe
  if (companyData.planId) {
    const plan = await Plan.findByPk(companyData.planId);
    if (!plan) {
      throw new AppError("Plano não encontrado", 404);
    }

    // Validar se o valor do pagamento corresponde ao valor do plano
    if (paymentData.transactionAmount !== plan.value) {
      throw new AppError("Valor do pagamento não corresponde ao valor do plano", 400);
    }
  }

  // Criar empresa com dueDate de 30 dias (não 7, pois está pagando)
  const company = await CreateCompanyService({
    ...companyData,
    dueDate: moment().add(30, "days").format(),
    status: false, // Inicialmente inativa até pagamento ser aprovado
  });

  // Criar invoice com status pending
  const invoice = await CreateInvoiceService({
    detail: `Plano ${companyData.planId ? (await Plan.findByPk(companyData.planId))?.name : "N/A"}`,
    value: paymentData.transactionAmount,
    companyId: company.id,
    status: "pending",
  });

  // Processar pagamento
  let paymentResult;
  try {
    paymentResult = await processPayment({
      ...paymentData,
      description: `Pagamento plano - ${company.name}`,
      metadata: {
        companyId: company.id,
        invoiceId: invoice.id,
        planId: companyData.planId,
      },
    });

    // Atualizar invoice com o ID do pagamento
    await invoice.update({
      detail: `${invoice.detail} - Payment ID: ${paymentResult.id}`,
    });

    // Se pagamento aprovado, ativar empresa
    if (paymentResult.status === "approved") {
      await company.update({
        status: true,
        dueDate: moment().add(30, "days").format(),
      });

      await invoice.update({
        status: "paid",
      });

      // Emitir evento via Socket.IO
      const io = getIO();
      io.to(`company-${company.id}-mainchannel`).emit(
        `company-${company.id}-payment`,
        {
          action: "approved",
          company,
          payment: paymentResult,
        }
      );

      logger.info(`Empresa ${company.id} ativada após pagamento aprovado`);
    } else if (paymentResult.status === "rejected") {
      await invoice.update({
        status: "rejected",
      });
    } else if (paymentResult.status === "pending") {
      // Manter invoice como pending
      // O webhook vai atualizar quando o pagamento for confirmado
    }
  } catch (error: any) {
    logger.error("Erro ao processar pagamento:", error);
    
    // Atualizar invoice com status de erro
    await invoice.update({
      status: "error",
    });

    throw new AppError(
      error.message || "Erro ao processar pagamento. Empresa criada mas não ativada.",
      400
    );
  }

  return {
    company,
    payment: paymentResult,
    invoice,
  };
};

export default CreateCompanyWithPaymentService;

