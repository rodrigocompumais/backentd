import { IChannelAdapter } from "./IChannelAdapter";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import WhatsAppService from "../WhatsAppService";

// This is a temporary wrapper to allow progressively moving to the Adapter pattern
// without rewriting the entire Baileys logic immediately.
class WhatsAppAdapter implements IChannelAdapter {
    async init(): Promise<void> {
        // Session initialization is still handled by StartWhatsAppSession for now
    }

    async sendMessage(
        whatsapp: Whatsapp,
        contact: Contact,
        messageData: { body: string; media?: Express.Multer.File; isMedia?: boolean }
    ): Promise<Message> {

        // Calls the existing service
        // Note: The existing service returns WAMessage, but our interface expects Message model.
        // In a full refactor, we would unify this. For now mapping acts as a bridge.

        const sent = await WhatsAppService.sendMessage(
            whatsapp,
            contact.number,
            messageData.body,
            {} // options not fully supported in this interface wrapper yet
        );

        return sent as unknown as Message;
    }
}

export default WhatsAppAdapter;
