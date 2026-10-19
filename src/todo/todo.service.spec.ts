import { Test, TestingModule } from "@nestjs/testing";
import {
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { Plan, Prisma } from "@prisma/client";
import { FREE_PLAN_TODO_QUOTA, TodoService } from "./todo.service";
import { PrismaService } from "../prisma/prisma.service";
import { UserCache } from "../cache/user-cache";

const USER_ID = "01a00000-0000-7000-8000-000000000001";
const TODO_ID = "01a00000-0000-7000-8000-000000000002";

const fakeTodo = {
  id: TODO_ID,
  title: "Test todo",
  completed: false,
  time: null,
  version: 0,
  createdAt: new Date(),
  notes: null,
};

function makePrismaMock() {
  const mock: Record<string, any> = {
    todo: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      // Quota gate: a non-zero count means a slot was claimed.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
  };

  // Interactive form runs the callback against this same mock; array form just
  // resolves. Enough to exercise the service's control flow.
  mock.$transaction = jest.fn((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => unknown)(mock)
      : Promise.resolve(arg),
  );

  return mock;
}

describe("TodoService", () => {
  let service: TodoService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TodoService,
        { provide: PrismaService, useValue: prismaMock },
        // Pass-through: these tests exercise query logic, not caching.
        {
          provide: UserCache,
          useValue: {
            getOrLoad: (
              _u: string,
              _v: string,
              _t: number,
              load: () => unknown,
            ) => load(),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TodoService>(TodoService);
  });

  describe("findAllCursor", () => {
    it("returns items and null nextCursor when fewer than limit", async () => {
      prismaMock.todo.findMany.mockResolvedValue([fakeTodo]);

      const result = await service.findAllCursor(USER_ID, undefined, 20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("returns nextCursor when a full page is returned", async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...fakeTodo,
        id: `id-${i}`,
      }));
      prismaMock.todo.findMany.mockResolvedValue(items);

      const result = await service.findAllCursor(USER_ID, undefined, 20);

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe("id-19");
    });
  });

  describe("create — idempotency", () => {
    it("returns idempotent: false for a new todo", async () => {
      prismaMock.todo.create.mockResolvedValue(fakeTodo);

      const result = await service.create(USER_ID, { title: "new" }, Plan.FREE);

      expect(result.idempotent).toBe(false);
      expect(result.todo.title).toBe("Test todo");
    });

    it("returns idempotent: true when clientRequestId already exists (P2002)", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "6.0.0", meta: {} },
      );
      prismaMock.todo.create.mockRejectedValue(p2002);
      prismaMock.todo.findUnique.mockResolvedValue(fakeTodo);

      const result = await service.create(
        USER_ID,
        { title: "dup", clientRequestId: "client-req-id-1" },
        Plan.FREE,
      );

      expect(result.idempotent).toBe(true);
      expect(result.todo.id).toBe(TODO_ID);
    });

    it("re-throws P2002 when no clientRequestId is present", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "6.0.0", meta: {} },
      );
      prismaMock.todo.create.mockRejectedValue(p2002);

      // No clientRequestId → not an idempotency key, must propagate.
      await expect(
        service.create(USER_ID, { title: "no key" }, Plan.FREE),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe("create — quota", () => {
    it("rejects a FREE user whose quota is already full", async () => {
      // updateMany matched no row: the WHERE clause's todoCount < QUOTA
      // precondition failed, which is how the atomic check reports "full".
      prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.create(USER_ID, { title: "over quota" }, Plan.FREE),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.todo.create).not.toHaveBeenCalled();
    });

    it("applies the quota precondition for FREE but not for PAID", async () => {
      prismaMock.todo.create.mockResolvedValue(fakeTodo);

      await service.create(USER_ID, { title: "free" }, Plan.FREE);
      const freeWhere = prismaMock.user.updateMany.mock.calls[0][0].where;
      expect(freeWhere.todoCount).toEqual({ lt: FREE_PLAN_TODO_QUOTA });

      await service.create(USER_ID, { title: "paid" }, Plan.PAID);
      const paidWhere = prismaMock.user.updateMany.mock.calls[1][0].where;
      expect(paidWhere.todoCount).toBeUndefined();
    });
  });

  describe("update — optimistic concurrency", () => {
    it("throws PreconditionFailedException when version does not match", async () => {
      prismaMock.todo.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.todo.findUnique.mockResolvedValue({
        version: 5,
        userId: USER_ID,
      });

      await expect(
        service.update(USER_ID, TODO_ID, { title: "new" }, 3, Plan.FREE),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it("throws NotFoundException when todo does not exist", async () => {
      prismaMock.todo.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.todo.findUnique.mockResolvedValue(null);

      await expect(
        service.update(USER_ID, TODO_ID, { title: "x" }, 0, Plan.FREE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("delete", () => {
    it("throws NotFoundException for a missing todo", async () => {
      prismaMock.todo.findUnique.mockResolvedValue(null);

      await expect(service.delete(USER_ID, TODO_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
