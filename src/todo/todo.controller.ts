import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { TodoService } from "./todo.service";
import { TodoItem } from "./todo.interface";
import { CreateTodoDto } from "./dto/create-todo.dto";
import { UpdateTodoDto } from "./dto/update-todo.dto";

// `userRole` is a client-supplied query param and therefore not a security
// control. Phase 1 replaces it with a verified JWT claim.
type LegacyRole = "free" | "paid" | undefined;

function applyPlan(todo: TodoItem, role: LegacyRole): TodoItem {
  if (role !== "free") {
    return todo;
  }
  const { notes: _notes, ...rest } = todo;
  return rest;
}

@Controller("todos")
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Get()
  async findAll(@Query("userRole") userRole: LegacyRole): Promise<TodoItem[]> {
    const todos = await this.todoService.findAll();
    return todos.map((todo) => applyPlan(todo, userRole));
  }

  @Get(":id")
  async findOne(
    @Param("id") id: string,
    @Query("userRole") userRole: LegacyRole,
  ): Promise<TodoItem> {
    return applyPlan(await this.todoService.findOne(id), userRole);
  }

  @Post()
  async create(
    @Body() dto: CreateTodoDto,
    @Query("userRole") userRole: LegacyRole,
  ): Promise<TodoItem> {
    const created = await this.todoService.create({
      title: dto.title,
      completed: dto.completed ?? false,
      time: dto.time,
      notes: dto.notes,
    });
    return applyPlan(created, userRole);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateTodoDto,
    @Query("userRole") userRole: LegacyRole,
  ): Promise<TodoItem> {
    return applyPlan(await this.todoService.update(id, dto), userRole);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.todoService.delete(id);
  }
}
