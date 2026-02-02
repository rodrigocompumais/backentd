import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";
import CreateTaskService from "../TaskServices/CreateTaskService";
import { logger } from "../../utils/logger";

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
    skipTaskCreation?: boolean; // Flag para evitar loop infinito
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
    skipTaskCreation = false,
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

    // Se não for para pular a criação da tarefa, criar tarefa vinculada
    if (!skipTaskCreation) {
        try {
            // Criar tarefa vinculada
            const task = await CreateTaskService({
                title: appointment.title,
                description: appointment.description || "",
                dueDate: appointment.startTime,
                status: "pending",
                priority: "medium",
                userId: appointment.userId,
                assignedToId: appointment.assignedUserId,
                companyId: appointment.companyId,
                skipAppointmentCreation: true // Flag para evitar loop infinito
            });

            // Atualizar o agendamento com o taskId
            await appointment.update({ taskId: task.id });

            // Atualizar a tarefa com o appointmentId
            await task.update({ appointmentId: appointment.id });

            logger.info(`Tarefa ${task.id} criada automaticamente para agendamento ${appointment.id}`);
        } catch (error: any) {
            logger.error(`Erro ao criar tarefa para agendamento ${appointment.id}:`, error);
            // Não falhar a criação do agendamento se a tarefa falhar
        }
    }

    // Reload with associations
    await appointment.reload({
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
            { association: "task" },
        ],
    });

    return appointment;
};

export default CreateService;
