-- todoCount has existed since the init migration but was never maintained, so
-- every row still reads 0 while users own thousands of todos. Backfill it
-- before it starts gating anything.
UPDATE "User" u
SET "todoCount" = (SELECT count(*) FROM "Todo" t WHERE t."userId" = u.id);

-- Defence in depth against a decrement bug. The quota CEILING deliberately is
-- not a CHECK constraint: the limit depends on the user's plan, and a PAID user
-- legitimately holds more rows than a FREE one, so no single constant is right.
ALTER TABLE "User"
  ADD CONSTRAINT "User_todoCount_non_negative" CHECK ("todoCount" >= 0);
