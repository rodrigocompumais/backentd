import Task from "../../models/Task";
import AppError from "../../errors/AppError";
import CreateUserAppointmentService from "../UserAppointmentService/CreateService";
import { logger } from "../../utils/logger";

interface TaskData {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: Date;
  category?: string;
  userId: number;
  assignedToId?: number;
  companyId: number;
  contactId?: number;
  ticketId?: number;
  skipAppointmentCreation?: boolean; // Flag para evitar loop infinito
}

const CreateTaskService = async (taskData: TaskData): Promise<Task> => {
  const { skipAppointmentCreation, ...taskFields } = taskData;
  
  // Criar a tarefa
  const task = await Task.create(taskFields);

  // Se tem dueDate e não é para pular a criação do agendamento, criar agendamento vinculado
  if (task.dueDate && !skipAppointmentCreation) {
    try {
      // Calcular startTime e endTime baseado no dueDate
      const dueDate = new Date(task.dueDate);
      const startTime = new Date(dueDate);
      
      // Se a hora for meia-noite, usar 09:00 como padrão
      if (startTime.getHours() === 0 && startTime.getMinutes() === 0) {
        startTime.setHours(9, 0, 0, 0);
      }
      
      // endTime = startTime + 1 hora
      const endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);

      // Criar agendamento vinculado
      const appointment = await CreateUserAppointmentService({
        title: task.title,
        description: task.description || "",
        startTime,
        endTime,
        userId: task.userId,
        assignedUserId: task.assignedToId,
        companyId: task.companyId,
        status: "pending",
        reminderMinutes: 15,
        skipTaskCreation: true // Flag para evitar loop infinito
      });

      // Atualizar a tarefa com o appointmentId
      await task.update({ appointmentId: appointment.id });

      // Atualizar o agendamento com o taskId
      await appointment.update({ taskId: task.id });

      logger.info(`Agendamento ${appointment.id} criado automaticamente para tarefa ${task.id}`);
    } catch (error: any) {
      logger.error(`Erro ao criar agendamento para tarefa ${task.id}:`, error);
      // Não falhar a criação da tarefa se o agendamento falhar
    }
  }

  // Recarregar task com appointment
  await task.reload({
    include: ["appointment", "user", "assignedTo", "contact", "ticket"]
  });

  return task;
};

export default CreateTaskService;

