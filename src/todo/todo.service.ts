/* eslint-disable @typescript-eslint/require-await */
// All service methods are declared async to match the Phase 1 Prisma
// interface, which will add `await`. Disable the rule for this file only.
import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TodoItem } from "./todo.interface";
@Injectable()
export class TodoService {
  private readonly todos: TodoItem[] = [
    {
      id: randomUUID(),
      title: "Learn NestJS cache",
      completed: false,
      createdAt: new Date("2025-02-15T10:00:00Z"),
      notes: "Focus on dependency injection and modules",
    },
    {
      id: randomUUID(),
      title: "Build a RESTful API",
      completed: true,
      createdAt: new Date("2025-02-16T14:30:00Z"),
      notes: "Implement CRUD operations for Todo items",
    },
    {
      id: randomUUID(),
      title: "Implement authentication",
      completed: false,
      createdAt: new Date("2025-02-17T09:15:00Z"),
      notes: "Use JWT for user authentication",
    },
  ];

  async findAll(): Promise<TodoItem[]> {
    return this.todos;
  }

  async findOne(id: string): Promise<TodoItem> {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    return todo;
  }

  async create(todo: Omit<TodoItem, "id" | "createdAt">): Promise<TodoItem> {
    const newTodo: TodoItem = {
      ...todo,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.todos.push(newTodo);
    return newTodo;
  }

  async update(id: string, patch: Partial<TodoItem>): Promise<TodoItem> {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos[index] = { ...this.todos[index], ...patch, id };
    return this.todos[index];
  }

  async delete(id: string): Promise<boolean> {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos.splice(index, 1);
    return true;
  }
}
