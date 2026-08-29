CREATE TYPE "public"."audio_provider" AS ENUM('netease', 'tencent', 'kugou', 'bilibili', 'local');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'contributor', 'admin');--> statement-breakpoint
CREATE TABLE "album" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_romaji" text,
	"catalog_no" text,
	"release_event" text,
	"release_date" timestamp with time zone,
	"cover_url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arrangement" (
	"track_id" uuid NOT NULL,
	"original_song_id" uuid NOT NULL,
	CONSTRAINT "arrangement_track_id_original_song_id_pk" PRIMARY KEY("track_id","original_song_id")
);
--> statement-breakpoint
CREATE TABLE "audio_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"provider" "audio_provider" NOT NULL,
	"external_id" text,
	"url" text,
	"local_path" text,
	"quality" text,
	"bitrate" integer,
	"format" text,
	"size_bytes" integer,
	"verified_at" timestamp with time zone,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "circle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_romaji" text,
	"description" text,
	"avatar_url" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"track_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "original_song" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_romaji" text,
	"work" text NOT NULL,
	"work_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitter_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"track_no" integer,
	"disc_no" integer DEFAULT 1,
	"title" text NOT NULL,
	"title_romaji" text,
	"duration_sec" integer,
	"arrangers" text[],
	"vocalists" text[],
	"lyricists" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_tag" (
	"track_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "track_tag_track_id_tag_id_pk" PRIMARY KEY("track_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "album" ADD CONSTRAINT "album_circle_id_circle_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement" ADD CONSTRAINT "arrangement_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement" ADD CONSTRAINT "arrangement_original_song_id_original_song_id_fk" FOREIGN KEY ("original_song_id") REFERENCES "public"."original_song"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_source" ADD CONSTRAINT "audio_source_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_log" ADD CONSTRAINT "download_log_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_submitter_id_user_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_tag" ADD CONSTRAINT "track_tag_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_tag" ADD CONSTRAINT "track_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_circle_idx" ON "album" USING btree ("circle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "album_catalog_uq" ON "album" USING btree ("catalog_no");--> statement-breakpoint
CREATE INDEX "audio_track_idx" ON "audio_source" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_provider_ext_uq" ON "audio_source" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "circle_name_uq" ON "circle" USING btree ("name");--> statement-breakpoint
CREATE INDEX "dl_user_idx" ON "download_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dl_track_idx" ON "download_log" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "dl_time_idx" ON "download_log" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "original_work_idx" ON "original_song" USING btree ("work");--> statement-breakpoint
CREATE INDEX "submission_status_idx" ON "submission" USING btree ("status");--> statement-breakpoint
CREATE INDEX "track_album_idx" ON "track" USING btree ("album_id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_album_no_uq" ON "track" USING btree ("album_id","disc_no","track_no");