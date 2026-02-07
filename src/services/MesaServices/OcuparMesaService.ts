import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
  contactId: number;
  ticketId?: number;
}

const OcuparMesaService = async ({
  mesaId,
  companyId,
  contactId,
  ticketId,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
    include: [{ association: "contact", attributes: ["id", "name", "number"] }],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (mesa.status === "ocupada") {
    throw new AppError("ERR_MESA_ALREADY_OCCUPIED", 400);
  }

  mesa.status = "ocupada";
  mesa.contactId = contactId;
  mesa.ticketId = ticketId || null;
  mesa.occupiedAt = new Date();
  await mesa.save();

  return mesa;
};

export default OcuparMesaService;
