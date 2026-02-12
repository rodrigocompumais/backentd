import Form from "../../models/Form";
import Appointment from "../../models/Appointment";
import AppointmentService from "../../models/AppointmentService";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";

/** Default business hours if not configured (8h-18h) */
const DEFAULT_START = 8;
const DEFAULT_END = 18;
const SLOT_INTERVAL_MINUTES = 30;

interface Request {
  formSlug: string;
  serviceId: number;
  userId: number;
  date: string; // YYYY-MM-DD
  /** When rescheduling, exclude this appointment from "existing" so its slot appears available */
  excludeAppointmentId?: number;
}

export interface Slot {
  start: string; // ISO
  end: string;
  startTime: string; // "09:00"
  endTime: string;
}

const GetAvailabilityService = async ({
  formSlug,
  serviceId,
  userId,
  date,
  excludeAppointmentId,
}: Request): Promise<{ slots: Slot[] }> => {
  const form = await Form.findOne({
    where: { slug: formSlug, isActive: true },
    attributes: ["id", "companyId", "settings"],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const service = await AppointmentService.findOne({
    where: { id: serviceId, companyId: form.companyId, userId, isActive: true },
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  const durationMinutes = service.durationMinutes || 60;
  const settings = (form.settings as any) || {};
  const agendamentoSettings = settings.agendamento || {};
  const scheduleByDay = agendamentoSettings.scheduleByDay as Record<number, { start: number; end: number } | null> | undefined;
  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  let startHour = agendamentoSettings.startHour ?? DEFAULT_START;
  let endHour = agendamentoSettings.endHour ?? DEFAULT_END;
  if (scheduleByDay && typeof scheduleByDay[dayOfWeek] === "object" && scheduleByDay[dayOfWeek] != null) {
    const daySchedule = scheduleByDay[dayOfWeek];
    startHour = daySchedule!.start;
    endHour = daySchedule!.end;
  } else if (scheduleByDay && scheduleByDay[dayOfWeek] === null) {
    return { slots: [] };
  }
  const bufferMinutes = Math.max(0, Number(agendamentoSettings.bufferMinutes) || 0);

  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59");
  const rangeStart = new Date(date + `T${String(startHour).padStart(2, "0")}:00:00`);
  const rangeEnd = new Date(date + `T${String(endHour).padStart(2, "0")}:00:00`);

  const existingWhere: any = {
    companyId: form.companyId,
    assignedUserId: userId,
    status: { [Op.in]: ["pending", "confirmed"] },
    [Op.or]: [
      { startTime: { [Op.between]: [dayStart, dayEnd] } as any },
      { endTime: { [Op.between]: [dayStart, dayEnd] } as any },
    ],
  };
  if (excludeAppointmentId) {
    existingWhere.id = { [Op.ne]: excludeAppointmentId };
  }
  const existing = await Appointment.findAll({
    where: existingWhere,
    attributes: ["startTime", "endTime"],
  });

  const slots: Slot[] = [];
  let current = new Date(rangeStart);

  while (current < rangeEnd) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60 * 1000);
    if (slotEnd > rangeEnd) break;

    const overlaps = existing.some(
      (a) => {
        const s = new Date(a.startTime).getTime();
        const e = new Date(a.endTime).getTime() + bufferMinutes * 60 * 1000;
        const c = current.getTime();
        const se = slotEnd.getTime();
        return c < e && se > s;
      }
    );

    if (!overlaps) {
      const startIso = current.toISOString();
      const endIso = slotEnd.toISOString();
      slots.push({
        start: startIso,
        end: endIso,
        startTime: current.toTimeString().slice(0, 5),
        endTime: slotEnd.toTimeString().slice(0, 5),
      });
    }

    current = new Date(current.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);
  }

  return { slots };
};

export default GetAvailabilityService;
