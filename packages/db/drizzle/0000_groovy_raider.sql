CREATE TYPE "public"."topic_kind" AS ENUM('resource', 'board');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('open', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('allowed', 'unspecified', 'out_of_print', 'licensed');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('review', 'status_change', 'license_change', 'report_resolve', 'takedown_resolve', 'trust_change');--> statement-breakpoint
CREATE TYPE "public"."reject_reason" AS ENUM('copyright', 'illegal', 'low_quality', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('copyright', 'illegal', 'broken_link', 'wrong_info', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('game', 'music', 'doujinshi', 'patch', 'tool');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('draft', 'pending', 'published', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."storage_bucket" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('work', 'convention', 'language', 'other');--> statement-breakpoint
CREATE TYPE "public"."takedown_status" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."upload_kind" AS ENUM('cover', 'file');--> statement-breakpoint
CREATE TYPE "public"."upload_state" AS ENUM('pending', 'uploaded', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"author_id" text,
	"parent_id" uuid,
	"floor" integer NOT NULL,
	"body_md" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "topic_kind" NOT NULL,
	"resource_id" uuid,
	"board_slug" varchar(32),
	"title" varchar(200),
	"author_id" text,
	"post_count" integer DEFAULT 0 NOT NULL,
	"last_post_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_resource_id_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
CREATE TABLE "circle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name_original" varchar(120) NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"website_url" text,
	"avatar_object_id" uuid,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "circle_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"claimant_id" text NOT NULL,
	"status" "claim_status" DEFAULT 'open' NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"file_id" uuid,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"resource_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_resource_id_user_id_pk" PRIMARY KEY("resource_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" "moderation_action" NOT NULL,
	"subject_kind" varchar(24) NOT NULL,
	"subject_id" text NOT NULL,
	"from_value" jsonb,
	"to_value" jsonb,
	"reject_reason" "reject_reason",
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating" (
	"resource_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_resource_id_user_id_pk" PRIMARY KEY("resource_id","user_id"),
	CONSTRAINT "rating_score_range" CHECK ("rating"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" varchar(16) NOT NULL,
	"target_id" text NOT NULL,
	"reporter_id" text,
	"reason" "report_reason" NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"title_original" varchar(200) NOT NULL,
	"title_original_locale" varchar(8) NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"category_id" varchar(32),
	"status" "resource_status" DEFAULT 'draft' NOT NULL,
	"license" "license_status" NOT NULL,
	"license_note" varchar(500),
	"uploader_id" text,
	"circle_id" uuid,
	"circle_name_raw" varchar(120),
	"cover_object_id" uuid,
	"download_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "resource_category" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_tag" (
	"resource_id" uuid NOT NULL,
	"tag_id" varchar(64) NOT NULL,
	CONSTRAINT "resource_tag_resource_id_tag_id_pk" PRIMARY KEY("resource_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "resource_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"label" varchar(64) NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"is_latest" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" "storage_bucket" NOT NULL,
	"key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" varchar(150),
	"checksum" text,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_object_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"kind" "tag_kind" NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name_original" varchar(120) NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takedown_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"claimant_name" varchar(200) NOT NULL,
	"claimant_email" varchar(320) NOT NULL,
	"relation" varchar(32) NOT NULL,
	"statement" text NOT NULL,
	"status" "takedown_status" DEFAULT 'open' NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "upload_kind" NOT NULL,
	"state" "upload_state" DEFAULT 'pending' NOT NULL,
	"bucket" "storage_bucket" NOT NULL,
	"key" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(150) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"object_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intent_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"approved_resource_count" integer DEFAULT 0 NOT NULL,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_parent_id_post_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle" ADD CONSTRAINT "circle_avatar_object_id_storage_object_id_fk" FOREIGN KEY ("avatar_object_id") REFERENCES "public"."storage_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle" ADD CONSTRAINT "circle_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_claim" ADD CONSTRAINT "circle_claim_circle_id_circle_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_claim" ADD CONSTRAINT "circle_claim_claimant_id_user_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_file_id_resource_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."resource_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_category_id_resource_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resource_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_circle_id_circle_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_cover_object_id_storage_object_id_fk" FOREIGN KEY ("cover_object_id") REFERENCES "public"."storage_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_file" ADD CONSTRAINT "resource_file_version_id_resource_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."resource_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_file" ADD CONSTRAINT "resource_file_object_id_storage_object_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tag" ADD CONSTRAINT "resource_tag_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tag" ADD CONSTRAINT "resource_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_version" ADD CONSTRAINT "resource_version_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_request" ADD CONSTRAINT "takedown_request_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_request" ADD CONSTRAINT "takedown_request_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intent" ADD CONSTRAINT "upload_intent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intent" ADD CONSTRAINT "upload_intent_object_id_storage_object_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "post_topic_floor_idx" ON "post" USING btree ("topic_id","floor");--> statement-breakpoint
CREATE UNIQUE INDEX "post_topic_floor_uq" ON "post" USING btree ("topic_id","floor");--> statement-breakpoint
CREATE INDEX "post_author_idx" ON "post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "topic_board_last_post_idx" ON "topic" USING btree ("board_slug","last_post_at");--> statement-breakpoint
CREATE INDEX "topic_kind_idx" ON "topic" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "circle_owner_idx" ON "circle" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_claim_open_uq" ON "circle_claim" USING btree ("circle_id","claimant_id") WHERE "circle_claim"."status" = 'open';--> statement-breakpoint
CREATE INDEX "download_log_resource_created_idx" ON "download_log" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "favorite_user_idx" ON "favorite" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_log_subject_idx" ON "moderation_log" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "moderation_log_created_idx" ON "moderation_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rating_user_idx" ON "rating" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_status_created_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "report" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "resource_status_created_idx" ON "resource" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resource_uploader_idx" ON "resource" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "resource_circle_idx" ON "resource" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "resource_kind_idx" ON "resource" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "resource_file_version_idx" ON "resource_file" USING btree ("version_id","sort_order");--> statement-breakpoint
CREATE INDEX "resource_tag_tag_idx" ON "resource_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "resource_version_resource_idx" ON "resource_version" USING btree ("resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "resource_version_label_uq" ON "resource_version" USING btree ("resource_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_version_latest_uq" ON "resource_version" USING btree ("resource_id") WHERE "resource_version"."is_latest" = 1;--> statement-breakpoint
CREATE INDEX "storage_object_delete_after_idx" ON "storage_object" USING btree ("delete_after");--> statement-breakpoint
CREATE INDEX "tag_kind_idx" ON "tag" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE INDEX "takedown_resource_idx" ON "takedown_request" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "upload_intent_owner_idx" ON "upload_intent" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "upload_intent_state_expires_idx" ON "upload_intent" USING btree ("state","expires_at");