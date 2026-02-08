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
import ResumoContaMesaService from "../services/MesaServices/ResumoContaMesaService";
import DeleteMesaService from "../services/MesaServices/DeleteMesaService";
import { Op } from "sequelize";
import Form from "../models/Form";
import Mesa from "../models/Mesa";
import AppError from "../errors/AppError";
import { signMesaLink, verifyMesaLink, createOrderToken } from "../helpers/MesaLinkSign";

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

/** Retorna links assinados para QR de todas as mesas da empresa (uso em impressão em lote). */
export const getMesasLinksQr = async (req: Request, res: Response): Promise<Response> => {
  const { formSlug } = req.query;
  const { companyId } = req.user;

  if (!formSlug || typeof formSlug !== "string") {
    throw new AppError("formSlug é obrigatório", 400);
  }

  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true, companyId },
    attributes: ["id", "companyId"],
  });
  if (!form) throw new AppError("ERR_FORM_NOT_FOUND", 404);

  const mesas = await Mesa.findAll({
    where: { companyId },
    attributes: ["id", "number", "name"],
    order: [["displayOrder", "ASC"], ["number", "ASC"], ["id", "ASC"]],
  });

  const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "http://localhost:3000";
  const base = baseUrl.replace(/\/$/, "");

  const items = mesas.map((m) => {
    const token = signMesaLink(formSlug, m.id);
    const url = `${base}/f/${formSlug}?mesa=${m.id}&t=${token}`;
    return {
      mesaId: m.id,
      number: m.number,
      name: m.name,
      label: m.name || m.number || `Mesa ${m.id}`,
      url,
    };
  });

  return res.json({ formSlug, items });
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
  const { contactId, ticketId, transferir } = req.body;

  const schema = Yup.object().shape({
    contactId: Yup.number().required("Contato é obrigatório"),
    ticketId: Yup.number().nullable(),
    transferir: Yup.boolean().nullable(),
  });

  try {
    await schema.validate({ contactId, ticketId, transferir });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await OcuparMesaService({
    mesaId: Number(id),
    companyId,
    contactId,
    ticketId,
    transferir: !!transferir,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "ocupar",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const resumoConta = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const resumo = await ResumoContaMesaService(Number(id), companyId);
  return res.status(200).json(resumo);
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

/** Lista mesas da empresa para o cardápio público. Não filtra por formId: todas as mesas da empresa. */
export const getPublicMesas = async (req: Request, res: Response): Promise<Response> => {
  const { formSlug } = req.params;

  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true },
    attributes: ["companyId"],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const mesas = await Mesa.findAll({
    where: { companyId: form.companyId },
    order: [
      ["displayOrder", "ASC"],
      ["number", "ASC"],
    ],
    attributes: ["id", "number", "name", "status", "section"],
  });

  return res.json({ mesas });
};

/** Gera link assinado para QR da mesa (impede alteração de mesa/empresa na URL). */
export const getMesaLinkQr = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { formSlug } = req.query;
  const { companyId } = req.user;

  if (!formSlug || typeof formSlug !== "string") {
    throw new AppError("formSlug é obrigatório", 400);
  }

  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true, companyId },
    attributes: ["id", "companyId"],
  });
  if (!form) throw new AppError("ERR_FORM_NOT_FOUND", 404);

  const mesa = await Mesa.findOne({
    where: { id: Number(id), companyId },
    attributes: ["id", "number", "name"],
  });
  if (!mesa) throw new AppError("ERR_MESA_NOT_FOUND", 404);

  const token = signMesaLink(formSlug, mesa.id);
  const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "http://localhost:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/f/${formSlug}?mesa=${mesa.id}&t=${token}`;

  return res.json({ url, token });
};

/** Mesa por ID para cardápio público (QR da mesa): exige token assinado (t=); retorna orderToken para o submit. */
export const getPublicMesaById = async (req: Request, res: Response): Promise<Response> => {
  const { formSlug, mesaId } = req.params;
  const tokenFromQuery = (req.query.t as string) || "";

  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true },
    attributes: ["id", "companyId"],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const mesaIdNum = Number(mesaId);
  if (!Number.isFinite(mesaIdNum)) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (process.env.MESA_LINK_SECRET) {
    if (!verifyMesaLink(formSlug, mesaIdNum, tokenFromQuery)) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
  }

  const mesa = await Mesa.findOne({
    where: {
      id: mesaIdNum,
      companyId: form.companyId,
    },
    include: [
      { association: "contact", attributes: ["id", "name", "number"], required: false },
    ],
    attributes: ["id", "number", "name", "status", "section"],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  const plain = mesa.get({ plain: true }) as any;
  const orderToken = createOrderToken(form.id, mesa.id);
  const payload = {
    id: plain.id,
    number: plain.number,
    name: plain.name,
    status: plain.status,
    section: plain.section,
    contact: plain.contact ? { name: plain.contact.name, number: plain.contact.number } : null,
    orderToken,
  };

  return res.json(payload);
};
