import Form from "../../models/Form";
import FormField from "../../models/FormField";
import FormResponse from "../../models/FormResponse";
import ResponseAnswer from "../../models/ResponseAnswer";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateTicketService from "../TicketServices/CreateTicketService";
import AppError from "../../errors/AppError";
import axios from "axios";

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

  // Try to find name, phone, email in form fields
  for (const answer of answers) {
    const field = fields.find((f) => f.id === answer.fieldId);
    if (field) {
      if (field.metadata?.autoFieldType === "supplierName" || (field.fieldType === "text" && field.label.toLowerCase().includes("nome do fornecedor"))) {
        contactName = typeof answer.answer === "string" ? answer.answer : contactName;
      } else if (field.metadata?.autoFieldType === "name" || (field.fieldType === "text" && field.label.toLowerCase().includes("nome"))) {
        contactName = typeof answer.answer === "string" ? answer.answer : contactName;
      }
      if (field.metadata?.autoFieldType === "phone" || field.fieldType === "phone") {
        contactPhone = typeof answer.answer === "string" ? answer.answer : contactPhone;
      }
      if (field.fieldType === "email") {
        contactEmail = typeof answer.answer === "string" ? answer.answer : contactEmail;
      }
    }
  }

  // Check if form is quotation type and process quotationItems
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  
  // Prepare metadata with quotationItems if applicable
  const responseMetadata: any = metadata || {};
  if (isQuotationForm && quotationItems && quotationItems.length > 0) {
    responseMetadata.quotationItems = quotationItems;
    console.log("ProcessFormResponseService: Saving quotationItems:", quotationItems);
  } else if (isQuotationForm) {
    console.log("ProcessFormResponseService: Form is quotation but no quotationItems received");
  }

  // Create FormResponse
  const response = await FormResponse.create({
    formId: form.id,
    responderPhone: contactPhone,
    responderEmail: contactEmail,
    responderName: contactName,
    ipAddress,
    userAgent,
    metadata: responseMetadata,
  });

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

  // Send Webhook if configured
  if (form.sendWebhook && form.webhookUrl) {
    try {
      const payload: any = {
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
      };

      // Include quotationItems if form is quotation type
      if (isQuotationForm && quotationItems && quotationItems.length > 0) {
        payload.quotationItems = quotationItems;
      }

      await axios.post(form.webhookUrl, payload, {
        timeout: 5000,
      });
    } catch (err) {
      console.error("Error sending webhook:", err);
      // Don't fail the request if webhook fails
    }
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "ticket" },
    ],
  });

  return response;
};

export default ProcessFormResponseService;
