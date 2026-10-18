import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TodoModule } from "./todo/todo.module";
import { validateEnv } from "./config/env";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TodoModule,
  ],
})
export class AppModule {}
