import Task from "../../models/Task";
import AppError from "../../errors/AppError";

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
}

const CreateTaskService = async (taskData: TaskData): Promise<Task> => {
  const task = await Task.create(taskData);

  return task;
};

export default CreateTaskService;

