import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";

interface Request {
    appointmentId: string | number;
    title?: string;
    description?: string;
    startTime?: Date;
    endTime?: Date;
    assignedUserId?: number;
    status?: string;
    reminderMinutes?: number;
}

const UpdateService = async ({
    appointmentId,
    title,
    description,
    startTime,
    endTime,
    assignedUserId,
    status,
    reminderMinutes,
}: Request): Promise<UserAppointment> => {
    const appointment = await UserAppointment.findByPk(appointmentId);

    if (!appointment) {
        throw new AppError("ERR_NO_USER_APPOINTMENT_FOUND", 404);
    }

    // Validate that end time is after start time if both are provided
    const newStartTime = startTime || appointment.startTime;
    const newEndTime = endTime || appointment.endTime;

    if (new Date(newEndTime) <= new Date(newStartTime)) {
        throw new AppError("End time must be after start time", 400);
    }

    await appointment.update({
        title: title !== undefined ? title : appointment.title,
        description: description !== undefined ? description : appointment.description,
        startTime: startTime || appointment.startTime,
        endTime: endTime || appointment.endTime,
        assignedUserId: assignedUserId !== undefined ? assignedUserId : appointment.assignedUserId,
        status: status || appointment.status,
        reminderMinutes: reminderMinutes !== undefined ? reminderMinutes : appointment.reminderMinutes,
    });

    await appointment.reload({
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
        ],
    });

    return appointment;
};

export default UpdateService;
