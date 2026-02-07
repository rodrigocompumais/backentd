import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import ListMesasService from "../services/MesaServices/ListMesasService";
import CreateMesaService from "../services/MesaServices/CreateMesaService";
import CreateBulkMesasService from "../services/MesaServices/CreateBulkMesasService";
import UpdateMesaService from "../services/MesaServices/UpdateMesaService";
import ShowMesaService from "../services/MesaServices/ShowMesaService";
import OcuparMesaService from "../services/MesaServices/OcuparMesaService";
import LiberarMesaService from "../services/MesaServices/LiberarMesaService";
import DeleteMesaService from "../services/MesaServices/DeleteMesaService";
import { Op } from "sequelize";
import Form from "../models/Form";
import Mesa from "../models/Mesa";
import AppError from "../errors/AppError";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { status, formId, section } = req.query;

  const mesas = await ListMesasService({
    companyId,
    status: status as string,
    formId: formId ? Number(formId) : undefined,
    section: section as string,
  });

  return res.json(mesas);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const mesa = await ShowMesaService({
    mesaId: Number(id),
    companyId,
  });

  return res.json(mesa);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    number: Yup.string().required("Número da mesa é obrigatório"),
    name: Yup.string().nullable(),
    formId: Yup.number().nullable(),
    capacity: Yup.number().nullable(),
    section: Yup.string().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await CreateMesaService({
    ...data,
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "create",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const storeBulk = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { count, prefix, suffix, startFrom, formId } = req.body;

  const schema = Yup.object().shape({
    count: Yup.number().required().min(1).max(50),
    prefix: Yup.string().nullable(),
    suffix: Yup.string().nullable(),
    startFrom: Yup.number().nullable(),
    formId: Yup.number().nullable(),
  });

  try {
    await schema.validate({ count, prefix, suffix, startFrom, formId });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesas = await CreateBulkMesasService({
    companyId,
    count,
    prefix: prefix || "Mesa",
    suffix: suffix || "",
    startFrom: startFrom ?? 1,
    formId: formId ?? null,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "bulkCreate",
    mesas,
  });

  return res.status(200).json(mesas);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    number: Yup.string().nullable(),
    name: Yup.string().nullable(),
    formId: Yup.number().nullable(),
    capacity: Yup.number().nullable(),
    section: Yup.string().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await UpdateMesaService({
    mesaId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "update",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const ocupar = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const { contactId, ticketId } = req.body;

  const schema = Yup.object().shape({
    contactId: Yup.number().required("Contato é obrigatório"),
    ticketId: Yup.number().nullable(),
  });

  try {
    await schema.validate({ contactId, ticketId });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await OcuparMesaService({
    mesaId: Number(id),
    companyId,
    contactId,
    ticketId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "ocupar",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const liberar = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const mesa = await LiberarMesaService({
    mesaId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "liberar",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const destroy = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteMesaService({
    mesaId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "delete",
    mesaId: Number(id),
  });

  return res.status(200).json({ message: "Mesa removida com sucesso" });
};

export const getPublicMesas = async (req: Request, res: Response): Promise<Response> => {
  const { formSlug } = req.params;

  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true },
    attributes: ["id", "companyId"],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const mesas = await Mesa.findAll({
    where: {
      companyId: form.companyId,
      [Op.or]: [{ formId: form.id }, { formId: null }],
    },
    order: [
      ["displayOrder", "ASC"],
      ["number", "ASC"],
    ],
    attributes: ["id", "number", "name", "status", "section"],
  });

  return res.json({ mesas });
};
