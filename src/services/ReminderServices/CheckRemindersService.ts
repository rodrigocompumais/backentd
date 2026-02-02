import { Op, Sequelize } from "sequelize";
import sequelize from "../../database";
import UserAppointment from "../../models/UserAppointment";
import Task from "../../models/Task";
import { logger } from "../../utils/logger";
import SendReminderService from "./SendReminderService";

const CheckRemindersService = async (): Promise<void> => {
  try {
    // 1. Buscar agendamentos que precisam de lembrete
    // Usa a fórmula: startTime <= NOW() + (reminderMinutes * interval '1 minute')
    const appointments = await UserAppointment.findAll({
      where: {
        notificationSent: false,
        status: {
          [Op.notIn]: ["cancelled", "completed"]
        },
        startTime: {
          [Op.and]: [
            // startTime deve estar no futuro
            { [Op.gt]: new Date() },
            // startTime deve estar dentro da janela de lembrete
            Sequelize.where(
              Sequelize.fn(
                "DATE_PART",
                "epoch",
                Sequelize.col("startTime")
              ),
              Op.lte,
              Sequelize.literal(
                `DATE_PART('epoch', NOW()) + ("reminderMinutes" * 60)`
              )
            )
          ]
        }
      },
      include: [
        {
          association: "user",
          attributes: ["id", "name", "email"]
        },
        {
          association: "assignedUser",
          attributes: ["id", "name", "email"]
        }
      ]
    });

    // 2. Buscar tarefas que precisam de lembrete (15 minutos antes do vencimento)
    const fifteenMinutesFromNow = new Date();
    fifteenMinutesFromNow.setMinutes(fifteenMinutesFromNow.getMinutes() + 15);

    const tasks = await Task.findAll({
      where: {
        notificationSent: false,
        status: {
          [Op.notIn]: ["cancelled", "completed"]
        },
        dueDate: {
          [Op.and]: [
            // dueDate deve estar no futuro
            { [Op.gt]: new Date() },
            // dueDate deve estar dentro dos próximos 15 minutos
            { [Op.lte]: fifteenMinutesFromNow }
          ]
        }
      },
      include: [
        {
          association: "user",
          attributes: ["id", "name", "email"]
        },
        {
          association: "assignedTo",
          attributes: ["id", "name", "email"]
        }
      ]
    });

    logger.info(
      `CheckReminders: ${appointments.length} agendamento(s) e ${tasks.length} tarefa(s) para notificar`
    );

    // 3. Processar lembretes de agendamentos
    for (const appointment of appointments) {
      try {
        await SendReminderService("appointment", appointment);
      } catch (error: any) {
        logger.error(
          `Erro ao enviar lembrete do agendamento ${appointment.id}:`,
          error
        );
      }
    }

    // 4. Processar lembretes de tarefas
    for (const task of tasks) {
      try {
        await SendReminderService("task", task);
      } catch (error: any) {
        logger.error(`Erro ao enviar lembrete da tarefa ${task.id}:`, error);
      }
    }
  } catch (error: any) {
    logger.error("Erro ao verificar lembretes:", error);
    throw error;
  }
};

export default CheckRemindersService;
