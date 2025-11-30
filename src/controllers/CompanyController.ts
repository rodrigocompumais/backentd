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
import { logger } from "../utils/logger";
import { createPaymentIntent } from "../services/PaymentService/MercadoPagoService";
import Plan from "../models/Plan";
import { hash } from "bcryptjs";

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

export const createPaymentPreference = async (req: Request, res: Response): Promise<Response> => {
  logger.info("=== createPaymentPreference chamado ===");
  logger.info("Body recebido:", {
    companyName: req.body.name,
    companyEmail: req.body.email,
    planId: req.body.planId,
  });

  const schema = Yup.object().shape({
    name: Yup.string().required("Nome da empresa é obrigatório"),
    email: Yup.string().email("Email inválido").required("Email é obrigatório"),
    phone: Yup.string().required("Telefone é obrigatório"),
    password: Yup.string().required("Senha é obrigatória"),
    planId: Yup.number().required("Plano é obrigatório"),
    recurrence: Yup.string().optional(),
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
    // Buscar plano para obter valor
    const plan = await Plan.findByPk(req.body.planId);
    if (!plan) {
      throw new AppError("Plano não encontrado", 404);
    }

    // Hash da senha antes de salvar no metadata
    const passwordHash = await hash(req.body.password, 8);

    // Criar preferência de pagamento
    const preference = await createPaymentIntent({
      transactionAmount: plan.value,
      description: `Pagamento plano - ${plan.name}`,
      metadata: {
        companyName: req.body.name,
        companyEmail: req.body.email,
        companyPhone: req.body.phone,
        companyPasswordHash: passwordHash,
        planId: req.body.planId,
        recurrence: req.body.recurrence || "MENSAL",
        campaignsEnabled: true,
      },
      payer: {
        email: req.body.email,
        name: req.body.name,
      },
      notification_url: `${process.env.BACKEND_URL}/mercadopago/webhook`,
    });

    logger.info("✓ Preferência criada com sucesso:", {
      preferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
    });

    return res.status(200).json({
      initPoint: preference.initPoint,
      preferenceId: preference.preferenceId,
    });
  } catch (error: any) {
    logger.error("✗ Erro ao criar preferência de pagamento:", {
      error: error.message,
      statusCode: error.statusCode,
      companyName: req.body?.name,
      companyEmail: req.body?.email,
    });
    
    if (error instanceof AppError) {
      throw error;
    }
    
    const errorMessage = error.message || "Erro ao criar preferência de pagamento. Por favor, tente novamente.";
    throw new AppError(errorMessage, error.statusCode || 400);
  }
};