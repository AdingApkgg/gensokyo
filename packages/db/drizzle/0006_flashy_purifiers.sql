-- T6 对抗验证抓出来的：notification 的三个 subject 外键从 CASCADE 改成 SET NULL。
--
-- 通知是「有没有告诉过用户」的送达副本。此前 staff 删楼给作者记的 strike 留着，
-- 而资源一旦被 purge，级联会把「告诉过他」的那条 post_deleted 一起删掉——与
-- P0-11（resource_deleted 随 resourceId 级联消失）是同一类问题，只是发生在楼层级。
-- 收件箱本来就把 subject 为空的行渲染成 removed，改成 SET NULL 后行留下、对象消失。
--
-- 三条 DROP + ADD 在同一事务里执行（drizzle 把整个迁移包在一个事务里），
-- 现有行不受影响：改的是 ON DELETE 语义，不是列值。开发库与生产库都没有孤儿行。
ALTER TABLE "notification" DROP CONSTRAINT "notification_topic_id_topic_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_post_id_post_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_resource_id_resource_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE set null ON UPDATE no action;