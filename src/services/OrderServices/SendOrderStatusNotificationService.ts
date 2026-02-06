import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";

const DEFAULT_MESSAGES: Record<string, string> = {
  pronto: "✅ Seu pedido está pronto para retirada!",
  saiu_entrega: "🚚 Seu pedido saiu para entrega! Em breve chegaremos.",
  entregue: "✅ Obrigado! Seu pedido foi entregue. Bom apetite!",
};

interface Request {
  form: Form;
  response: FormResponse;
  newStatus: string;
}

const SendOrderStatusNotificationService = async ({
  form,
  response,
  newStatus,
}: Request): Promise<boolean> => {
  const statusesToNotify = ["pronto", "saiu_entrega", "entregue"];
  if (!statusesToNotify.includes(newStatus)) {
    return false;
  }

  let phone = (response.responderPhone || "").trim();
  if (!phone && response.contact?.number) {
    const raw = response.contact.number.replace(/[^0-9]/g, "");
    phone = raw.length >= 10 ? (raw.startsWith("55") ? raw : "55" + raw) : "";
  }
  if (!phone && response.answers?.length) {
    const phoneAnswer = response.answers.find(
      (a) => (a.field?.metadata as any)?.autoFieldType === "phone" || a.field?.fieldType === "phone"
    );
    if (phoneAnswer?.answer) {
      const raw = String(phoneAnswer.answer).replace(/\D/g, "");
      if (raw.length >= 10) phone = raw.startsWith("55") ? raw : "55" + raw;
    }
  }
  if (!phone) {
    console.warn("SendOrderStatusNotification: não foi possível obter telefone", { responseId: response.id });
    return false;
  }

  const formSettings = form.settings as any;
  const orderStatusMessages = formSettings?.orderStatusMessages || {};
  const customTemplate = (orderStatusMessages[newStatus] || "").trim();
  const template = customTemplate || DEFAULT_MESSAGES[newStatus];

  if (!template) {
    console.warn("SendOrderStatusNotification: template vazio para status", { newStatus, responseId: response.id });
    return false;
  }

  try {
    let whatsappToUse;
    const selectedWhatsappId = formSettings?.whatsappId;

    if (selectedWhatsappId) {
      const Whatsapp = (await import("../../models/Whatsapp")).default;
      whatsappToUse = await Whatsapp.findOne({
        where: {
          id: selectedWhatsappId,
          companyId: form.companyId,
          status: "CONNECTED",
        },
      });
      if (!whatsappToUse) {
        whatsappToUse = await GetDefaultWhatsApp(form.companyId);
      }
    } else {
      whatsappToUse = await GetDefaultWhatsApp(form.companyId);
    }

    if (!whatsappToUse) {
      console.warn("SendOrderStatusNotification: No WhatsApp available");
      return false;
    }

    let contact = response.contact;
    if (!contact) {
      contact = await CreateOrUpdateContactService({
        name: response.responderName || "Cliente",
        number: phone,
        email: response.responderEmail,
        isGroup: false,
        companyId: form.companyId,
      });
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      whatsappToUse.id,
      0,
      form.companyId
    );

    console.log("SendOrderStatusNotification: enviando mensagem", {
      responseId: response.id,
      status: newStatus,
      phone: phone.substring(0, 6) + "***",
    });
    await SendWhatsAppMessage({
      body: template,
      ticket,
    });
    console.log("SendOrderStatusNotification: mensagem enviada com sucesso", { responseId: response.id });
    return true;
  } catch (err: any) {
    console.error("SendOrderStatusNotification error:", err?.message);
    return false;
  }
};

export default SendOrderStatusNotificationService;
