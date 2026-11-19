CREATE TYPE "public"."import_format" AS ENUM('csv', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"sku" text,
	"column" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" text NOT NULL,
	"format" "import_format" NOT NULL,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"total_rows" integer,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"stock_change_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_errors_import_idx" ON "import_errors" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE INDEX "imports_tenant_created_idx" ON "imports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_active_file_key" ON "imports" USING btree ("tenant_id","file_hash") WHERE status in ('queued', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "imports_one_processing_per_tenant_key" ON "imports" USING btree ("tenant_id") WHERE status = 'processing';--> statement-breakpoint
CREATE INDEX "imports_unfinished_idx" ON "imports" USING btree ("updated_at") WHERE status in ('queued', 'processing');--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;