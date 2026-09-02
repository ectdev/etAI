CREATE TYPE "public"."temporal_precision" AS ENUM('day', 'month');--> statement-breakpoint
CREATE TYPE "public"."answer_coverage" AS ENUM('full', 'partial', 'none');--> statement-breakpoint
CREATE TYPE "public"."coverage_reason" AS ENUM('covered', 'not_documented', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "public"."ingestion_action" AS ENUM('created', 'updated', 'skipped', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_trigger" AS ENUM('cli', 'dashboard', 'watch', 'schedule', 'seed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"heading_path" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading_path, '') || ' ' || coalesce(content, ''))) STORED,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_document_position_unique" UNIQUE("document_id","position")
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"doc_type" text NOT NULL,
	"temporal_date" date,
	"temporal_precision" "temporal_precision",
	"version_series" text,
	"version_number" text,
	"is_deprecated" boolean DEFAULT false NOT NULL,
	"superseded_by_id" uuid,
	"project" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "document_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "ingestion_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"action" "ingestion_action" NOT NULL,
	"document_id" uuid,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"trigger" "ingestion_trigger" NOT NULL,
	"triggered_by_user_id" text,
	"stats" jsonb DEFAULT '{"created":0,"updated":0,"skipped":0,"deleted":0,"failed":0}'::jsonb NOT NULL,
	"corpus_path" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_query" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"query" text NOT NULL,
	"coverage" "answer_coverage",
	"reason" "coverage_reason",
	"result_count" integer DEFAULT 0 NOT NULL,
	"top_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answered" text,
	"generation_model" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_superseded_by_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_item" ADD CONSTRAINT "ingestion_item_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_item" ADD CONSTRAINT "ingestion_item_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_query" ADD CONSTRAINT "search_query_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "chunk_embedding_hnsw_idx" ON "chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_search_vector_gin_idx" ON "chunk" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chunk_document_id_idx" ON "chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_doc_type_idx" ON "document" USING btree ("doc_type");--> statement-breakpoint
CREATE INDEX "document_temporal_date_idx" ON "document" USING btree ("temporal_date");--> statement-breakpoint
CREATE INDEX "document_version_series_idx" ON "document" USING btree ("version_series");--> statement-breakpoint
CREATE INDEX "document_deleted_at_idx" ON "document" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "ingestion_item_run_id_idx" ON "ingestion_item" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ingestion_item_action_idx" ON "ingestion_item" USING btree ("action");--> statement-breakpoint
CREATE INDEX "ingestion_run_started_at_idx" ON "ingestion_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "search_query_created_at_idx" ON "search_query" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_query_coverage_idx" ON "search_query" USING btree ("coverage");