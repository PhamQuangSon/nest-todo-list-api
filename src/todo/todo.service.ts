import { Injectable, NotFoundException } from "@nestjs/common";
import type { TodoItem } from "./todo.interface";

@Injectable()
export class TodoService {
  private todos: TodoItem[] = [
    {
      id: "1",
      title: "Learn NestJS",
      completed: false,
      createdAt: new Date("2025-02-15T10:00:00Z"),
      notes: "Focus on dependency injection and modules",
    },
    {
      id: "2",
      title: "Build a RESTful API",
      completed: true,
      createdAt: new Date("2025-02-16T14:30:00Z"),
      notes: "Implement CRUD operations for Todo items",
    },
    {
      id: "3",
      title: "Implement authentication",
      completed: false,
      createdAt: new Date("2025-02-17T09:15:00Z"),
      notes: "Use JWT for user authentication",
    },
    {
      id: "4",
      title: "Write unit tests",
      completed: false,
      createdAt: new Date("2025-02-18T11:45:00Z"),
      notes: "Achieve at least 80% code coverage",
    },
    {
      id: "5",
      title: "Deploy to production",
      completed: false,
      createdAt: new Date("2025-02-19T16:00:00Z"),
      notes: "Use a cloud platform like Heroku or AWS",
    },
  ];

  findAll(): TodoItem[] {
    return this.todos;
  }

  findOne(id: string): TodoItem {
    const todo = this.todos.find((todo) => todo.id === id);
    if (!todo) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    return todo;
  }

  create(todo: Omit<TodoItem, "id">): TodoItem {
    const newTodo: TodoItem = {
      id: (this.todos.length + 1).toString(),
      ...todo,
      createdAt: new Date(),
    };
    this.todos.push(newTodo);
    return newTodo;
  }

  update(id: string, todo: Partial<TodoItem>): TodoItem {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos[index] = { ...this.todos[index], ...todo };
    return this.todos[index];
  }

  delete(id: string): boolean {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos.splice(index, 1);
    return true;
  }
}
