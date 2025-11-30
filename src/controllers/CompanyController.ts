import * as Yup from "yup";
import { Request, Response } from "express";
// import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";
import Company from "../models/Company";
import authConfig from "../config/auth";

import ListCompaniesService from "../services/CompanyService/ListCompaniesService";
import CreateCompanyService from "../services/CompanyService/CreateCompanyService";
import UpdateCompanyService from "../services/CompanyService/UpdateCompanyService";
import ShowCompanyService from "../services/CompanyService/ShowCompanyService";
import UpdateSchedulesService from "../services/CompanyService/UpdateSchedulesService";
import DeleteCompanyService from "../services/CompanyService/DeleteCompanyService";
import FindAllCompaniesService from "../services/CompanyService/FindAllCompaniesService";
import { verify } from "jsonwebtoken";
import User from "../models/User";
import ShowPlanCompanyService from "../services/CompanyService/ShowPlanCompanyService";
import ListCompaniesPlanService from "../services/CompanyService/ListCompaniesPlanService";
import CreateCompanyWithPaymentService from "../services/CompanyService/CreateCompanyWithPaymentService";
import { logger } from "../utils/logger";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

interface TokenPayload {
  id: string;
  username: string;
  profile: string;
  companyId: number;
  iat: number;
  exp: number;
}

type CompanyData = {
  name: string;
  id?: number;
  phone?: string;
  email?: string;
  status?: boolean;
  planId?: number;
  campaignsEnabled?: boolean;
  dueDate?: string;
  recurrence?: string;
  password: string;
};

type SchedulesData = {
  schedules: [];
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const { companies, count, hasMore } = await ListCompaniesService({
    searchParam,
    pageNumber
  });

  return res.json({ companies, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const newCompany: CompanyData = req.body;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(newCompany);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const company = await CreateCompanyService(newCompany);

  return res.status(200).json(company);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const company = await ShowCompanyService(id);

  return res.status(200).json(company);
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const companies: Company[] = await FindAllCompaniesService();

  return res.status(200).json(companies);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyData: CompanyData = req.body;

  const schema = Yup.object().shape({
    name: Yup.string()
  });

  try {
    await schema.validate(companyData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { id } = req.params;

  const company = await UpdateCompanyService({ id, ...companyData });

  return res.status(200).json(company);
};

export const updateSchedules = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { schedules }: SchedulesData = req.body;
  const { id } = req.params;

  const company = await UpdateSchedulesService({
    id,
    schedules
  });

  return res.status(200).json(company);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  const company = await DeleteCompanyService(id);

  return res.status(200).json(company);
};

export const listPlan = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const authHeader = req.headers.authorization;
  const [, token] = authHeader.split(" ");
  const decoded = verify(token, authConfig.secret);
  const { id: requestUserId, profile, companyId } = decoded as TokenPayload;
  const requestUser = await User.findByPk(requestUserId);

  if (requestUser.super === true) {
    const company = await ShowPlanCompanyService(id);
    return res.status(200).json(company);
  } else if (companyId.toString() !== id) {
    return res.status(400).json({ error: "Você não possui permissão para acessar este recurso!" });
  } else {
    const company = await ShowPlanCompanyService(id);
    return res.status(200).json(company);
  }

};

export const indexPlan = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const authHeader = req.headers.authorization;
  const [, token] = authHeader.split(" ");
  const decoded = verify(token, authConfig.secret);
  const { id, profile, companyId } = decoded as TokenPayload;
  // const company = await Company.findByPk(companyId);
  const requestUser = await User.findByPk(id);

  if (requestUser.super === true) {
    const companies = await ListCompaniesPlanService();
    return res.json({ companies });
  } else {
    return res.status(400).json({ error: "Você não possui permissão para acessar este recurso!" });
  }

};

export const storeWithPayment = async (req: Request, res: Response): Promise<Response> => {
  logger.info("=== storeWithPayment chamado ===");
  logger.info("Body recebido:", {
    companyName: req.body.companyData?.name,
    companyEmail: req.body.companyData?.email,
    planId: req.body.companyData?.planId,
    transactionAmount: req.body.paymentData?.transactionAmount,
  });
  
  const { companyData, paymentData } = req.body;

  const schema = Yup.object().shape({
    companyData: Yup.object().shape({
      name: Yup.string().required("Nome da empresa é obrigatório"),
      email: Yup.string().email("Email inválido").required("Email é obrigatório"),
      phone: Yup.string().required("Telefone é obrigatório"),
      password: Yup.string().required("Senha é obrigatória"),
      planId: Yup.number().required("Plano é obrigatório"),
    }).required("Dados da empresa são obrigatórios"),
    paymentData: Yup.object().shape({
      transactionAmount: Yup.number().required("Valor da transação é obrigatório").positive("Valor deve ser positivo"),
      paymentMethodId: Yup.string().required("Método de pagamento é obrigatório"),
      token: Yup.string().required("Token do cartão é obrigatório"),
      installments: Yup.number().required("Número de parcelas é obrigatório").min(1, "Mínimo 1 parcela").max(12, "Máximo 12 parcelas"),
      identificationType: Yup.string().required("Tipo de identificação é obrigatório"),
      identificationNumber: Yup.string().required("Número de identificação é obrigatório"),
      payer: Yup.object().shape({
        email: Yup.string().email("Email do pagador inválido").required("Email do pagador é obrigatório"),
        firstName: Yup.string().optional(),
        lastName: Yup.string().optional(),
      }).required("Dados do pagador são obrigatórios"),
      issuerId: Yup.string().optional(),
    }).required("Dados de pagamento são obrigatórios"),
  });

  try {
    await schema.validate(req.body, { abortEarly: false });
    logger.info("✓ Validação do schema passou");
  } catch (err: any) {
    logger.error("✗ Erro na validação do schema:", {
      error: err.message,
      errors: err.inner,
    });
    
    if (err.inner && err.inner.length > 0) {
      const errors = err.inner.map((e: any) => `${e.path}: ${e.message}`).join(", ");
      logger.error("Erros detalhados:", errors);
      throw new AppError(`Erro de validação: ${errors}`, 400);
    }
    
    throw new AppError(err.message || "Erro de validação", 400);
  }

  try {
    logger.info("Iniciando CreateCompanyWithPaymentService...");
    const result = await CreateCompanyWithPaymentService({
      companyData,
      paymentData,
    });

    logger.info("✓ Empresa criada com sucesso:", {
      companyId: result.company.id,
      companyName: result.company.name,
      paymentStatus: result.payment?.status,
      paymentId: result.payment?.id,
      invoiceId: result.invoice.id,
    });

    return res.status(200).json({
      company: result.company,
      payment: result.payment,
      invoice: result.invoice,
      success: result.payment.status === "approved",
    });
  } catch (error: any) {
    logger.error("✗ Erro ao criar empresa com pagamento:", {
      error: error.message,
      statusCode: error.statusCode,
      companyName: companyData?.name,
      companyEmail: companyData?.email,
    });
    
    // Se for um AppError, apenas relançar (já tem mensagem amigável)
    if (error instanceof AppError) {
      throw error;
    }
    
    // Caso contrário, criar um novo AppError com a mensagem do erro
    const errorMessage = error.message || "Erro ao criar empresa com pagamento. Por favor, tente novamente.";
    throw new AppError(errorMessage, error.statusCode || 400);
  }
};