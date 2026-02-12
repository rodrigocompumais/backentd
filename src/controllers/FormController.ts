import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { Op } from "sequelize";

import Form from "../models/Form";
import FormField from "../models/FormField";
import FormResponse from "../models/FormResponse";
import CreateFormService from "../services/FormServices/CreateFormService";
import UpdateFormService from "../services/FormServices/UpdateFormService";
import DeleteFormService from "../services/FormServices/DeleteFormService";
import AppError from "../errors/AppError";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { searchParam, pageNumber, formType } = req.query;

  const whereCondition: any = { companyId };
  
  if (searchParam) {
    whereCondition.name = {
      [Op.iLike]: `%${searchParam}%`
    };
  }

  const isCardapioOnly = formType === "cardapio";
  const isAgendamentoOnly = formType === "agendamento";
  const limit = isCardapioOnly || isAgendamentoOnly ? 100 : 20;
  const offset = pageNumber ? (Number(pageNumber) - 1) * limit : 0;

  const findOptions: any = {
    where: whereCondition,
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
      {
        association: "responses",
        attributes: ["id"],
        required: false,
      },
    ],
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  };
  const { count, rows: formsRaw } = await Form.findAndCountAll(findOptions);
  const forms = isCardapioOnly
    ? formsRaw.filter((f) => (f.settings as any)?.formType === "cardapio")
    : isAgendamentoOnly
    ? formsRaw.filter((f) => (f.settings as any)?.formType === "agendamento")
    : formsRaw;

  const formsWithStats = forms.map((form) => {
    const formData: any = form.toJSON();
    // Sort fields by order manually if needed
    if (formData.fields) {
      formData.fields.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    }
    return {
      ...formData,
      responseCount: formData.responses?.length || 0,
    };
  });

  return res.json({
    forms: formsWithStats,
    count: isCardapioOnly || isAgendamentoOnly ? formsWithStats.length : count,
    hasMore: isCardapioOnly || isAgendamentoOnly ? false : count > offset + limit,
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  // Validate that id is a number
  const formId = Number(id);
  if (isNaN(formId)) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
      {
        association: "creator",
        attributes: ["id", "name"],
      },
    ],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = form.toJSON();
  // Sort fields by order manually if needed
  if (formData.fields) {
    formData.fields.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }

  return res.json(formData);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    name: Yup.string().required(),
    fields: Yup.array().of(
      Yup.object().shape({
        label: Yup.string().required(),
        fieldType: Yup.string().required(),
        order: Yup.number().required(),
      })
    ).nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const form = await CreateFormService({
    ...data,
    companyId,
    createdBy: userId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "create",
    form,
  });

  return res.status(200).json(form);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const data = req.body;

  const form = await UpdateFormService({
    formId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "update",
    form,
  });

  return res.status(200).json(form);
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteFormService({
    formId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "delete",
    formId: Number(id),
  });

  return res.status(200).json({ message: "Form deleted successfully" });
};

export const duplicate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId, id: userId } = req.user;

  const originalForm = await Form.findOne({
    where: { id, companyId },
    include: [{ association: "fields" }],
  });

  if (!originalForm) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = originalForm.toJSON();
  delete formData.id;
  delete formData.createdAt;
  delete formData.updatedAt;
  delete formData.slug;

  const newForm = await CreateFormService({
    ...formData,
    name: `${formData.name} (Cópia)`,
    companyId,
    createdBy: Number(userId) || 0,
    fields: formData.fields?.map((f: any) => {
      const fieldData = { ...f };
      delete fieldData.id;
      delete fieldData.formId;
      delete fieldData.createdAt;
      delete fieldData.updatedAt;
      return fieldData;
    }) || [],
  });

  return res.status(200).json(newForm);
};

export const getPublicForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { slug } = req.params;

  console.log(`[PublicForm] Buscando formulário com slug: ${slug}`);

  const form = await Form.findOne({
    where: { slug, isActive: true },
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
    ],
  });

  if (!form) {
    console.log(`[PublicForm] Formulário não encontrado: ${slug}`);
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = form.toJSON();
  console.log(`[PublicForm] Formulário encontrado: ${formData.name} (${formData.fields?.length || 0} campos)`);
  return res.json(formData);
};

export const getStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const form = await Form.findOne({
    where: { id, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const responseCount = await FormResponse.count({
    where: { formId: form.id },
  });

  return res.json({
    formId: form.id,
    responseCount,
  });
};

/** Export form as JSON template (without ids, companyId, etc.) */
export const exportForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const form = await Form.findOne({
    where: { id: Number(id), companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = form.toJSON();
  const exportData = {
    name: formData.name,
    description: formData.description,
    primaryColor: formData.primaryColor,
    secondaryColor: formData.secondaryColor,
    logoPosition: formData.logoPosition,
    logoUrl: formData.logoUrl,
    successMessage: formData.successMessage,
    successRedirectUrl: formData.successRedirectUrl,
    requireAuth: formData.requireAuth,
    allowMultipleSubmissions: formData.allowMultipleSubmissions,
    isAnonymous: formData.isAnonymous,
    createContact: formData.createContact,
    createTicket: formData.createTicket,
    sendWebhook: formData.sendWebhook,
    webhookUrl: formData.webhookUrl,
    settings: formData.settings,
    fields: (formData.fields || []).map((f: any) => {
      const { id: _id, formId: _formId, createdAt: _c, updatedAt: _u, ...field } = f;
      return field;
    }),
    exportedAt: new Date().toISOString(),
    version: 1,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="form-${formData.name.replace(/[^a-z0-9]/gi, "-")}.json"`);
  return res.json(exportData);
};

/** Import form from JSON template */
export const importForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const data = req.body;

  if (!data || !data.name) {
    throw new AppError("ERR_FORM_IMPORT_INVALID", 400);
  }

  const form = await CreateFormService({
    name: data.name,
    description: data.description,
    companyId,
    createdBy: Number(userId),
    isImport: true,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    logoPosition: data.logoPosition,
    logoUrl: data.logoUrl,
    successMessage: data.successMessage,
    successRedirectUrl: data.successRedirectUrl,
    requireAuth: data.requireAuth,
    allowMultipleSubmissions: data.allowMultipleSubmissions,
    isAnonymous: data.isAnonymous,
    createContact: data.createContact,
    createTicket: data.createTicket,
    sendWebhook: data.sendWebhook,
    webhookUrl: data.webhookUrl,
    settings: data.settings,
    fields: data.fields || [],
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "create",
    form,
  });

  return res.status(201).json(form);
};
