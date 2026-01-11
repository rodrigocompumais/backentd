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
  const { searchParam, pageNumber } = req.query;

  const whereCondition: any = { companyId };
  
  if (searchParam) {
    whereCondition.name = {
      [Op.iLike]: `%${searchParam}%`
    };
  }

  const limit = 20;
  const offset = pageNumber ? (Number(pageNumber) - 1) * limit : 0;

  const { count, rows: forms } = await Form.findAndCountAll({
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
  });

  const formsWithStats = forms.map((form) => {
    const formData = form.toJSON();
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
    count,
    hasMore: count > offset + limit,
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const form = await Form.findOne({
    where: { id, companyId },
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

  const formData = form.toJSON();
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
    ),
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

  const form = await Form.findOne({
    where: { slug, isActive: true },
    include: [
      {
        association: "fields",
        order: [["order", "ASC"]],
      },
    ],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  return res.json(form);
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
