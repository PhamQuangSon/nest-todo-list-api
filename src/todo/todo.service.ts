import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { TodoItem } from "./todo.interface";

@Injectable()
export class TodoService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  private todos: TodoItem[] = [];

  private fetchTodosFromDatabase(): TodoItem[] {
    // Replace this with your actual database or API call
    return [
      {
        id: "1",
        title: "Learn NestJS cache",
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
  }

  async findAll(): Promise<TodoItem[]> {
    const cacheKey = "todos";
    const cachedTodos = await this.cacheManager.get<TodoItem[]>(cacheKey);

    if (cachedTodos) {
      console.log("Cache hit for findAll:", cachedTodos);
      this.todos = cachedTodos;
      return cachedTodos;
    }

    // Fetch todos from the database or API
    this.todos = this.fetchTodosFromDatabase();

    // Store the fetched todos in the cache
    await this.cacheManager.set(cacheKey, this.todos, 300);

    console.log("Cache miss for findAll. Fetched and cached:", this.todos);
    return this.todos;
  }

  async findOne(id: string): Promise<TodoItem> {
    const cacheKey = `todo_${id}`;
    const cachedTodo = await this.cacheManager.get<TodoItem>(cacheKey);

    if (cachedTodo) {
      console.log(`Cache hit for findOne(${id}):`, cachedTodo);
      return cachedTodo;
    }

    const todo = this.todos.find((todo) => todo.id === id);
    if (!todo) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }

    // Store the fetched todo in the cache
    await this.cacheManager.set(cacheKey, todo, 300);

    console.log(`Cache miss for findOne(${id}). Fetched and cached:`, todo);
    return todo;
  }

  async create(todo: Omit<TodoItem, "id">): Promise<TodoItem> {
    const newTodo: TodoItem = {
      id: (this.todos.length + 1).toString(),
      ...todo,
      createdAt: new Date(),
    };
    this.todos.push(newTodo);

    // Invalidate the cache for the list of todos
    await this.cacheManager.del("todos");

    console.log("Created new todo and invalidated todos cache:", newTodo);
    return newTodo;
  }

  async update(id: string, todo: Partial<TodoItem>): Promise<TodoItem> {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos[index] = { ...this.todos[index], ...todo };

    // Update the cache for the updated todo
    await this.cacheManager.set(`todo_${id}`, this.todos[index], 300);

    // Invalidate the cache for the list of todos
    await this.cacheManager.del("todos");

    console.log(
      `Updated todo ${id} and invalidated todos cache:`,
      this.todos[index],
    );
    return this.todos[index];
  }

  async delete(id: string): Promise<boolean> {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID "${id}" not found`);
    }
    this.todos.splice(index, 1);

    // Invalidate the cache for the deleted todo and the list of todos
    await this.cacheManager.del(`todo_${id}`);
    await this.cacheManager.del("todos");

    console.log(`Deleted todo ${id} and invalidated caches`);
    return true;
  }
}
