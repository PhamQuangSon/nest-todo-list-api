import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS (customize origins as needed)
  app.enableCors({
    origin: "https://vue3-vite-todo-list-rho.vercel.app/", // Allow specific origins
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], // Allow specific HTTP methods
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
