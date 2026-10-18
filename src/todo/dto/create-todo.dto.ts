import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateTodoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  time?: string;

  // Unbounded TEXT is a DoS vector, so the cap is enforced at the edge.
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  // Client-generated UUID v4/v7 for idempotency (duplicate POST detection).
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}
