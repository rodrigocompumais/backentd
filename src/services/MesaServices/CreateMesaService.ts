import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  number: string;
  name?: string;
  companyId: number;
  formId?: number;
  capacity?: number;
  section?: string;
  displayOrder?: number;
}

const CreateMesaService = async ({
  number,
  name,
  companyId,
  formId,
  capacity,
  section,
  displayOrder = 0,
}: Request): Promise<Mesa> => {
  if (!number || number.trim() === "") {
    throw new AppError("ERR_MESA_NUMBER_REQUIRED", 400);
  }

  const existing = await Mesa.findOne({
    where: { companyId, number: number.trim() },
  });

  if (existing) {
    throw new AppError("ERR_MESA_NUMBER_ALREADY_EXISTS", 400);
  }

  const mesa = await Mesa.create({
    number: number.trim(),
    name: name?.trim() || null,
    status: "livre",
    companyId,
    formId: formId || null,
    capacity: capacity || null,
    section: section?.trim() || null,
    displayOrder: displayOrder || 0,
  });

  return mesa;
};

export default CreateMesaService;
