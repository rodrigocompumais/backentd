import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";
import User from "../../models/User";

interface CheckAvailabilityRequest {
  professionalId: number;
  companyId: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

interface AvailabilityResult {
  available: boolean;
  reason?: string;
  conflictingAppointments?: UserAppointment[];
}

const CheckAvailabilityService = async ({
  professionalId,
  companyId,
  date,
  startTime,
  endTime
}: CheckAvailabilityRequest): Promise<AvailabilityResult> => {
  // Validar que o profissional existe e pertence à empresa
  const professional = await User.findOne({
    where: {
      id: professionalId,
      companyId
    }
  });

  if (!professional) {
    throw new AppError("Profissional não encontrado ou não pertence a esta empresa", 404);
  }

  // Validar formato de data e horário
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^\d{2}:\d{2}$/;

  if (!dateRegex.test(date)) {
    throw new AppError("Formato de data inválido. Use YYYY-MM-DD", 400);
  }

  if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
    throw new AppError("Formato de horário inválido. Use HH:MM", 400);
  }

  // Construir objetos Date para comparação
  const requestedStart = new Date(`${date}T${startTime}:00`);
  const requestedEnd = new Date(`${date}T${endTime}:00`);

  // Validar que o horário de fim é após o de início
  if (requestedEnd <= requestedStart) {
    return {
      available: false,
      reason: "O horário de fim deve ser posterior ao horário de início"
    };
  }

  // Validar que não é no passado
  const now = new Date();
  if (requestedStart < now) {
    return {
      available: false,
      reason: "Não é possível agendar no passado"
    };
  }

  // Buscar agendamentos conflitantes
  // Um agendamento conflita se:
  // 1. Está no mesmo dia
  // 2. O horário solicitado se sobrepõe com algum agendamento existente
  // 3. O status não é "cancelled"
  const startOfDay = new Date(`${date}T00:00:00`);
  const endOfDay = new Date(`${date}T23:59:59`);

  const conflictingAppointments = await UserAppointment.findAll({
    where: {
      assignedUserId: professionalId,
      companyId,
      startTime: {
        [Op.between]: [+startOfDay, +endOfDay]
      },
      status: {
        [Op.ne]: "cancelled"
      },
      [Op.or]: [
        // Conflito: início do solicitado está dentro de um agendamento existente
        {
          startTime: { [Op.lte]: requestedStart },
          endTime: { [Op.gt]: requestedStart }
        },
        // Conflito: fim do solicitado está dentro de um agendamento existente
        {
          startTime: { [Op.lt]: requestedEnd },
          endTime: { [Op.gte]: requestedEnd }
        },
        // Conflito: agendamento existente está completamente dentro do solicitado
        {
          startTime: { [Op.gte]: requestedStart },
          endTime: { [Op.lte]: requestedEnd }
        },
        // Conflito: solicitado está completamente dentro de um agendamento existente
        {
          startTime: { [Op.lte]: requestedStart },
          endTime: { [Op.gte]: requestedEnd }
        }
      ]
    },
    order: [["startTime", "ASC"]]
  });

  if (conflictingAppointments.length > 0) {
    return {
      available: false,
      reason: `Horário já ocupado. Existem ${conflictingAppointments.length} agendamento(s) conflitante(s)`,
      conflictingAppointments
    };
  }

  return {
    available: true
  };
};

export default CheckAvailabilityService;
