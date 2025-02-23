import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
} from "@nestjs/common";
import { TodoService } from "./todo.service";
import { TodoItem } from "./todo.interface";
import { CacheInterceptor } from "@nestjs/cache-manager";

@Controller("todos")
@UseInterceptors(CacheInterceptor)
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Get()
  async findAll(@Query("userRole") userRole: string): Promise<TodoItem[]> {
    const todos = await this.todoService.findAll();
    if (userRole === "free") {
      return todos.map(({ id, title, completed, createdAt }) => ({
        id,
        title,
        completed,
        createdAt,
      }));
    }
    return todos;
  }

  @Get(":id")
  async findOne(
    @Param("id") id: string,
    @Query("userRole") userRole: string,
  ): Promise<TodoItem> {
    const todo = await this.todoService.findOne(id);
    if (userRole === "free") {
      const { id, title, completed, createdAt } = todo;
      return { id, title, completed, createdAt };
    }
    return todo;
  }

  @Post()
  async create(
    @Body() todo: Omit<TodoItem, "id">,
    @Query("userRole") userRole: string,
  ): Promise<TodoItem> {
    const newTodo = await this.todoService.create(todo);
    if (userRole === "free") {
      const { id, title, completed, createdAt } = newTodo;
      return { id, title, completed, createdAt };
    }
    return newTodo;
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() todo: Partial<TodoItem>,
    @Query("userRole") userRole: string,
  ): Promise<TodoItem> {
    const updatedTodo = await this.todoService.update(id, todo);
    if (userRole === "free") {
      const { id, title, completed, createdAt } = updatedTodo;
      return { id, title, completed, createdAt };
    }
    return updatedTodo;
  }

  @Delete(":id")
  async delete(@Param("id") id: string): Promise<{ success: boolean }> {
    const result = await this.todoService.delete(id);
    return { success: result };
  }
}
