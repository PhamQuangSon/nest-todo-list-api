import {
  ForbiddenException,
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

export const FREE_PLAN_TODO_QUOTA = 50;

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
      // The one write in this service that genuinely needs a transaction.
      // Everywhere else a single conditional statement does the job; here the
      // counter bump and the INSERT must succeed or fail together, or a failed
      // insert would permanently consume a slot.
      const todo = await this.prisma.$transaction(async (tx) => {
        // Check and increment in ONE statement, with the precondition inside
        // the WHERE clause. updateMany returns the number of rows it matched,
        // so `count === 0` means "already at the limit" — and concurrent
        // callers serialise on the user row, so exactly QUOTA of them can win.
        //
        // The naive version (SELECT count(*), then decide, then INSERT) is what
        // experiment 7 measures: with a gap between read and write, every
        // request in flight at the boundary reads the same under-limit value
        // and proceeds. A transaction alone does not fix it — under
        // READ COMMITTED they all still see the same pre-insert count.
        const { count } = await tx.user.updateMany({
          where: {
            id: userId,
            ...(plan === Plan.FREE
              ? { todoCount: { lt: FREE_PLAN_TODO_QUOTA } }
              : {}),
          },
          data: { todoCount: { increment: 1 } },
        });

        if (count === 0) {
          throw new ForbiddenException({
            code: "QUOTA_EXCEEDED",
            limit: FREE_PLAN_TODO_QUOTA,
          });
        }

        return tx.todo.create({
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

  // DELIBERATELY BLOCKING — this is experiment 6 in k6/README.md, not a design
  // to copy. Everything here runs synchronously on the event loop: the whole
  // result set is loaded into memory, then CSV-escaped row by row. While it
  // runs, this process serves NOTHING else — every concurrent request on this
  // instance waits, including requests that never touch /export.
  //
  // Phase 5 moves this to a BullMQ worker in its own process. The point of
  // keeping the bad version first is to measure what it costs.
  async exportCsv(userId: string, plan: Plan): Promise<string> {
    const todos = await this.prisma.todo.findMany({
      where: { userId },
      // Same plan gate as findOne. An export path that forgets it is the
      // classic entitlement leak: the field never shows in the UI, so nobody
      // notices it shipping in a CSV.
      select: { ...LIST_SELECT, notes: plan === Plan.PAID },
      orderBy: { id: "desc" },
    });

    const rows = [
      "id,title,completed,time,version,createdAt,notes",
      ...todos.map((t) =>
        [
          t.id,
          csvEscape(t.title),
          String(t.completed),
          csvEscape(t.time),
          String(t.version),
          t.createdAt.toISOString(),
          csvEscape((t as { notes?: string | null }).notes ?? null),
        ].join(","),
      ),
    ];

    return rows.join("\n");
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.todo.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException({ code: "NOT_FOUND" });
    }

    // Counter and row move together, or a failed delete would hand back a
    // quota slot that is still occupied.
    await this.prisma.$transaction([
      this.prisma.todo.delete({ where: { id } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { todoCount: { decrement: 1 } },
      }),
    ]);
  }
}

function csvEscape(value: string | null): string {
  if (value === null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
