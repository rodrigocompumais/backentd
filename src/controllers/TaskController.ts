import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import CreateTaskService from "../services/TaskServices/CreateTaskService";
import ListTasksService from "../services/TaskServices/ListTasksService";
import ShowTaskService from "../services/TaskServices/ShowTaskService";
import UpdateTaskService from "../services/TaskServices/UpdateTaskService";
import DeleteTaskService from "../services/TaskServices/DeleteTaskService";
import { getIO } from "../libs/socket";

interface TaskData {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: Date;
  category?: string;
  assignedToId?: number;
  contactId?: number;
  ticketId?: number;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const {
    searchParam,
    status,
    priority,
    category,
    assignedToId,
    showAll,
    pageNumber,
    limit
  } = req.query;

  const tasks = await ListTasksService({
    companyId,
    userId,
    searchParam: searchParam as string,
    status: status as string,
    priority: priority as string,
    category: category as string,
    assignedToId: assignedToId ? Number(assignedToId) : undefined,
    showAll: showAll === "true",
    pageNumber: pageNumber as string,
    limit: limit as string
  });

  return res.json(tasks);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const taskData: TaskData = req.body;

  const schema = Yup.object().shape({
    title: Yup.string().required(),
    description: Yup.string().nullable(),
    status: Yup.string().oneOf(["pending", "in_progress", "completed", "cancelled"]),
    priority: Yup.string().oneOf(["low", "medium", "high", "urgent"]),
    dueDate: Yup.date().nullable(),
    category: Yup.string().nullable(),
    assignedToId: Yup.number().nullable(),
    contactId: Yup.number().nullable(),
    ticketId: Yup.number().nullable()
  });

  try {
    await schema.validate(taskData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const task = await CreateTaskService({
    ...taskData,
    userId,
    companyId
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-task`, {
    action: "create",
    task
  });

  return res.status(201).json(task);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { taskId } = req.params;

  const task = await ShowTaskService(taskId, companyId);

  return res.json(task);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { taskId } = req.params;
  const taskData: TaskData = req.body;

  const schema = Yup.object().shape({
    title: Yup.string(),
    description: Yup.string().nullable(),
    status: Yup.string().oneOf(["pending", "in_progress", "completed", "cancelled"]),
    priority: Yup.string().oneOf(["low", "medium", "high", "urgent"]),
    dueDate: Yup.date().nullable(),
    category: Yup.string().nullable(),
    assignedToId: Yup.number().nullable(),
    contactId: Yup.number().nullable(),
    ticketId: Yup.number().nullable()
  });

  try {
    await schema.validate(taskData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const task = await UpdateTaskService({
    taskId,
    taskData,
    companyId
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-task`, {
    action: "update",
    task
  });

  return res.json(task);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { taskId } = req.params;

  await DeleteTaskService(taskId, companyId);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-task`, {
    action: "delete",
    taskId
  });

  return res.status(200).json({ message: "Tarefa excluída com sucesso" });
};

// Estatísticas das tarefas
export const stats = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const { showAll } = req.query;

  const pendingTasks = await ListTasksService({
    companyId,
    userId,
    status: "pending",
    showAll: showAll === "true"
  });

  const inProgressTasks = await ListTasksService({
    companyId,
    userId,
    status: "in_progress",
    showAll: showAll === "true"
  });

  const completedTasks = await ListTasksService({
    companyId,
    userId,
    status: "completed",
    showAll: showAll === "true"
  });

  const cancelledTasks = await ListTasksService({
    companyId,
    userId,
    status: "cancelled",
    showAll: showAll === "true"
  });

  return res.json({
    pending: pendingTasks.count,
    inProgress: inProgressTasks.count,
    completed: completedTasks.count,
    cancelled: cancelledTasks.count,
    total: pendingTasks.count + inProgressTasks.count + completedTasks.count + cancelledTasks.count
  });
};
