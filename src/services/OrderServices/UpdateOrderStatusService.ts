import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import AppError from "../../errors/AppError";
import SendOrderStatusNotificationService from "./SendOrderStatusNotificationService";

const DEFAULT_ORDER_STATUSES = [
  "novo",
  "confirmado",
  "em_preparo",
  "pronto",
  "saiu_entrega",
  "entregue",
  "cancelado",
];

const isValidStatus = (s: string): boolean => {
  if (!s || typeof s !== "string") return false;
  const normalized = s.toLowerCase().trim();
  if (DEFAULT_ORDER_STATUSES.includes(normalized)) return true;
  // Permite estágios customizados: apenas letras, números e underscore
  return /^[a-z0-9_]+$/.test(normalized);
};

interface Request {
  formId: number;
  responseId: number;
  orderStatus: string;
  companyId: number;
}

const UpdateOrderStatusService = async ({
  formId,
  responseId,
  orderStatus,
  companyId,
}: Request): Promise<FormResponse> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formSettings = form.settings as any;
  if (formSettings?.formType !== "cardapio") {
    throw new AppError("ERR_FORM_NOT_MENU", 400);
  }

  const normalizedStatus = orderStatus?.toLowerCase()?.trim();
  if (!isValidStatus(normalizedStatus)) {
    throw new AppError("ERR_INVALID_ORDER_STATUS", 400);
  }

  const response = await FormResponse.findOne({
    where: { id: responseId, formId },
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "form" },
    ],
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ orderStatus: normalizedStatus });

  // Enviar notificação WhatsApp para status pronto, saiu_entrega, entregue
  try {
    await SendOrderStatusNotificationService({
      form,
      response,
      newStatus: normalizedStatus,
    });
  } catch (err) {
    console.error("UpdateOrderStatus: notification error", err);
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "form" },
    ],
  });

  return response;
};

export default UpdateOrderStatusService;
