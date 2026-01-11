import { Request, Response } from "express";
import { Op } from "sequelize";
import { getIO } from "../libs/socket";
import XLSX from "xlsx";

import Form from "../models/Form";
import FormResponse from "../models/FormResponse";
import ResponseAnswer from "../models/ResponseAnswer";
import ProcessFormResponseService from "../services/FormServices/ProcessFormResponseService";
import AppError from "../errors/AppError";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;
  const { pageNumber, isRead, isStarred } = req.query;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const whereCondition: any = { formId: Number(formId) };
  
  if (isRead !== undefined) {
    whereCondition.isRead = isRead === "true";
  }
  
  if (isStarred !== undefined) {
    whereCondition.isStarred = isStarred === "true";
  }

  const limit = 20;
  const offset = pageNumber ? (Number(pageNumber) - 1) * limit : 0;

  const { count, rows: responses } = await FormResponse.findAndCountAll({
    where: whereCondition,
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
      {
        association: "contact",
        attributes: ["id", "name", "number", "email"],
      },
      {
        association: "ticket",
        attributes: ["id", "status"],
      },
    ],
    limit,
    offset,
    order: [["submittedAt", "DESC"]],
  });

  return res.json({
    responses,
    count,
    hasMore: count > offset + limit,
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
      {
        association: "contact",
      },
      {
        association: "ticket",
      },
      {
        association: "form",
      },
    ],
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  return res.json(response);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { slug } = req.params;
  const data = req.body;

  // Get form by slug (public endpoint)
  const form = await Form.findOne({
    where: { slug, isActive: true },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const ipAddress = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  const response = await ProcessFormResponseService({
    formId: form.id,
    ...data,
    ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
    userAgent,
  });

  const io = getIO();
  io.to(`company-${form.companyId}-mainchannel`).emit(`company-${form.companyId}-formResponse`, {
    action: "create",
    response,
  });

  return res.status(200).json(response);
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.destroy();

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-formResponse`, {
    action: "delete",
    responseId: Number(id),
  });

  return res.status(200).json({ message: "Response deleted successfully" });
};

export const markAsRead = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ isRead: true });

  return res.status(200).json(response);
};

export const toggleStar = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ isStarred: !response.isStarred });

  return res.status(200).json(response);
};

export const exportData = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const responses = await FormResponse.findAll({
    where: { formId: form.id },
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
    ],
    order: [["submittedAt", "DESC"]],
  });

  // Build Excel data
  const fields = form.fields || [];
  const headers = ["ID", "Nome", "Telefone", "Email", "Data", ...fields.map((f) => f.label)];

  const rows = responses.map((response) => {
    const row: any = {
      ID: response.id,
      Nome: response.responderName || "",
      Telefone: response.responderPhone || "",
      Email: response.responderEmail || "",
      Data: response.submittedAt,
    };

    fields.forEach((field) => {
      const answer = response.answers?.find((a) => a.fieldId === field.id);
      row[field.label] = answer?.answer || "";
    });

    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
  
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="formulario-${form.slug}-${Date.now()}.xlsx"`);

  return res.send(buffer);
};

export const getAnalytics = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const responseCount = await FormResponse.count({
    where: { formId: form.id },
  });

  const responses = await FormResponse.findAll({
    where: { formId: form.id },
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
    ],
  });

  // Group responses by date
  const responsesByDate: { [key: string]: number } = {};
  responses.forEach((response) => {
    const date = new Date(response.submittedAt).toISOString().split("T")[0];
    responsesByDate[date] = (responsesByDate[date] || 0) + 1;
  });

  // Field analytics
  const fieldAnalytics = form.fields?.map((field) => {
    const fieldAnswers = responses
      .flatMap((r) => r.answers || [])
      .filter((a) => a.fieldId === field.id)
      .map((a) => a.answer);

    let analysis: any = {
      fieldId: field.id,
      fieldLabel: field.label,
      fieldType: field.fieldType,
      totalAnswers: fieldAnswers.length,
    };

    if (field.fieldType === "select" || field.fieldType === "radio") {
      // Count occurrences of each option
      const counts: { [key: string]: number } = {};
      fieldAnswers.forEach((answer) => {
        counts[answer] = (counts[answer] || 0) + 1;
      });
      analysis.options = Object.keys(counts).map((option) => ({
        option,
        count: counts[option],
        percentage: fieldAnswers.length > 0 
          ? ((counts[option] / fieldAnswers.length) * 100).toFixed(2)
          : "0",
      }));
    }

    if (field.fieldType === "rating") {
      const ratings = fieldAnswers.map((a) => Number(a)).filter((n) => !isNaN(n));
      if (ratings.length > 0) {
        analysis.average = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2);
        analysis.min = Math.min(...ratings);
        analysis.max = Math.max(...ratings);
      }
    }

    return analysis;
  }) || [];

  return res.json({
    formId: form.id,
    responseCount,
    responsesByDate,
    fieldAnalytics,
  });
};
