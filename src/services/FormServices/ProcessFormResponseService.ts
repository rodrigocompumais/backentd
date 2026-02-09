import { Op } from "sequelize";
import Form from "../../models/Form";
import FormField from "../../models/FormField";
import FormResponse from "../../models/FormResponse";
import ResponseAnswer from "../../models/ResponseAnswer";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateTicketService from "../TicketServices/CreateTicketService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import FormatMenuOrderMessage from "./FormatMenuOrderMessage";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import AppError from "../../errors/AppError";
import PrintDevice from "../../models/PrintDevice";
import CreateAndDispatchPrintJobService from "../PrintJobService/CreateAndDispatchPrintJobService";
import OcuparMesaService from "../MesaServices/OcuparMesaService";
import Mesa from "../../models/Mesa";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { verifyOrderToken, createDeliveryScanToken } from "../../helpers/MesaLinkSign";

interface Answer {
  fieldId: number;
  answer: string | string[];
  answerData?: object;
  fileUrl?: string;
}

interface Request {
  formId: number;
  answers: Answer[];
  quotationItems?: object[];
  menuItems?: Array<{
    productId: number;
    quantity: number;
    productName?: string;
    productValue?: number;
    grupo?: string;
  }>;
  responderPhone?: string;
  responderEmail?: string;
  responderName?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: object;
  /** Token de sessão da mesa (retornado ao abrir link assinado). Garante que o pedido vá para a mesa correta. */
  orderToken?: string;
}

