import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import { isNil } from "lodash";
interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId
}: Request): Promise<Contact> => {
  const number = isGroup ? rawNumber : rawNumber.replace(/[^0-9]/g, "");

  const io = getIO();
  
  // Usar findOrCreate para evitar race conditions
  // Esta operação é atômica e garante que apenas um registro seja criado
  const [contact, created] = await Contact.findOrCreate({
    where: {
      number,
      companyId
    },
    defaults: {
      name,
      number,
      profilePicUrl,
      email,
      isGroup,
      extraInfo,
      companyId,
      whatsappId
    }
  });

  // Se o contato já existia, atualizar os dados
  if (!created) {
    const updateData: any = { profilePicUrl };
    
    // Atualizar whatsappId apenas se não estiver definido
    if (isNil(contact.whatsappId) && whatsappId) {
      updateData.whatsappId = whatsappId;
    }
    
    await contact.update(updateData);
    
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "update",
      contact
    });
  } else {
    // Contato criado com sucesso
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "create",
      contact
    });
  }

  return contact;
};

export default CreateOrUpdateContactService;
