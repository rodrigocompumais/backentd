import { WASocket } from "baileys";
import { getWbot } from "../libs/wbot";
import GetDefaultWhatsApp from "./GetDefaultWhatsApp";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import { Store } from "../libs/store";
import AppError from "../errors/AppError";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const GetTicketWbot = async (ticket: Ticket): Promise<Session | null> => {
  if (!ticket.whatsappId) {
    const defaultWhatsapp = await GetDefaultWhatsApp(
      ticket.companyId,
      ticket.userId || (ticket as any)?.user?.id
    );

    await ticket.$set("whatsapp", defaultWhatsapp);
    ticket.whatsappId = defaultWhatsapp.id;
  }

  // Verificar se é Instagram - Instagram não usa sessão Baileys
  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId);
  if (whatsapp && whatsapp.type === "instagram") {
    // Instagram não precisa de sessão Baileys, retorna null
    // O código que usa GetTicketWbot deve verificar se é Instagram antes de chamar
    return null;
  }

  if (!ticket.whatsappId) {
    throw new AppError("ERR_WAPP_NOT_FOUND");
  }

  const wbot = getWbot(ticket.whatsappId);
  return wbot;
};

export default GetTicketWbot;
