CREATE TYPE "public"."question_source" AS ENUM('web', 'mcp');--> statement-breakpoint
ALTER TABLE "search_query" ADD COLUMN "source" "question_source" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_query" ADD COLUMN "mcp_token_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_token" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "search_query" ADD CONSTRAINT "search_query_mcp_token_id_mcp_token_id_fk" FOREIGN KEY ("mcp_token_id") REFERENCES "public"."mcp_token"("id") ON DELETE set null ON UPDATE no action;