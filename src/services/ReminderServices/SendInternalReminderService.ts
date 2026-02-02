import User from "../../models/User";
import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import CreateChatService from "../ChatService/CreateChatService";
import CreateMessageService from "../ChatService/CreateMessageService";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

const SendInternalReminderService = async (
  targetUser: User,
  message: string,
  companyId: number
): Promise<void> => {
  try {
    // Buscar ou criar chat de lembretes para o usuário
    // Vamos criar um chat com nome "Lembretes do Sistema"
    let reminderChat = await Chat.findOne({
      where: {
        title: `Lembretes - ${targetUser.name}`,
        ownerId: targetUser.id
      },
      include: [
        {
          model: ChatUser,
          as: "users",
          where: { userId: targetUser.id }
        }
      ]
    });

    // Se não existir, criar o chat
    if (!reminderChat) {
      reminderChat = await CreateChatService({
        ownerId: targetUser.id,
        title: `Lembretes - ${targetUser.name}`,
        userIds: [targetUser.id],
        companyId
      });
      logger.info(`Chat de lembretes criado para usuário ${targetUser.id}`);
    }

    // Enviar mensagem no chat
    const chatMessage = await CreateMessageService({
      chatId: reminderChat.id,
      senderId: targetUser.id, // Sistema enviando em nome do próprio usuário
      message: message,
      mediaPath: undefined,
      mediaName: undefined
    });

    // Emitir evento via Socket.IO para notificar o usuário
    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(
      `company-${companyId}-chat-${reminderChat.id}`,
      {
        action: "new-message",
        newMessage: chatMessage,
        chat: reminderChat
      }
    );

    io.to(`company-${companyId}-mainchannel`).emit(
      `company-${companyId}-chat`,
      {
        action: "new-message",
        newMessage: chatMessage,
        chat: reminderChat
      }
    );

    // Notificação específica para o usuário
    io.to(`user-${targetUser.id}`).emit(`user-${targetUser.id}-notification`, {
      type: "reminder",
      message: message,
      chatId: reminderChat.id
    });

    logger.info(
      `Lembrete enviado via chat interno para usuário ${targetUser.id} no chat ${reminderChat.id}`
    );
  } catch (error: any) {
    logger.error(
      `Erro ao enviar lembrete via chat interno para usuário ${targetUser.id}:`,
      error
    );
    throw error;
  }
};

export default SendInternalReminderService;
