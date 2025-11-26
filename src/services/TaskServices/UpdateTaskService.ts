import Task from "../../models/Task";
import AppError from "../../errors/AppError";
import ShowTaskService from "./ShowTaskService";

interface TaskData {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: Date | null;
  completedAt?: Date | null;
  category?: string;
  assignedToId?: number | null;
  contactId?: number | null;
  ticketId?: number | null;
}

interface Request {
  taskId: number | string;
  taskData: TaskData;
  companyId: number;
}

const UpdateTaskService = async ({
  taskId,
  taskData,
  companyId
}: Request): Promise<Task> => {
  const task = await ShowTaskService(taskId, companyId);

  // Se status mudou para "completed", definir completedAt
  if (taskData.status === "completed" && task.status !== "completed") {
    taskData.completedAt = new Date();
  }

  // Se status mudou de "completed" para outro, limpar completedAt
  if (task.status === "completed" && taskData.status && taskData.status !== "completed") {
    taskData.completedAt = null;
  }

  await task.update(taskData);

  await task.reload();

  return task;
};

export default UpdateTaskService;