const ProcessFormResponseService = async ({
  formId,
  answers,
  quotationItems,
  menuItems,
  responderPhone,
  responderEmail,
  responderName,
  ipAddress,
  userAgent,
  metadata,
  orderToken,
}: Request): Promise<FormResponse> => {
  // Load form with fields
  const form = await Form.findByPk(formId, {
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

  if (!form.isActive) {
    throw new AppError("ERR_FORM_INACTIVE", 400);
  }

  // Validate required fields
  const fields = form.fields || [];
  const requiredFields = fields.filter((f) => f.isRequired);
  
  for (const field of requiredFields) {
    const answer = answers.find((a) => a.fieldId === field.id);
    if (!answer || !answer.answer || 
        (Array.isArray(answer.answer) && answer.answer.length === 0)) {
      throw new AppError(`ERR_FIELD_REQUIRED: ${field.label}`, 400);
    }
  }

  // Extract contact info from answers
  let contactName = responderName || "";
  let contactPhone = responderPhone || "";
  let contactEmail = responderEmail || "";

  const toStr = (v: unknown): string =>
    v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);

  // Try to find name, phone, email in form fields
  for (const answer of answers) {
    const field = fields.find((f) => f.id === answer.fieldId);
    if (field) {
      const fieldMetadata = field.metadata as any;
      const val = toStr(answer.answer).trim();
      if (fieldMetadata?.autoFieldType === "supplierName" || (field.fieldType === "text" && field.label.toLowerCase().includes("nome do fornecedor"))) {
        if (val) contactName = val;
      } else if (fieldMetadata?.autoFieldType === "name" || (field.fieldType === "text" && field.label.toLowerCase().includes("nome"))) {
        if (val) contactName = val;
      }
      if (fieldMetadata?.autoFieldType === "phone" || field.fieldType === "phone") {
        if (val) contactPhone = val;
      }
      if (field.fieldType === "email") {
        if (val) contactEmail = val;
      }
    }
  }

  // Normalizar telefone: só dígitos, garantir 55 para Brasil se tiver 10+ dígitos
  if (contactPhone) {
    const digits = contactPhone.replace(/\D/g, "");
    if (digits.length >= 10) {
      contactPhone = digits.startsWith("55") ? digits : "55" + digits;
    }
  }

  // Check if form is quotation or menu type and process items
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  const isMenuForm = formSettings?.formType === "cardapio";
  
  // Prepare metadata with quotationItems or menuItems if applicable
  const responseMetadata: any = metadata || {};
  if (isQuotationForm && quotationItems && quotationItems.length > 0) {
    responseMetadata.quotationItems = quotationItems;
    console.log("ProcessFormResponseService: Saving quotationItems:", quotationItems);
  } else if (isQuotationForm) {
    console.log("ProcessFormResponseService: Form is quotation but no quotationItems received");
  }
  
  if (isMenuForm && menuItems && menuItems.length > 0) {
    responseMetadata.menuItems = menuItems;
    console.log("ProcessFormResponseService: Saving menuItems:", menuItems);
  } else if (isMenuForm) {
    console.log("ProcessFormResponseService: Form is menu but no menuItems received");
  }

  // Create FormResponse (orderStatus "novo" for menu/cardapio forms)
  const createPayload: any = {
    formId: form.id,
    responderPhone: contactPhone,
    responderEmail: contactEmail,
    responderName: contactName,
    ipAddress,
    userAgent,
    metadata: responseMetadata,
  };
  if (isMenuForm) {
    // Mesa: pedido pelo garçom → confirmado; pedido direto pelo QR da mesa → novo
    const orderType = (responseMetadata.orderType ?? (metadata as any)?.orderType) as string | undefined;
    const placedByGarcom = !!(responseMetadata.garcomName ?? responseMetadata.placedByGarcom ?? (metadata as any)?.placedByGarcom);
    if (orderType === "mesa" && placedByGarcom) {
      createPayload.orderStatus = "confirmado";
    } else {
      createPayload.orderStatus = "novo";
    }
    // Gerar protocolo único PED-YYYYMMDD-NNNN por empresa/dia
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const count = await FormResponse.count({
      include: [
        {
          model: Form,
          as: "form",
          required: true,
          where: { companyId: form.companyId },
          attributes: [],
        },
      ],
      where: {
        submittedAt: { [Op.between]: [startOfDay, endOfDay] } as any,
      },
    });
    createPayload.protocol = `PED-${dateStr}-${String(count + 1).padStart(4, "0")}`;
  }
  const response = await FormResponse.create(createPayload);

  // Pedido delivery: gerar token único para QR do entregador
  if (isMenuForm && responseMetadata.orderType === "delivery") {
    const scanToken = createDeliveryScanToken(form.companyId, form.id, response.id);
    const updatedMeta = { ...(response.metadata as object || {}), deliveryScanToken: scanToken };
    await response.update({ metadata: updatedMeta });
  }

  // Create ResponseAnswers
  const answersToCreate = answers.map((answer) => ({
    responseId: response.id,
    fieldId: answer.fieldId,
    answer: Array.isArray(answer.answer) 
      ? answer.answer.join(", ") 
      : String(answer.answer),
    answerData: answer.answerData || { value: answer.answer },
    fileUrl: answer.fileUrl,
  }));

  await ResponseAnswer.bulkCreate(answersToCreate);

  let contact = null;
  let ticket = null;

  let tableId = (metadata as any)?.tableId ?? (responseMetadata as any)?.tableId;
  if (orderToken) {
    const decoded = verifyOrderToken(orderToken);
    if (!decoded || decoded.formId !== form.id) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
    tableId = decoded.mesaId;
  }

  // Reutilizar contact/ticket da mesa quando pedido é para mesa já ocupada (ex.: Garçom adiciona pedido)
  if (isMenuForm && tableId != null) {
    const mesaIdNum = typeof tableId === "string" ? parseInt(tableId, 10) : Number(tableId);
    if (!Number.isNaN(mesaIdNum)) {
      const mesa = await Mesa.findOne({
        where: { id: mesaIdNum, companyId: form.companyId },
      });
      if (mesa && mesa.status === "ocupada" && mesa.contactId) {
        contact = await Contact.findOne({
          where: { id: mesa.contactId, companyId: form.companyId },
        });
        if (contact) {
          ticket = mesa.ticketId
            ? await Ticket.findOne({ where: { id: mesa.ticketId, companyId: form.companyId } })
            : null;
          const updatePayload: { contactId: number; ticketId?: number | null; mesaSessionId?: string } = {
            contactId: contact.id,
            ticketId: ticket?.id ?? null,
          };
          if (mesa.sessionId) updatePayload.mesaSessionId = mesa.sessionId;
          await response.update(updatePayload);
        }
      }
    }
  }

  // Create/Update Contact if configured
  if (form.createContact && contactPhone && !contact) {
    try {
      contact = await CreateOrUpdateContactService({
        name: contactName || "Sem nome",
        number: contactPhone,
        email: contactEmail,
        isGroup: false,
        companyId: form.companyId,
      });
      
      await response.update({ contactId: contact.id });
    } catch (err) {
      console.error("Error creating contact from form:", err);
    }
  }

  // Create Ticket if configured
  if (form.createTicket && contact && !ticket) {
    try {
      // Use form creator as userId, or 0 if not set (ticket will be unassigned)
      const userId = form.createdBy || 0;
      ticket = await CreateTicketService({
        contactId: contact.id,
        status: "pending",
        userId,
        companyId: form.companyId,
      });
      
      await response.update({ ticketId: ticket.id });
    } catch (err) {
      console.error("Error creating ticket from form:", err);
    }
  }

  // Para cardápio com mesa: garantir contact antes do auto-ocupar (mesmo se createContact estiver desligado)
  if (isMenuForm && tableId != null && !contact && contactPhone) {
    try {
      contact = await CreateOrUpdateContactService({
        name: contactName || "Sem nome",
        number: contactPhone,
        email: contactEmail,
        isGroup: false,
        companyId: form.companyId,
      });
      await response.update({ contactId: contact.id });
      if (form.createTicket) {
        const userId = form.createdBy || 0;
        ticket = await CreateTicketService({
          contactId: contact.id,
          status: "pending",
          userId,
          companyId: form.companyId,
        });
        await response.update({ ticketId: ticket.id });
      }
    } catch (err) {
      console.error("Error ensuring contact for mesa auto-occupy:", err);
    }
  }

  // Auto-ocupação de mesa: quando cliente pede via cardápio com mesa livre (?mesa=X)
  if (tableId != null && contact) {
    try {
      const mesaId = typeof tableId === "string" ? parseInt(tableId, 10) : Number(tableId);
      if (!Number.isNaN(mesaId)) {
        const mesa = await Mesa.findOne({
          where: { id: mesaId, companyId: form.companyId },
        });
        if (mesa && mesa.status === "livre") {
          const mesaOcupada = await OcuparMesaService({
            mesaId: mesa.id,
            companyId: form.companyId,
            contactId: contact.id,
            ticketId: ticket?.id,
          });
          const updatedMeta = { ...(response.metadata as object || {}), tableNumber: mesa.name || mesa.number };
          await response.update({
            metadata: updatedMeta,
            ...(mesaOcupada.sessionId && { mesaSessionId: mesaOcupada.sessionId }),
          });
        }
      }
    } catch (err: any) {
      // Não quebrar o fluxo se mesa já ocupada ou outro erro
      console.warn("ProcessFormResponseService - Auto-ocupar mesa:", err?.message || err);
    }
  }

  // Create print job for menu form if print device configured
  if (isMenuForm && menuItems && menuItems.length > 0) {
    try {
      const formSettings = form.settings as any;
      const printDeviceId = formSettings?.printDeviceId;

      if (printDeviceId) {
        const printDevice = await PrintDevice.findOne({
          where: { id: printDeviceId, companyId: form.companyId }
        });

        if (printDevice) {
          // Para pedido delivery, recarregar response para ter metadata.deliveryScanToken atualizado
          let meta = (response.metadata || metadata || {}) as Record<string, unknown>;
          if (meta?.orderType === "delivery") {
            const fresh = await FormResponse.findByPk(response.id, { attributes: ["metadata"] });
            if (fresh?.metadata) meta = fresh.metadata as Record<string, unknown>;
            let scanToken = meta?.deliveryScanToken as string | undefined;
            if (!scanToken) {
              scanToken = createDeliveryScanToken(form.companyId, form.id, response.id);
              await response.update({
                metadata: { ...meta, deliveryScanToken: scanToken },
              });
              meta = { ...meta, deliveryScanToken: scanToken };
            }
          }
          const tableNumber = (meta?.tableNumber as string) || "";
          const garcomName = (meta?.garcomName as string) || "";
          const conteudo: Record<string, unknown> = {
            event: "form.submitted",
            formId: form.id,
            formName: form.name,
            responseId: response.id,
            protocol: response.protocol,
            submittedAt: response.submittedAt,
            tableNumber,
            garcomName,
            responder: {
              name: contactName,
              phone: contactPhone,
              email: contactEmail,
            },
            answers: answers.map((answer) => {
              const field = fields.find((f) => f.id === answer.fieldId);
              return {
                fieldId: answer.fieldId,
                label: field?.label || "",
                answer: answer.answer,
              };
            }),
            menuItems,
          };
          if (meta?.orderType === "delivery" && meta?.deliveryScanToken) {
            const token = meta.deliveryScanToken as string;
            conteudo.deliveryScanToken = token;
            const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "";
            if (baseUrl) {
              conteudo.deliveryScanUrl = `${baseUrl.replace(/\/$/, "")}/entregador?t=${encodeURIComponent(token)}`;
            }
          }

          await CreateAndDispatchPrintJobService({
            companyId: form.companyId,
            deviceId: printDevice.deviceId,
            formId: form.id,
            formResponseId: response.id,
            conteudo,
          });
        }
      }
    } catch (err) {
      console.error("Error creating print job:", err);
    }
  }

  // Process menu form: send WhatsApp message to customer em segundo plano (não bloqueia a resposta)
  console.log("ProcessFormResponseService - Checking menu form:", {
    isMenuForm,
    menuItemsCount: menuItems?.length || 0,
    contactPhone: contactPhone ? "present" : "missing",
  });

  if (isMenuForm && menuItems && menuItems.length > 0 && contactPhone) {
    (async () => {
      try {
        console.log("ProcessFormResponseService (background) - Starting WhatsApp send");
        const formSettings = form.settings as any;
        const selectedWhatsappId = formSettings?.whatsappId;
        let whatsappToUse;
        if (selectedWhatsappId) {
          const Whatsapp = (await import("../../models/Whatsapp")).default;
          whatsappToUse = await Whatsapp.findOne({
            where: { id: selectedWhatsappId, companyId: form.companyId, status: "CONNECTED" },
          });
          if (!whatsappToUse) whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        } else {
          whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        }
        if (!whatsappToUse) {
          console.warn("ProcessFormResponseService (background) - Nenhuma conexão WhatsApp disponível");
          return;
        }
        let contactForSend = contact;
        if (!contactForSend && contactPhone) {
          contactForSend = await CreateOrUpdateContactService({
            name: contactName || "Sem nome",
            number: contactPhone,
            email: contactEmail,
            isGroup: false,
            companyId: form.companyId,
          });
        }
        if (!contactForSend) return;
        const ticket = await FindOrCreateTicketService(
          contactForSend,
          whatsappToUse.id,
          0,
          form.companyId
        );
        const customFields = answers
          .map((answer) => {
            const field = fields.find((f) => f.id === answer.fieldId);
            if (field) {
              const fieldMetadata = field.metadata as any;
              if (
                fieldMetadata?.autoFieldType === "name" ||
                fieldMetadata?.autoFieldType === "phone" ||
                field.fieldType === "phone"
              ) return null;
              return {
                label: field.label,
                answer: typeof answer.answer === "string" ? answer.answer : String(answer.answer),
              };
            }
            return null;
          })
          .filter((f): f is { label: string; answer: string } => f !== null);
        const meta = (response.metadata || metadata || {}) as Record<string, unknown>;
        const tableNumberMsg = (meta?.tableNumber as string) || undefined;
        const garcomNameMsg = (meta?.garcomName as string) || undefined;
        const orderMessage = await FormatMenuOrderMessage({
          menuItems,
          customerName: contactName || "Cliente",
          customerPhone: contactPhone,
          customFields,
          protocol: response.protocol || undefined,
          tableNumber: tableNumberMsg,
          garcomName: garcomNameMsg,
        });
        const sentMessage = await SendWhatsAppMessage({ body: orderMessage, ticket });
        if (sentMessage) {
          console.log("ProcessFormResponseService (background) - WhatsApp message sent", { messageId: sentMessage?.key?.id });
        }
      } catch (err: any) {
        console.error("ProcessFormResponseService (background) - Error sending WhatsApp:", err?.message);
      }
    })();
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "ticket" },
    ],
  });

  // Envio WhatsApp é em segundo plano; frontend não deve bloquear
  if (isMenuForm) {
    (response as any).whatsappSent = "pending";
  }

  return response;
};

export default ProcessFormResponseService;
