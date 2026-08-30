-- M4 T2：神社 schema。
--
-- ⚠️ 这份文件是 drizzle-kit 生成后**手工改过**的，改动有三类，每一处都有注释：
--   ① post_count → floor_seq 改成 RENAME（生成器给的是 DROP + ADD，会丢楼层序列）
--   ② 四条数据回填，插在各自的约束之前（生成器不知道存量数据）
--   ③ handle 的 NOT NULL 拆成「加可空列 → 回填 → SET NOT NULL」（600+ 行的表不能直接加 NOT NULL）
-- 重新 generate 会覆盖这些改动。

CREATE TYPE "public"."notification_kind" AS ENUM('reply', 'mention', 'review_approved', 'review_rejected', 'resource_delisted', 'resource_deleted', 'post_deleted');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text,
	"kind" "notification_kind" NOT NULL,
	"topic_id" uuid,
	"post_id" uuid,
	"resource_id" uuid,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "post_topic_floor_idx";--> statement-breakpoint
DROP INDEX "topic_kind_idx";--> statement-breakpoint
DROP INDEX "post_author_idx";--> statement-breakpoint
DROP INDEX "topic_board_last_post_idx";--> statement-breakpoint

-- ② 回填 1/4：last_post_at 补齐后才能 SET NOT NULL
UPDATE "topic" SET "last_post_at" = "created_at" WHERE "last_post_at" IS NULL;--> statement-breakpoint
ALTER TABLE "topic" ALTER COLUMN "last_post_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "topic" ALTER COLUMN "last_post_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "post" ADD COLUMN "locale" varchar(5);--> statement-breakpoint

-- ① 改名而非 DROP+ADD：post_count 的值恰好就是 floor_seq 该有的值
--    （createPost 用自增后的它当楼层号），丢了的话下一次发帖会撞
--    post_topic_floor_uq，而错误信息说「主题不存在」。
ALTER TABLE "topic" RENAME COLUMN "post_count" TO "floor_seq";--> statement-breakpoint
-- 防御：floor_seq 必须 ≥ 该主题已用过的最大楼层号，这才是真正要守的不变量。
-- GREATEST 保证只升不降。
UPDATE "topic" t SET "floor_seq" = GREATEST(t."floor_seq", COALESCE((
  SELECT MAX(p."floor") FROM "post" p WHERE p."topic_id" = t."id"
), 0));--> statement-breakpoint

ALTER TABLE "topic" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint

-- ② 回填 2/4：资源主题不再快照标题（快照不随资源 PATCH 更新，且它是单语的）
UPDATE "topic" SET "title" = NULL WHERE "kind" = 'resource';--> statement-breakpoint
-- ② 回填 3/4：测试留下的孤儿 board 主题。board_slug='shrine' 不在六个正式 slug 里，
--    会让 topic_board_slug CHECK 失败；顺带清掉缺 title/slug 的（topic_kind_shape 也会拒）。
DELETE FROM "topic" WHERE "kind" = 'board' AND (
  "board_slug" IS NULL
  OR "board_slug" NOT IN ('tea-house', 'danmaku', 'workshop', 'music-hall', 'kappa', 'meta')
  OR "title" IS NULL
);--> statement-breakpoint

-- ② 回填 4/4：handle。
--    先补 profile 行——handle 在 user_profile 上，而它是 sessionMiddleware
--    惰性建的，种子脚本直接 insert(user) 建的账号（如「编目机器人」）没有行。
--    不补的话那些账号的 author 投影缺 handle，前端渲染出 /u/undefined 的死链。
INSERT INTO "user_profile" ("user_id")
SELECT u."id" FROM "user" u
WHERE NOT EXISTS (SELECT 1 FROM "user_profile" p WHERE p."user_id" = u."id");--> statement-breakpoint

-- ③ 先加可空列，回填之后再 SET NOT NULL
ALTER TABLE "user_profile" ADD COLUMN "handle" varchar(20);--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "handle_set_at" timestamp with time zone;--> statement-breakpoint

-- 与运行时相同的派生：'u' + 小写 user_id 过滤成 [a-z0-9] 的前 8 位
UPDATE "user_profile" SET "handle" =
  'u' || substring(regexp_replace(lower("user_id"), '[^a-z0-9]', '', 'g') from 1 for 8);--> statement-breakpoint

-- 冲突解决：**前缀不继承 user_id 的唯一性**，实测 631 个账号里就有 1 组相撞。
-- 每轮把仍然重复的那些（每组保留一个）延长 4 位，直到没有重复或到达上限 19。
DO $$
DECLARE
  n integer;
  len integer := 12;
BEGIN
  LOOP
    UPDATE "user_profile" p SET "handle" =
      'u' || substring(regexp_replace(lower(p."user_id"), '[^a-z0-9]', '', 'g') from 1 for len)
    WHERE p."handle" IN (
      SELECT "handle" FROM "user_profile" GROUP BY "handle" HAVING count(*) > 1
    )
    AND p."user_id" <> (
      SELECT min(q."user_id") FROM "user_profile" q WHERE q."handle" = p."handle"
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0 OR len >= 19;
    len := len + 4;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "user_profile" GROUP BY "handle" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'handle 派生仍有冲突，前缀延长到上限也没解开';
  END IF;
END $$;--> statement-breakpoint

-- 保留字守卫：派生出的 handle 形如 'u' + [a-z0-9]，唯一可能撞上的保留字是
-- 'undefined'（'u' + 'ndefined' 恰好 8 位）。撞上就让它多一位。
UPDATE "user_profile" SET "handle" = "handle" || '0'
WHERE "handle" IN ('admin', 'administrator', 'root', 'staff', 'moderator', 'mod', 'everyone', 'here', 'all', 'system', 'gensokyo', 'official', 'support', 'help', 'api', 'me', 'new', 'settings', 'null', 'undefined');--> statement-breakpoint

ALTER TABLE "user_profile" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "topic_latest_idx" ON "topic" USING btree ("pinned_at" desc,"last_post_at" desc);--> statement-breakpoint
CREATE INDEX "topic_author_idx" ON "topic" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_open_uq" ON "report" USING btree ("reporter_id","target_kind","target_id") WHERE "report"."status" = 'open';--> statement-breakpoint
CREATE INDEX "post_author_idx" ON "post" USING btree ("author_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "topic_board_last_post_idx" ON "topic" USING btree ("board_slug","last_post_at" desc);--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_handle_unique" UNIQUE("handle");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_body_len" CHECK (char_length("post"."body_md") BETWEEN 1 AND 20000);--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_kind_shape" CHECK (("topic"."kind" = 'resource' AND "topic"."title" IS NULL AND "topic"."resource_id" IS NOT NULL)
       OR ("topic"."kind" = 'board' AND "topic"."title" IS NOT NULL AND "topic"."board_slug" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_board_slug" CHECK ("topic"."board_slug" IS NULL OR "topic"."board_slug" IN ('tea-house', 'danmaku', 'workshop', 'music-hall', 'kappa', 'meta'));--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_handle_fmt" CHECK ("user_profile"."handle" ~ '^[a-z0-9][a-z0-9_]{1,19}$');--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_handle_not_reserved" CHECK ("user_profile"."handle" NOT IN ('admin', 'administrator', 'root', 'staff', 'moderator', 'mod', 'everyone', 'here', 'all', 'system', 'gensokyo', 'official', 'support', 'help', 'api', 'me', 'new', 'settings', 'null', 'undefined'));
