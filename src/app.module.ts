import { Module } from "@nestjs/common";
import { CacheModule, CacheInterceptor } from "@nestjs/cache-manager";
import { TodoModule } from "./todo/todo.module";
import { APP_INTERCEPTOR } from "@nestjs/core";
@Module({
  imports: [
    CacheModule.register({
      ttl: 5, // seconds
      max: 10, // maximum number of items in cache
      isGlobal: true,
    }),
    TodoModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
  ],
})
export class AppModule {}
