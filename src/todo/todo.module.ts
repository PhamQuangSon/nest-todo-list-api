import { Module } from "@nestjs/common";
import { TodoController } from "./todo.controller";
import { TodoService } from "./todo.service";

@Module({
  imports: [], // Import other modules
  controllers: [TodoController],
  providers: [TodoService],
  exports: [TodoService], // Export providers for other modules
})
export class TodoModule {}
