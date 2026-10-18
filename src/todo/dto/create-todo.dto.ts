import {
  IsBoolean,
  IsOptional,
  IsString,
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
}
