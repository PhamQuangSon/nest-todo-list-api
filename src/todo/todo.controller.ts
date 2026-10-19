import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { TodoService } from "./todo.service";
import { CreateTodoDto } from "./dto/create-todo.dto";
import { UpdateTodoDto } from "./dto/update-todo.dto";
import { ListTodosQuery } from "./dto/list-todos.query";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/auth.types";

@Controller("todos")
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTodosQuery,
  ) {
    return this.todoService.findAllCursor(
      user.sub,
      query.cursor,
      query.limit ?? 20,
    );
  }

  // Must be declared before @Get(":id") — Nest matches in declaration order, so
  // the parameterised route would otherwise swallow "/export" as an id.
  @Get("export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportCsv(@CurrentUser() user: JwtPayload): Promise<string> {
    return this.todoService.exportCsv(user.sub, user.plan);
  }

  @Get(":id")
  async findOne(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const todo = await this.todoService.findOne(user.sub, id, user.plan);
    res.setHeader("ETag", `"${todo.version}"`);
    return todo;
  }

  @Post()
  async create(
    @Body() dto: CreateTodoDto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { todo, idempotent } = await this.todoService.create(
      user.sub,
      dto,
      user.plan,
    );
    res.setHeader("ETag", `"${todo.version}"`);
    // Idempotent replay: existing todo already created, return 200.
    // New create: @Post() defaults to 201.
    if (idempotent) res.status(HttpStatus.OK);
    return todo;
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateTodoDto,
    @CurrentUser() user: JwtPayload,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ifMatch = ifMatchHeader
      ? Number(ifMatchHeader.replace(/"/g, ""))
      : undefined;

    const todo = await this.todoService.update(
      user.sub,
      id,
      dto,
      ifMatch,
      user.plan,
    );
    res.setHeader("ETag", `"${todo.version}"`);
    return todo;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.todoService.delete(user.sub, id);
  }
}
