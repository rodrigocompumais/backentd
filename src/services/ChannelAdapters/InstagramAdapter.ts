import axios from "axios";
import { IChannelAdapter } from "./IChannelAdapter";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import AppError from "../../errors/AppError";

class InstagramAdapter implements IChannelAdapter {
    private apiUrl = "https://graph.facebook.com/v18.0";

    async init(): Promise<void> {
        // Initialization logic if needed
    }

    async sendMessage(
        whatsapp: Whatsapp,
        contact: Contact,
        messageData: { body: string; media?: Express.Multer.File; isMedia?: boolean }
    ): Promise<Message> {
        if (!whatsapp.facebookUserToken) {
            throw new AppError("ERR_WAPP_INVALID_TOKEN");
        }

        const { body } = messageData;

        // Logic to send text message via Instagram Graph API
        // POST /me/messages
        //Recipient: contact.number (IGSID)

        try {
            const { data } = await axios.post(
                `${this.apiUrl}/${whatsapp.fbPageId}/messages`,
                {
                    recipient: { id: contact.number },
                    message: { text: body }
                },
                {
                    params: {
                        access_token: whatsapp.facebookUserToken
                    }
                }
            );

            // Return a partial Message object or use a Service to create it.
            // Ideally this adapter returns the API response, and the Service creates the record.
            // But adhering to the interface returning Promise<Message>:

            // Note: In a real implementation, we would create the Message in the DB here or returns the data to the service.
            // For now, casting or mocking the return as we are in the initial phase.

            return data as unknown as Message;
        } catch (err) {
            console.error(err);
            throw new AppError("ERR_SENDING_INSTAGRAM_MSG");
        }
    }
}

export default InstagramAdapter;
