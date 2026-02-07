import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
}

const LiberarMesaService = async ({
  mesaId,
  companyId,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  mesa.status = "livre";
  mesa.contactId = null;
  mesa.ticketId = null;
  mesa.occupiedAt = null;
  await mesa.save();

  return mesa;
};

export default LiberarMesaService;
