ALTER TYPE "public"."moderation_action" ADD VALUE 'role_change';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'hard_delete';--> statement-breakpoint
ALTER TYPE "public"."moderation_action" ADD VALUE 'config_change';--> statement-breakpoint
CREATE TABLE "site_config" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_config" ADD CONSTRAINT "site_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;