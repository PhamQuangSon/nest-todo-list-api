import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { TodoItem } from './todo.interface';

@Controller('todos')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Get()
  findAll(@Query('userRole') userRole: string): TodoItem[] {
    const todos = this.todoService.findAll();
    if (userRole === 'free') {
      return todos.map(({ id, title, completed, createdAt }) => ({
        id,
        title,
        completed,
        createdAt,
      }));
    }
    return todos;
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('userRole') userRole: string,
  ): TodoItem {
    const todo = this.todoService.findOne(id);
    if (userRole === 'free') {
      const { id, title, completed, createdAt } = todo;
      return { id, title, completed, createdAt };
    }
    return todo;
  }

  @Post()
  create(
    @Body() todo: Omit<TodoItem, 'id'>,
    @Query('userRole') userRole: string,
  ): TodoItem {
    const newTodo = this.todoService.create(todo);
    if (userRole === 'free') {
      const { id, title, completed, createdAt } = newTodo;
      return { id, title, completed, createdAt };
    }
    return newTodo;
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() todo: Partial<TodoItem>,
    @Query('userRole') userRole: string,
  ): TodoItem {
    const updatedTodo = this.todoService.update(id, todo);
    if (userRole === 'free') {
      const { id, title, completed, createdAt } = updatedTodo;
      return { id, title, completed, createdAt };
    }
    return updatedTodo;
  }

  @Delete(':id')
  delete(@Param('id') id: string): { success: boolean } {
    const result = this.todoService.delete(id);
    return { success: result };
  }
}
