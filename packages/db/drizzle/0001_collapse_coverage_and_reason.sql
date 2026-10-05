-- Collapses `coverage` and `reason` into one four-value column.
--
-- The two columns multiplied out to nine combinations of which four meant anything, so
-- `full` with `out_of_scope` was representable and meaningless. The generated version of
-- this migration dropped `reason` and cast `coverage` straight across, which fails on any
-- row that already says `none`: there is no such value in the new type.
--
-- The old `reason` is what says which refusal a `none` row was, so the rows are moved
-- while the column is still text and `reason` is still there to read.

ALTER TABLE "search_query" ALTER COLUMN "coverage" SET DATA TYPE text;--> statement-breakpoint

UPDATE "search_query"
   SET "coverage" = COALESCE("reason"::text, 'out_of_scope')
 WHERE "coverage" = 'none';--> statement-breakpoint

-- `covered` was only ever paired with full or partial, which the row already records.
UPDATE "search_query"
   SET "coverage" = 'out_of_scope'
 WHERE "coverage" NOT IN ('full', 'partial', 'not_documented', 'out_of_scope');--> statement-breakpoint

DROP TYPE "public"."answer_coverage";--> statement-breakpoint
CREATE TYPE "public"."answer_coverage" AS ENUM('full', 'partial', 'not_documented', 'out_of_scope');--> statement-breakpoint
ALTER TABLE "search_query" ALTER COLUMN "coverage" SET DATA TYPE "public"."answer_coverage" USING "coverage"::"public"."answer_coverage";--> statement-breakpoint
ALTER TABLE "search_query" DROP COLUMN "reason";--> statement-breakpoint
DROP TYPE "public"."coverage_reason";
