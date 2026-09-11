-- 「验证后才能写」上线前的一次性既往不咎。
--
-- user.email_verified 全库为 false（列有默认值，从来没人写过它），
-- 而新规矩是未验证不能写。不刷的话，上线当天每一个现存用户下次发帖
-- 都会被 403 拦住——包括站长本人，以及 shrine 种子账号（六篇引导帖
-- 与站规都挂在它名下）。
--
-- 分界线就是这条迁移跑的时刻：它跑在部署流程的 migrate 步骤、up -d 之前，
-- 所以此刻之前注册的账号既往不咎，之后注册的才受新规矩管。
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
