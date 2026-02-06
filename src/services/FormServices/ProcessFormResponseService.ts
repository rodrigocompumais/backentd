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
    createPayload.orderStatus = "novo";
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

  // Create/Update Contact if configured
  if (form.createContact && contactPhone) {
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
  if (form.createTicket && contact) {
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
          const conteudo = {
            event: "form.submitted",
            formId: form.id,
            formName: form.name,
            responseId: response.id,
            submittedAt: response.submittedAt,
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

  // Process menu form: send WhatsApp message to customer
  let whatsappSent = false;
  let whatsappError = null;
  
  console.log("ProcessFormResponseService - Checking menu form:", {
    isMenuForm,
    menuItemsCount: menuItems?.length || 0,
    contactPhone: contactPhone ? "present" : "missing",
  });
  
  if (isMenuForm && menuItems && menuItems.length > 0 && contactPhone) {
    try {
      console.log("ProcessFormResponseService - Starting WhatsApp send process");
      
      // Get WhatsApp connection - use selected one or default
      let whatsappToUse;
      const formSettings = form.settings as any;
      const selectedWhatsappId = formSettings?.whatsappId;
      
      console.log("ProcessFormResponseService - WhatsApp selection:", {
        selectedWhatsappId,
        hasSettings: !!formSettings,
      });
      
      if (selectedWhatsappId) {
        // Use selected WhatsApp connection
        const Whatsapp = (await import("../../models/Whatsapp")).default;
        whatsappToUse = await Whatsapp.findOne({
          where: { id: selectedWhatsappId, companyId: form.companyId, status: "CONNECTED" },
        });
        
        console.log("ProcessFormResponseService - Selected WhatsApp found:", !!whatsappToUse);
        
        if (!whatsappToUse) {
          console.warn(`Selected WhatsApp ${selectedWhatsappId} not found or not connected, using default`);
          whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        }
      } else {
        // Use default WhatsApp connection
        console.log("ProcessFormResponseService - Using default WhatsApp");
        whatsappToUse = await GetDefaultWhatsApp(form.companyId);
      }
      
      if (!whatsappToUse) {
        throw new Error("Nenhuma conexão WhatsApp disponível");
      }
      
      console.log("ProcessFormResponseService - WhatsApp to use:", {
        id: whatsappToUse.id,
        name: whatsappToUse.name,
        status: whatsappToUse.status,
      });
      
      // Ensure contact exists (should already exist from createContact above, but double-check)
      if (!contact && contactPhone) {
        contact = await CreateOrUpdateContactService({
          name: contactName || "Sem nome",
          number: contactPhone,
          email: contactEmail,
          isGroup: false,
          companyId: form.companyId,
        });
      }

      if (contact) {
        // Create or find ticket for sending message
        const ticket = await FindOrCreateTicketService(
          contact,
          whatsappToUse.id,
          0,
          form.companyId
        );

        // Get custom fields from answers
        const customFields = answers
          .map((answer) => {
            const field = fields.find((f) => f.id === answer.fieldId);
            // Exclude auto fields (name, phone)
            if (field) {
              const fieldMetadata = field.metadata as any;
              if (
                fieldMetadata?.autoFieldType === "name" ||
                fieldMetadata?.autoFieldType === "phone" ||
                field.fieldType === "phone"
              ) {
                return null;
              }
              return {
                label: field.label,
                answer: typeof answer.answer === "string" ? answer.answer : String(answer.answer),
              };
            }
            return null;
          })
          .filter((f): f is { label: string; answer: string } => f !== null);

        // Format order message
        const orderMessage = await FormatMenuOrderMessage({
          menuItems,
          customerName: contactName || "Cliente",
          customerPhone: contactPhone,
          customFields,
          protocol: response.protocol || undefined,
        });

        // Send WhatsApp message using existing SendWhatsAppMessage function
        try {
          console.log("ProcessFormResponseService - Sending WhatsApp message:", {
            ticketId: ticket.id,
            contactNumber: ticket.contact.number,
            messageLength: orderMessage.length,
          });
          
          const sentMessage = await SendWhatsAppMessage({
            body: orderMessage,
            ticket,
          });
          
          // Verificar se a mensagem foi realmente enviada
          if (sentMessage) {
            whatsappSent = true;
            console.log("ProcessFormResponseService - Menu order WhatsApp message sent successfully", {
              messageId: sentMessage?.key?.id,
            });
          } else {
            console.error("ProcessFormResponseService - SendWhatsAppMessage returned empty/null");
            throw new Error("Mensagem não foi enviada - resposta vazia");
          }
        } catch (sendErr: any) {
          console.error("ProcessFormResponseService - Error in SendWhatsAppMessage:", {
            error: sendErr.message,
            stack: sendErr.stack,
          });
          throw sendErr; // Re-throw para ser capturado pelo catch externo
        }
      }
    } catch (err: any) {
      console.error("ProcessFormResponseService - Error sending menu order WhatsApp message:", {
        error: err.message,
        stack: err.stack,
        name: err.name,
      });
      whatsappError = err.message || "Erro ao enviar mensagem WhatsApp";
      // Don't fail the request if WhatsApp send fails - order is still saved
    }
  } else if (isMenuForm) {
    console.log("ProcessFormResponseService - Menu form conditions not met:", {
      hasMenuItems: !!(menuItems && menuItems.length > 0),
      hasContactPhone: !!contactPhone,
    });
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "ticket" },
    ],
  });

  // Add WhatsApp send status to response for menu forms
  if (isMenuForm) {
    (response as any).whatsappSent = whatsappSent;
    (response as any).whatsappError = whatsappError;
  }

  return response;
};

export default ProcessFormResponseService;
