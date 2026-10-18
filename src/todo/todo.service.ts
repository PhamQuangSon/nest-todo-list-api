import {
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { Plan, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTodoDto } from "./dto/create-todo.dto";
import { UpdateTodoDto } from "./dto/update-todo.dto";

// Fields selected for list responses (notes excluded — large TEXT column).
// Paid users fetch notes individually when they open a todo.
const LIST_SELECT = {
  id: true,
  title: true,
  completed: true,
  time: true,
  version: true,
  createdAt: true,
} as const;

type ListTodo = Prisma.TodoGetPayload<{ select: typeof LIST_SELECT }>;

export type DetailTodo = ListTodo & { notes: string | null };
export type CreateResult = { todo: DetailTodo; idempotent: boolean };

@Injectable()
export class TodoService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<ListTodo[]> {
    return this.prisma.todo.findMany({
      where: { userId },
      select: LIST_SELECT,
      orderBy: { id: "desc" },
      take: 50,
    });
  }

  async findAllCursor(
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: ListTodo[]; nextCursor: string | null }> {
    const take = Math.min(limit, 100);
    const items = await this.prisma.todo.findMany({
      where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
      select: LIST_SELECT,
      orderBy: { id: "desc" },
      take: take + 1,
    });

    const hasMore = items.length > take;
    if (hasMore) items.pop();
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async findOne(userId: string, id: string, plan: Plan): Promise<DetailTodo> {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      select: { ...LIST_SELECT, userId: true, notes: plan === Plan.PAID },
    });
    if (!todo || todo.userId !== userId) {
      throw new NotFoundException({ code: "NOT_FOUND" });
    }
    const { userId: _uid, ...rest } = todo;
    return rest;
  }

  async create(
    userId: string,
    dto: CreateTodoDto,
    plan: Plan,
  ): Promise<CreateResult> {
    try {
      const todo = await this.prisma.todo.create({
        data: {
          userId,
          title: dto.title,
          completed: dto.completed ?? false,
          time: dto.time,
          notes: dto.notes,
          clientRequestId: dto.clientRequestId,
        },
        select: { ...LIST_SELECT, notes: plan === Plan.PAID },
      });
      return { todo: todo, idempotent: false };
    } catch (e) {
      // Unique constraint on (userId, clientRequestId) → idempotent replay.
      // Return the existing row so the client gets the same response as the
      // original request, with 200 instead of 201.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        dto.clientRequestId
      ) {
        const existing = await this.prisma.todo.findUnique({
          where: {
            userId_clientRequestId: {
              userId,
              clientRequestId: dto.clientRequestId,
            },
          },
          select: { ...LIST_SELECT, notes: plan === Plan.PAID },
        });
        if (existing) return { todo: existing, idempotent: true };
      }
      throw e;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTodoDto,
    ifMatch: number | undefined,
    plan: Plan,
  ): Promise<DetailTodo> {
    if (ifMatch !== undefined) {
      // Optimistic concurrency: check version in WHERE clause — no transaction.
      const { count } = await this.prisma.todo.updateMany({
        where: { id, userId, version: ifMatch },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.completed !== undefined && { completed: dto.completed }),
          ...(dto.time !== undefined && { time: dto.time }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          version: { increment: 1 },
        },
      });

      if (count === 0) {
        const current = await this.prisma.todo.findUnique({
          where: { id },
          select: { version: true, userId: true },
        });
        if (!current || current.userId !== userId) {
          throw new NotFoundException({ code: "NOT_FOUND" });
        }
        throw new PreconditionFailedException({
          code: "VERSION_CONFLICT",
          current: current.version,
        });
      }
    } else {
      // No If-Match: last-write-wins update.
      const existing = await this.prisma.todo.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!existing || existing.userId !== userId) {
        throw new NotFoundException({ code: "NOT_FOUND" });
      }
      await this.prisma.todo.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.completed !== undefined && { completed: dto.completed }),
          ...(dto.time !== undefined && { time: dto.time }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          version: { increment: 1 },
        },
      });
    }

    const updated = await this.prisma.todo.findUniqueOrThrow({
      where: { id },
      select: { ...LIST_SELECT, notes: plan === Plan.PAID },
    });
    return updated;
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.todo.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException({ code: "NOT_FOUND" });
    }
    await this.prisma.todo.delete({ where: { id } });
  }
}
