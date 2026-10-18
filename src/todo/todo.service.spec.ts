import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { TodoService } from "./todo.service";

describe("TodoService", () => {
  let service: TodoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TodoService],
    }).compile();

    service = module.get<TodoService>(TodoService);
  });

  it("returns the seeded todos", async () => {
    await expect(service.findAll()).resolves.toHaveLength(3);
  });

  // Regression: findOne used to read a field only populated as a side effect of
  // findAll, so a cold instance 404'd on a todo that existed.
  it("finds a todo without findAll being called first", async () => {
    const [seeded] = await service.findAll();
    const fresh = await Test.createTestingModule({
      providers: [TodoService],
    }).compile();
    const coldService = fresh.get<TodoService>(TodoService);
    const [coldSeeded] = await coldService.findAll();

    await expect(coldService.findOne(coldSeeded.id)).resolves.toMatchObject({
      title: seeded.title,
    });
  });

  it("creates a todo with a generated id", async () => {
    const created = await service.create({
      title: "Write a spec that compiles",
      completed: false,
    });

    expect(created.id).toHaveLength(36);
    expect(created.title).toBe("Write a spec that compiles");
    await expect(service.findOne(created.id)).resolves.toEqual(created);
  });

  // Regression: ids came from `todos.length + 1`, so deleting then creating
  // produced a duplicate id.
  it("does not reuse an id after a delete", async () => {
    const first = await service.create({ title: "first", completed: false });
    await service.delete(first.id);
    const second = await service.create({ title: "second", completed: false });

    expect(second.id).not.toBe(first.id);
  });

  it("merges a partial update and keeps the id", async () => {
    const created = await service.create({
      title: "original",
      completed: false,
      notes: "keep me",
    });

    const updated = await service.update(created.id, { completed: true });

    expect(updated).toMatchObject({
      id: created.id,
      title: "original",
      completed: true,
      notes: "keep me",
    });
  });

  it("throws NotFound for a missing todo", async () => {
    await expect(service.findOne("does-not-exist")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.update("does-not-exist", {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.delete("does-not-exist")).rejects.toThrow(
      NotFoundException,
    );
  });
});
