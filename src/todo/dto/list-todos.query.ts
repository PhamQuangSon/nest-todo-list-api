import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class ListTodosQuery {
  // Unvalidated, a malformed cursor reached Postgres as a uuid comparison and
  // surfaced as a 500. It is also part of the cache key, so accepting any
  // string would let a caller mint a new cache entry per request.
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // A negative `take` makes Prisma read backwards, so -5 used to return a
  // different page instead of an error.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
