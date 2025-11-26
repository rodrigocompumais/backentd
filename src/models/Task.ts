import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  ForeignKey,
  BelongsTo,
  DataType
} from "sequelize-typescript";
import Company from "./Company";
import User from "./User";
import Contact from "./Contact";
import Ticket from "./Ticket";

@Table({ tableName: "Tasks" })
class Task extends Model<Task> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column
  title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  description: string;

  @AllowNull(false)
  @Default("pending")
  @Column(DataType.ENUM("pending", "in_progress", "completed", "cancelled"))
  status: string;

  @AllowNull(false)
  @Default("medium")
  @Column(DataType.ENUM("low", "medium", "high", "urgent"))
  priority: string;

  @AllowNull(true)
  @Column
  dueDate: Date;

  @AllowNull(true)
  @Column
  completedAt: Date;

  @AllowNull(true)
  @Column
  category: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column
  userId: number;

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column
  assignedToId: number;

  @BelongsTo(() => User, "assignedToId")
  assignedTo: User;

  @ForeignKey(() => Company)
  @AllowNull(false)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Contact)
  @AllowNull(true)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @AllowNull(true)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Task;

