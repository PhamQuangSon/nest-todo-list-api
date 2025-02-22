import { Test, type TestingModule } from "@nestjs/testing";
import { TodoService } from "./todo.service";
import type { TodoItem } from "./todo.interface";

describe("TodoService", () => {
  let service: TodoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TodoService],
    }).compile();

    service = module.get<TodoService>(TodoService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should create a todo", () => {
    const todo: Omit<TodoItem, "id"> = {
      title: "Test Todo",
      completed: false,
      createdAt: new Date(),
    };
    const createdTodo = service.create(todo);
    expect(createdTodo).toHaveProperty("id");
    expect(createdTodo.title).toBe(todo.title);
  });

  it("should find all todos", () => {
    const todo1 = service.create({
      title: "Todo 1",
      completed: false,
      createdAt: new Date(),
    });
    const todo2 = service.create({
      title: "Todo 2",
      completed: true,
      createdAt: new Date(),
    });
    const todos = service.findAll();
    expect(todos).toHaveLength(2);
    expect(todos).toContainEqual(todo1);
    expect(todos).toContainEqual(todo2);
  });

  it("should find a todo by id", () => {
    const todo = service.create({
      title: "Todo 1",
      completed: false,
      createdAt: new Date(),
    });
    const foundTodo = service.findById(todo.id);
    expect(foundTodo).toEqual(todo);
  });

  it("should update a todo", () => {
    const todo = service.create({
      title: "Todo 1",
      completed: false,
      createdAt: new Date(),
    });
    const updatedTodo = service.update(todo.id, {
      title: "Updated Todo",
      completed: true,
    });
    expect(updatedTodo.title).toBe("Updated Todo");
    expect(updatedTodo.completed).toBe(true);
  });

  it("should delete a todo", () => {
    const todo = service.create({
      title: "Todo 1",
      completed: false,
      createdAt: new Date(),
    });
    service.delete(todo.id);
    const foundTodo = service.findById(todo.id);
    expect(foundTodo).toBeUndefined();
  });
});
