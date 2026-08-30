-- T4 对抗验证的三处收口。生成器的输出**逐条核对过**，未改动：
--
-- ① topic_kind_shape：两个分支各自闭合另一侧的列。原来 board 分支对
--    resource_id 只字未提，一条同时带 title 与资源束的行是合法的——
--    而那种行谁也删不掉（DELETE /topics/:id 见 resourceId 非 null 就 409）。
--    现网数据先查过：675 条 resource 主题 board_slug 全 NULL，
--    5 条 board 主题 resource_id 全 NULL，这条 CHECK 不会卡住任何现有行。
--
-- ② topic_latest_idx：补 `nulls last` 与末列 id。PG 的 DESC 默认 NULLS FIRST，
--    与路由的 `pinned_at desc nulls last` 不同，于是它根本不会被用于该排序。
--    这是论坛门面页的排序索引，上一版是一条死索引。
--
-- ③ report_reporter_created_idx：限流按 (举报人, 时间) 数行，此前无索引可用
--    （report_open_uq 是 `where status='open'` 的部分索引，那个查询里没有
--    status 谓词）。rate.ts 的注释一度声称它已经存在。
ALTER TABLE "topic" DROP CONSTRAINT "topic_kind_shape";--> statement-breakpoint
DROP INDEX "topic_latest_idx";--> statement-breakpoint
CREATE INDEX "report_reporter_created_idx" ON "report" USING btree ("reporter_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "topic_latest_idx" ON "topic" USING btree ("pinned_at" desc nulls last,"last_post_at" desc,"id" desc);--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_kind_shape" CHECK (("topic"."kind" = 'resource' AND "topic"."title" IS NULL AND "topic"."resource_id" IS NOT NULL AND "topic"."board_slug" IS NULL)
       OR ("topic"."kind" = 'board' AND "topic"."title" IS NOT NULL AND "topic"."board_slug" IS NOT NULL AND "topic"."resource_id" IS NULL));