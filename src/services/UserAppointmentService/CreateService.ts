import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";

interface Request {
    title: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    userId: number;
    assignedUserId?: number;
    companyId: number;
    status?: string;
    reminderMinutes?: number;
}

const CreateService = async ({
    title,
    description,
    startTime,
    endTime,
    userId,
    assignedUserId,
    companyId,
    status = "pending",
    reminderMinutes = 15,
}: Request): Promise<UserAppointment> => {
    // Validate that end time is after start time
    if (new Date(endTime) <= new Date(startTime)) {
        throw new AppError("End time must be after start time", 400);
    }

    // Create the appointment
    const appointment = await UserAppointment.create({
        title,
        description,
        startTime,
        endTime,
        userId,
        assignedUserId,
        companyId,
        status,
        reminderMinutes,
        notificationSent: false,
    });

    // Reload with associations
    await appointment.reload({
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
        ],
    });

    return appointment;
};

export default CreateService;
