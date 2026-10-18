import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

// Written out rather than derived via PartialType: @nestjs/mapped-types is
// ESM-only from v12 and this project is CommonJS.
export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;
}
