# M4 博丽神社设计调研（2026-08-30）

11 个 agent 的并行产物：4 份挖掘 + 4 份设计 + 3 份对抗审查，合计约 7600 行。

**这些是原始材料，不是决定。本文是决定。**

四份设计是并行写的，谁也没读谁，在 14 处给出互相排斥的结论，其中 3 处落在不可逆红线上。
三份审查提出 59 条问题（22 条 P0），并砍掉了设计方约一半的增量。
本文逐条裁决，产出 M4 的最终范围。**正式实施计划见 `docs/superpowers/plans/`，它应当直接引用本文的裁决结果。**

---

## 范围决策：为什么比设计方案小得多

四份设计合计提出 **4 张新表 / 16 条新路由 / 8 个页面 / 118 条新文案 / 13 值通知枚举 / 12 个通知挂点 / 2 个新脚本 / 8 个新 shadcn**。

本文收敛到 **1 张新表 / 11 条新路由 / 6 个页面 / ≈75 条新文案 / 7 值通知枚举 / 7 个通知挂点 / 0 个新脚本 / 5 个新 shadcn**。

M3 那条方法论纠正在 M4 必须**双向**使用：

> 空库上「现在不建以后要迁移」不是理由；
> **同样地，「这个决定不可逆所以现在必须定」也不是理由——不可逆决定的正确处置是「能不做就先不做」，因为不做是可逆的，做了才不可逆。**

设计方在东方表情上把这条规则用反了（自己写下「shortcode 词表在不可逆那一档」「同人图的使用许可踩本站生死线」，然后把它列进要做）。

砍掉的东西：

| 砍掉 | 理由 |
|---|---|
| `board` 表 | 它那条「决定性」外键论证挡不住它声称要挡的错误：`boardSlug` 唯一写入口是 `z.enum` 闭合 6 值，用户打错得 400；唯一能打错的是常量本身，而表的六行是从同一个常量 seed 的。改为一条 CHECK，DB 层保证一模一样，零表零 join |
| `topic_subscription` + `subscription_state` + mute + 订阅 UI | 设计方证明的是「订阅不能塞进 favorite」（how），不是「M4 要有订阅」（whether）。它唯一真正产生通知的那条边（我的资源有新评论）不需要表：`resource.uploaderId` / `topic.authorId` 就在行上。订阅表记录的是「既不是楼主也不是被回复者的第三个人」——正是冷启动不存在的东西 |
| 通知折叠（`collapse_key` / `count` / 部分唯一索引 / upsert arbiter / 优先级 Map） | 折叠的成本收益完全由扇出规模决定，而扇出的全部规模来自订阅。删掉订阅后一次回复产生 ≤2 行通知。它是全部文档里最贵、四条沉默失败性质最多的一段 SQL，服务的是上线首月不出现的场景 |
| `post_like` + `likeCount` + like 通知 + 2 条路由 + `recount.ts` | 「3 个赞好过 0 条回复」成立的前提是有 3 个人读到了那条帖——上线首月稀缺的正是读者，点赞造不出读者。首月的反馈由站长逐条回复提供，那需要 reply 通知不是点赞。连带消掉 likeCount 漂移、最热读路径上的 `likedByViewer` join、以及一条完整的骚扰链路（点赞轰炸顶满收件箱） |
| `topic.lockedAt` + `/moderate`（pin/lock/move）+ `TOPIC_MODERATE_ACTION` + `topic_locked` 错误码 | 「资源下架必须自动锁」这条论证已被可见性白名单联查拆掉（白名单不会漂移，钩子会）。剩下的唯一用途是版主锁一个吵起来的版块主题，首月数量 0，而项目已有两条「罕见 staff 动作走 SQL」的先例 |
| 游标分页 + `cursor.ts` + 置顶抽出流外 | offset 漂移论证正确，但要有第二页才会发生：首月全站主题数 < 一页。它的表现（翻页看到一条重复主题）是所有 bug 里最良性的。代价是编解码 + 「短页不代表到底」这条反直觉契约（而该契约的理由与它上方自己写的 SQL 矛盾） |
| 东方表情整条（词表 / remark 插件 / EmojiPicker / `public/emoji/`） | 唯一被删掉的产品文档明列内容。它既踩不可逆红线又踩生死线（同人角色图的使用许可），而收益是「帖子里能插小图」——`![](url)` 已经做得到 |
| `@` 补全 + 它需要的用户搜索端点 | 设计方自己写完了这条推理：handle 可读之后补全从必需品降级为便利。且那个搜索端点在 16 条路由预算里根本没被计价，还需要枚举防护 |
| `/settings` 页面 | 「自选一次后锁定」意味着它的真实受众是「在注册表单加 handle 字段之前就已注册的普通用户」——上线时这个集合是空的 |
| `content_blocked` 硬词表 | 设计方自己写「不做变体检测、不做星号替换」。不做变体检测的词表绕过成本是插一个空格，挡不住任何真心要发的人，只误伤正常用户。本站真正的法律机制是举报→下架→`takedown_request`，M3 已做完 |
| `duplicate_content` 规则与错误码 | 冷启动期会误伤（「谢谢」在两个主题各发一次即被拒），且交替两句即可绕过。15 秒冷却窗已覆盖它真正防住的那件事（重复提交） |
| `gc-notifications.ts` | 给一张一年内不会超过几千行的表配带比例熔断、分批 DELETE、双开关的清理脚本。M3 砍 `storage_gc_queue` 用的是同一条判据 |
| `mod_queue` 通知 + `user_profile_staff_idx` | 收件人集合是「当前 staff」而通知是历史行，提权降权后旧未读指向错的人。它是查询不是事件。改为 `/dash` 导航计数 |
| 通知 kind 13 → 7 | 按「上线首月会不会触发」筛，6 个永远不会亮 |
| 个人主页三 tab → 一 tab | 「投稿」与 `/kourindou` 列表重复且 M3 没有 `?uploader=`；「收藏」按设计方自己的判定是仅本人可见——那是「我的收藏」页不是主页功能 |

**反过来，这几件不能省**（真正不可逆、修既有 bug、或不做就转不起来）：

- **可见性闸门收口成一个函数 + 一个表达式**，`content/post.ts` 签名收 `TopicView` 而非裸 `topicId`——闸门今天已经在漂移，而这是净减代码
- **删掉 `/kourindou/resources/:slug/posts`，`/api/shrine` 独占**——同一张表两个写入口 = 两份可见性判断 = 必然漂移
- **`user_profile.handle`**——M4 唯一同时命中「已发出 URL」与「已发布正文」两条红线的字段
- **`lastPostAt` 改 NOT NULL DEFAULT now()** + **资源主题不存 title**——两个上线当天必然发生的 bug
- **`postCount` → `floorSeq` 改名**——现名邀请人写 `- 1`，真写了会让该主题永久发不出帖而错误信息说「主题不存在」
- **`gc-images` 加扫 `post.bodyMd`**——不改必炸，且熔断挡不住
- **发帖限流**——仓库里一处限流都没有，`rate_limited` 是空悬码。公网上一个开放的写端点会被扫，与社区规模无关
- **六篇引导帖 + 一篇站规**——整个 M4 最高杠杆的一件事，而它在四份文档里从未作为一件要做的事出现过

---

## 一、文档索引

| 文件 | 内容 | 价值 | 是否被推翻 |
|---|---|---|---|
| `mined-legacy-comments.md` | legacy 评论系统全部约 110 行代码的逐行提取；19 类缺陷对账（M3 修 13 剩 6）；新发现 N1–N4 / D2 | **高**：真正的产出是缺陷目录与 N1（handle 缺失）这条不可逆判定 | 否 |
| `mined-reusable.md` | M3 留给 M4 的可复用机制逐个签名与表结构；「必须改 7 处」清单 | **高**：举报 `targetKind` 零改动、`gc-images` 必炸两条都源自这里 | 否 |
| `mined-forum-mechanics.md` | NGA/Discourse/贴吧/V2EX 机制按三条现实约束取舍；规模型 vs 形状型分类法 | **高**：「三种死法」与「形状型才值得现在花注意力」是全部裁决的判据来源 | 部分：建 `board` 表的建议被推翻；未读标记水位线建议被推翻 |
| `mined-notification.md` | 通知方案空间；宽表 vs 侧表；折叠；提及；审核挂点逐点裁决 | **高**：宽表 + 写扇出 + `read_at` 的选型正确，挂点分析可直接用 | 部分：折叠被删（因订阅被删）；staff 待办通知被自己后续否决 |
| `designs-schema.md` | 4 张新表 / 5 列 / 索引总表 / onDelete 决策表 | **中高**：`floorSeq` 改名、`lastPostAt` NOT NULL、`title` CHECK、`gc-images` 逐字匹配四条是全设计最有价值的部分 | **是**：`board` / `topic_subscription` / `post_like` 三张表被删；`lockedAt` 被删；13.1 的「失败方向安全」论证被 P0-3 掀翻 |
| `designs-api.md` | 挂载点 / 16 条路由 / zod 落点 / 分页 / 权限矩阵 / 限流 | **中高**：`/api/shrine` 独占与 `loadVisibleTopic()` 是全设计最重要的一条判断 | **是**：游标分页被删；`/moderate` 被删；`replyCount` 被删；6 个错误码收到 2；§1.4 与 §2 自相矛盾（说不需要 lockedAt 又给了 lock 端点） |
| `designs-web.md` | 8 条路由 / 空态 / discussion 五件套 / Markdown 管线 / i18n 118 key | **中高**：Markdown 管线（不装 `rehype-raw`、className 白名单、id 全禁）是全设计安全价值最高的一段 | **是**：双模空态被简化；`postCount>0` 才进流被推翻；表情与 @ 补全被删；`/settings` 被删；`PostView` 手写违背类型主轴；§5.5 的站内链接判定有可绕过的洞 |
| `designs-notification.md` | 2 表 / 4 路由 / 13 值枚举 / 12 挂点 / SAVEPOINT 判据 / GC 脚本 | **高**：挂点行号全部核对属实，是四份设计里质量最高的一份 | 部分：订阅表与折叠被删；13 值收到 7；GC 脚本被删；§4.0 的优先级去重会静默丢通知；「治理动作都有幂等闸门」这个前提只有 `/review` 成立 |
| `critiques-gaps.md` | 7 个 P0 + 11 个 P1 + 10 个 P2，逐条 `file:line` 验证 | **极高**：`/u/:handle` 泄漏、投稿者可摧毁自己的评论区、`gc-images` 失败方向反了、`/\evil.com` 绕过——四条都是「按设计写出来会丢数据或泄漏」 | 否 |
| `critiques-simplify.md` | 14 处矛盾裁决表 + D1–D14 削减 + G1–G8 反向缺口 | **极高**：4 表 → 1 表的削减链条（尤其「删订阅连带消掉折叠」）；G1 引导帖是全文最重要的一条 | 否 |
| `critiques-integration.md` | 与真实代码/dev 库的接缝；16 个 S 级问题；46 个必改文件清单 | **极高**：dev 库实测数字推翻了三份设计共用的「库里没有数据」前提；举报队列没有处置动作；`strikeCount` 链条是断的 | 否 |

**一句话**：三份审查的价值高于四份设计。设计文档的价值集中在少数几条具体判断上（见上表「价值」列），其组织性结论（表、路由、页面的数量）基本被推翻。

---

## 二、裁决表

### 2.1 不可逆项（发出去就改不动，必须动工前定死）

| # | 争议点 | 设计方 | 审查方 | **裁决与理由** |
|---|---|---|---|---|
| R1 | 六个版块 slug | api: `tea-party` `danmaku-lab` `workshop` `music-hall` `kappa-heavy` `meta`；web: `tea-house` `danmaku` `workshop` `music-hall` `kappa` `meta` | 站长拍板，倾向短的一套 | **取短的一套：`tea-house` / `danmaku` / `workshop` / `music-hall` / `kappa` / `meta`。** 判据是 URL 段越短越经得起口头传播与 IM 粘贴，且英文 slug 本来就不是中文名的翻译。**这条仍列进站长确认清单**（见 §5），因为它是纯命名偏好且不可逆 |
| R2 | handle 字符集 | schema: `^[a-z0-9][a-z0-9_]{1,19}$`；api/notification: `^[a-z0-9_]{2,20}$` | 取交集 | **取 `^[a-z0-9][a-z0-9_]{1,19}$`。** 不可逆字段上窄的可以以后放宽（additive），宽的不能收紧；且 schema 那份的 `_admin` 视觉冒充论证成立，另外两份没有反驳它，只是没考虑到 |
| R3 | handle 可空性 | schema: NOT NULL + 重试 5 次；notification: 可空，三次都撞落 null；web: 为可空写了 redirect 分支 | 取 NOT NULL | **NOT NULL。** 可空会让「没有 handle 的用户」这个状态出现在 @解析 / `/u/:handle` / 通知渲染三条路径的每个分支里；「落 null 继续」会让 NOT NULL 变成谎话。回填 603 行 dev 数据是一次性成本 |
| R4 | handle 生成与修改 | 注册时自动生成随机串 + 可自选一次覆盖；staff 代改走 SQL | 改在注册表单收 + 从 `user.id` 派生兜底，删 `/settings` | **注册表单收 + 派生兜底，删 `/settings` 页面，保留 `PUT /api/me/handle` 作为 claim 落点。** 见 §2.6 的实现修正——三份设计都假设 API 能挂在注册流程上，而 `register.tsx:25` 走的是客户端 `authClient.signUp.email`，API 根本看不到注册 |
| R5 | 主题 URL 用 uuid 还是全局序号 | 两份都倾向 uuid | 照办 | **uuid。** 序号会公开主题总数（上线第二周 `/shrine/t/7` 昭告这里只有 7 个主题，正中失败模式 A）；且序号是纯 additive 升级（加一列 `seq`，旧 uuid 链 301） |
| R6 | 东方表情 shortcode 词表 | 要做，词表待定 | 整条删 | **整条删。** 见范围决策表。这消掉了一个不可逆决定，而不做是可逆的 |

### 2.2 数据模型

| # | 争议点 | 设计方 | 审查方 | **裁决与理由** |
|---|---|---|---|---|
| D1 | `board` 建表还是常量 | schema 建表（决定性理由是外键）；api/web 不建表 | simplify 删表；integration 折中：建只有 slug 的 6 行表当外键目标 | **不建表 + `topic.boardSlug` 加 CHECK 白名单。** 外键挡不住它声称要挡的那个错误（表的六行与 zod 枚举 seed 自同一个常量，常量错了外键目标一样错），而 CHECK 提供了同样的 DB 层保证、零表零 join。折中方案（只建 slug 表）比 CHECK 多一张表、多一次 join、多一条 seed，买到的只有「加版块不用部署」——而不建表方案里加版块本来就要一次部署。同一份 schema 文档在 `report.targetKind` 上做过相反判决，两处形状完全相同 |
| D2 | `topic_subscription` | 建表，三条理由 | D2 删 | **删。** 它证明的是「不能塞进 favorite」不是「M4 要有订阅」。收件人由 `topic.authorId` / `resource.uploaderId` 推出。**这是产品文档「订阅」项的部分推迟，必须写进计划书让站长看见** |
| D3 | 通知折叠 | 「绝不砍」 | D3 删 | **删。** 折叠的全部复杂度来自扇出，扇出的全部规模来自订阅。D2 成立则 D3 自动成立。补做是教科书级 additive（旧行 `collapse_key` 为 null，而 NULL≠NULL 使存量数据天然兼容——文档自己写的） |
| D4 | `post_like` | 建表，「失败模式 B 的上半段」 | D4 删，承认是最接近边界的一刀 | **删。** 它自己的通知设计把 `like` 排在「超出预算按顺序砍」的第一位。列进站长确认清单（§5 问题 5）——这是唯一一条可能因偏好而翻转的裁决 |
| D5 | `topic.lockedAt` | schema 加；api §1.4 说不需要但 §2 又给了 lock 端点 | D5 删 | **删列、删端点。** 可见性白名单已经兑现了「资源下架即停写」，而白名单不会漂移 |
| D6 | `topic.pinnedAt` | 加，证伪条件是「计划里有没有六篇引导帖」 | 保留列，删写它的端点 | **保留列，无写端点。** 引导帖在计划里（T9 硬交付物），证伪条件满足；置顶由 seed 脚本或一条 SQL 完成 |
| D7 | `postCount` / `floorSeq` / `replyCount` | schema 改名不加 `replyCount`；api 保留 `postCount` 并新增 `replyCount` | 采纳 schema | **改名 `floorSeq`，不加 `replyCount`。** `replyCount` 需要在发帖 +1 / 软删 -1 / 恢复 +1 三处维护，而 M4 只有软删没有恢复端点，站长走 SQL 恢复时不会记得更新它 → 永久偏低。展示值按 kind 从 `floorSeq` 推（版块主题 -1，资源主题不减） |
| D8 | `post.locale` | 只出现在 designs-web，不在 schema 预算里 | S8 要求补进预算 | **进预算。** 它是全文档性价比最高的一项：一列一属性，修掉一个今天就存在的显示错误（日文帖被渲染成中文字形）。`createPostSchema` 加 `locale`，`LOCALES` 与 `localizedTextSchema` 一起从 `kourindou/` 上提 |
| D9 | 零回复的资源主题进不进最新流 | schema 进；web 不进（`postCount > 0`） | 裁决为进 | **进。** 这是「资源站供血」的唯一实现。web 若担心稀释信号，正确做法是在行上区分视觉权重（封面缩略图 + 「来自香霖堂」徽章），不是从流里删掉 |
| D10 | `NOTIFICATION_KIND` | schema/api 5 值（治理类塞 payload）；notification 13 值扁平 | 形状取扁平，值集筛到 6 | **扁平 7 值：`reply` / `mention` / `review_approved` / `review_rejected` / `resource_delisted` / `resource_deleted` / `post_deleted`。** 形状取 notification 那份（两层把判据藏进 jsonb，TS 与 pgEnum 都管不住，而 web 侧仍要写 N 个分支）。值集比 simplify 的 6 值多一个 `resource_deleted`——它是 simplify 那张表的遗漏（它把 `mod_queue` 误当成 13 值之一），而两条生死线移除路径（下架、删除）必须都通知 |
| D11 | `MODERATION_ACTION` 加什么 | schema 只加 `topic_lock`；api 加 `topic_moderate`；notification 代码里写 `post_delete` | 采纳 schema | **一个值都不加。** 锁帖随 D5 删掉，`topic_lock` 失去用途；删楼用 `soft_delete` + `subjectKind='post'`，因为 `subjectKind` 就是用来区分对象的（审计的过滤维度是 `(action, subjectKind)` 二元组），加 `post_delete` 会造出「同一件事两个动词」 |
| D12 | `REPORT_REASON` | 加 `spam` / `harassment` | 一致同意 | **加。** 现有五值全是资源语义，论坛最高频的两类举报无处可选，队列会退化成一堆 `other`。typecheck 会在 `dash/reports.tsx` 的映射表上强制补两条文案 |
| D13 | `report.targetKind` | 一个值都不用加 | 一致同意 | **不加。** 主题正文 = floor 1 的 post，`'post'` 全覆盖，且 M3 时 `interactions.ts:136-146` 就写完了。**顺带把 `z.enum(['resource','post'])` 的就地字面量提成 `REPORT_TARGET_KIND` 常量** |

### 2.3 API 与闸门

| # | 争议点 | 设计方 | 审查方 | **裁决与理由** |
|---|---|---|---|---|
| A1 | 挂载点 / 要不要删掉资源侧评论 URL | api 主张删，但列进「待拍板」 | 三份审查一致要求现在做；integration 指出这不是保守 vs 激进而是「有没有第二套闸门」 | **现在做，在第一个功能 PR 之前。** 此刻 12 个调用点（`detail.tsx` 2 处、`content.test.ts` 约 10 处、`e2e.ts:189`），M4 之后 30+。且它是编译期可发现的重构——删掉 `.route('/kourindou', content)` 会让所有调用点报错，那是唯一能穷举它们的机制 |
| A2 | 可见性闸门的形状 | schema `visibleTopic()` 返回 5 字段；api `loadVisibleTopic()` 返回 12 字段 `TopicView` | 合成一个；且必须同时有表达式形式 | **两个都要，放 `apps/api/src/modules/content/visibility.ts`（不放 shrine——消费者含治理模块）：** `visibleTopicWhere()` 是一个可复用的 drizzle 表达式（给列表路径：最新流、`/u/:handle`、通知收件箱），`loadVisibleTopic()` 是取单行的函数（给 topic/post 读写）。**只有函数不够**：函数只能被「取一行」的路径复用，列表路径必然各写一遍 WHERE，那就是漂移的源头 |
| A3 | `topicForResource()` 的去留 | 保留 | 必须删除，不是并列 | **删除。** 它只按 `resourceId` 取行，`topic.deletedAt` 不在 WHERE 里——今天一个被软删的资源主题，楼层仍会在资源页完整列出，而发帖返回 404。M3 侥幸的真实原因是 M3 没有任何路径会软删 topic；M4 第一次给出这个能力，这条路径当天就活 |
| A4 | `createPost` 的签名 | api 改成收 `TopicView`；notification 按现签名在 `:59-66` 与 `:86-95` 之间打补丁 | 指定唯一目标签名 | **`createPost(tx: Tx, topic: TopicView, input)`。** 三处改动一起：收 `tx`（否则 `POST /topics` 建主题与建 1 楼跨两个事务，会产生「没有主楼的主题」）、收 `TopicView`（让「没过闸就拿不到参数」成为编译期事实）、通知挂点改成结构描述（「在 `insert(post)` 之后」）而非行号 |
| A5 | 主题列表分页 | 游标 keyset + 置顶抽出流外 | D6 删，沿用既有 offset | **沿用 `paginationQuerySchema`（offset）。** 首月全站主题数 < 一页，根本没有第二页。置顶不抽出流外，直接进排序键 `ORDER BY pinned_at DESC NULLS LAST, last_post_at DESC`，全站流与版块页同一条。**这顺带消掉了 P0-6 的整个故障链**（置顶被排除、`total` 不返回、空态不触发） |
| A6 | 楼层分页 | 楼层区间 + 服务端定死 `POSTS_PAGE_SIZE` + 吸附页边界 | 明确「不在削减之列，必须做」 | **做。** 它替换现有 OFFSET 代码而不是新增，比被替换的更短，且是 `?floor=137` 深链稳定的前提 |
| A7 | 通知列表分页 | api 游标；notification offset | — | **offset**，与 A5 一致。折叠已删，「折叠行冒泡导致翻页错乱」这条游标理由随之消失 |
| A8 | 新增错误码 | 6 个 | 收到 3 个 | **收到 2 个：`mention_limit_exceeded` / `link_not_allowed`。** `topic_locked` 随 D5 删；`content_blocked` 随词表删；`handle_taken` 复用 `duplicate_slug`（它今天在全仓也没有抛出点，正好给它第一个抛出点）；`duplicate_content` 连同规则一起删——冷启动期会误伤真实用户且交替两句即可绕过，而 15 秒冷却窗已覆盖它真正防住的那件事 |
| A9 | 限流放哪一层 | 发帖前一次 SQL 守卫，复用 `post_author_idx` | 泛化到 report / like / upload / handle | **`assertRate(actor, bucket)`，bucket ∈ `post` / `report`；上传用进程内 Map。** 发帖与举报都有现成的表和 `(author_id, created_at)` 索引，SQL 守卫跨副本精确、零依赖。上传没有记录表，而为它建一张表在 M4 没有第二个用途——进程内计数对「一个 bot 几分钟内填满 MinIO」这一种失败完全有效。**触发条件：出现第二个 api 副本，或第一次真实滥用** |
| A10 | 举报的 `report_open_uq` | 未提 | P1-6 要求 | **加。** `uniqueIndex('report_open_uq').on(reporterId, targetKind, targetId).where(status='open')`，形状与 `circle_claim_open_uq` 逐字相同。solo 运营下举报队列是论坛唯一的「审」入口，埋掉它等于关掉整个治理通道 |
| A11 | 编辑时间窗 / staff 能否编辑他人正文 | 无时间窗；staff **不能**编辑他人正文 | 一致赞同，但警告 `isOwnerOrStaff` 是肌肉记忆 | **照办，并加护栏：** `middleware/require.ts` 加具名的 `isSelf(actor, ownerId)`，让正确写法比错误写法更短；`PATCH /shrine/posts/:id` 与「moderator 编辑他人楼层 → 403」的测试同一个 PR。`isOwnerOrStaff` 在仓库里出现 6 次且全部是「作者或 staff」，靠注释防住第 7 次不现实 |
| A12 | 举报端点搬家 | P2-3 建议搬到 `/api/reports` | 未反对 | **搬。** web 端零调用方，现在改接近免费；M4 之后论坛与香霖堂两侧都要调它，留在 `/kourindou` 下要动两个模块的前端 |
| A13 | 论坛违规是否推进 `strikeCount` | 四份文档都没发现这条链是断的 | S10：论坛灌水者在香霖堂仍然「即发即审」 | **推进。** staff 删他人楼层必须给 `reason: z.enum(REPORT_REASON)` + 可选 note；理由 ∈ `['spam','harassment','illegal','copyright']` 时同事务 `strikeCount + 1`，与 `/review` 的现有机制同形。这同时让 `moderationLog` 的删楼记录带上可过滤的类别 |
| A14 | `canAutoPublish` / `approvedResourceCount` | api 说列名是资源语义的 | 只改函数名 | **只改函数名 `canAutoPublish` → `canAutoPublishResource`**（3 个调用点，零 DB 改动）。列名本来就准确；改列名要动 10 个文件 + 603 行 dev 数据，收益为零。真正的风险是两个通用名（`canAutoPublish` / `canPostLinks`）并排时被拿错 |
| A15 | 外链禁令的判据 | `strikeCount===0 && (approved>=threshold \|\| accountAge>=3天)` | P1-5：没有 staff 豁免，站长发不出自己的引导帖 | **加 staff 短路 + 阈值进 `siteConfig`，上线首周设 0。** 冷启动期默认值应当是「先放开、出事再收紧」——与资源侧「先审后发」相反是对的，因为帖子可删、资源分发不可撤。`accountAgeDays` 的基准是 `user_profile.createdAt`（首次带会话访问 API 的时间，不是注册时间），写进注释 |

### 2.4 前端

| # | 争议点 | 设计方 | 审查方 | **裁决与理由** |
|---|---|---|---|---|
| W1 | `/shrine` 空态 | 双模：`total < 10` 自动切换成「版块网格 + 最近资源横排」，需要第二个 loader 请求 | D13 简化成单一形态 | **顶部永远渲染六版块静态网格（纯 chrome，零请求），下面是混排最新流。** D9 裁决为「零回复资源主题进流」之后，最新流从第一天起就不空，双模切换、阈值常量、第二个请求全都不需要。**但必须保留原设计里真正重要的两条**：失败态与空态是两个分支；通知中心空态必须写清通知会从哪几处来 |
| W2 | Markdown 管线 | react-markdown + remark-gfm/breaks + rehype-sanitize，坚决不装 `rehype-raw` | 一致赞同，是全设计安全价值最高的一段 | **照办，加三处修正：** ① `protocols: { ...defaultSchema.protocols, href: [...] }`（原写法整体替换掉了 `defaultSchema.protocols`，`img.src` 因此失去协议白名单）；② 表情删除后净化 schema 的 `'*': []` 全覆盖，`img` 不再有 className 例外；③ 站内链接判定见 W3。**「任何 PR 里出现 `rehype-raw` 都是安全事故」写进 CLAUDE.md，不是写进注释** |
| W3 | 站内链接判定 | `href.startsWith('/') && !href.startsWith('//')` | P0-4：`/\evil.com` 与 `/<TAB>/evil.com` 都能绕过 | **改成两道：先 `href.replace(/[\x00-\x20]/g,'')` 剥控制字符，再 `/^\/[^/\\]/` 挡形状，最后 `new URL(clean,'https://internal.invalid').origin === 'https://internal.invalid'` 复核。** 判错方向的代价是一个站内链接变成新标签页，而不是一次钓鱼。同一条 `classify()` 复用到 `safeNext()` |
| W4 | `PostView` 类型 | 手写 21 字段在 `app/components/discussion/types.ts` | S11：违背 CLAUDE.md 的类型主轴 | **定义在 `packages/shared/src/shrine/` 作为响应契约类型，与 zod 输入 schema 并列；`toPostView()` 是 service 里的唯一一个函数，路由层不许自己拼投影。** 组件只收 `action` 路径字符串这条边界判断是对的，但它的前提是共用同一个 serializer 与同一份类型 |
| W5 | 个人主页 tab | 三个（帖子 / 投稿 / 收藏） | D14 收到一个 | **只留「帖子」，删 counts 三个数字。** 顺带消掉「收藏默认公开还是仅本人可见」整个开放问题 |
| W6 | `shrine/layout.tsx` | 一个 layout 路由 | 降级为组件 | **降级为组件。** 版块导航条复用是组件的职责，不是路由的 |
| W7 | shadcn 补几个 | 8 个 | 5 个 | **5 个：`tooltip` / `alert` / `alert-dialog` / `pagination` / `breadcrumb`。** `popover` 与 `scroll-area` 的全部使用场景随表情与 @ 补全消失；`sonner` 随点赞消失。**一律 `asChild`，粘来的 `render=` 在 `radix-ui@1.6.7` 编译不过** |
| W8 | 帖子语言 | 不标语言、不筛选、不做翻译入口，只存 `post.locale` 当 `lang=` | 一致赞同 | **照办。** 三条不做的理由都成立：短回复上 zh/ja 纯汉字检测几乎必错，标错的徽章比没有更糟；翻译按钮是一次质量承诺，把「社团允许再分发」翻反是踩生死线 |
| W9 | 错误文案命名空间 | 新建 `err_*` + 集中式 `errorLabel(code)` | S12：与四条既有 per-page key 并存，且 key 名与 code 名对不上 | **一并收口：** `upload_failed` / `dash_action_failed` / `admin_config_failed` 迁进 `errorLabel()`，`load_error` 保留作 default；key 名逐字跟 code 走（`err_link_not_allowed` / `err_mention_limit_exceeded`）；补 `report_target_post` / `report_target_resource`（`dash/reports.tsx:104` 今天渲染的是裸英文） |

### 2.5 通知

| # | 争议点 | 设计方 | 审查方 | **裁决与理由** |
|---|---|---|---|---|
| N1 | 数据模型 | 一张宽表 + 写扇出 | 赞同 | **照办。** per-user 的 `read_at` 无论如何要占一行，侧表只省几十字节却给最热读路径加一次 join |
| N2 | subject 指向 | 类型化可空外键；purge 类只存标题快照 | 「最漂亮的一处推理」 | **照办。** `resource_deleted` 绝不能带 `resourceId` 外键——purge 会在同一个事务里把通知自己级联删掉，作者永远收不到，而**症状是「什么都没发生」**。这条必须有 e2e 覆盖，那是唯一能发现它的方式 |
| N3 | 产生时机与事务 | 同请求同事务；发帖扇出包 SAVEPOINT，治理动作不包 | P1-11：「治理动作都有幂等闸门」只有 `/review` 成立 | **判据保留（有幂等闸门可重试的动作让通知失败连坐，没有的必须隔离），把闸门补齐。** 收敛之后只有 `DELETE /resources/:id`(soft) 同事务带通知且缺闸门，补一句 `deletedAt` 检查即可。`/license` `/role` `/reports/resolve` 随通知 kind 收敛而不再带通知——但 `resolve` 能把已 resolved 的举报改成 rejected 并覆盖 `resolvedBy`，那是一个独立的既有 bug，列进「顺手修」 |
| N4 | SAVEPOINT | 强制，不是「多五行换安全」 | 「硬事实，不是风格」 | **照办，即使扇出只有 1–2 行也要包。** PG 里事务内任何错误都让事务进 aborted 状态，裸 `try/catch` 救不回发帖，只会把失败变成 25P02 这种更难懂的形式。必须用 drizzle 的 `tx.transaction()` |
| N5 | `notify()` 的去重 | 按 `KIND_PRIORITY` 全局去重 | P1-10：其余 10 个治理 kind 全部 `?? 0`，同批次第二条会被静默丢弃 | **去重只对 `RANKED = {mention, reply}` 生效，不在集合里的行直接入队。** 折叠删除后 PG 21000 的前置条件消失，去重回归纯产品规则（一个人一次动作只收一条），但静默丢通知的地雷必须拆掉——通知不可重算，丢了就是永久丢 |
| N6 | 收件箱可见性 | 5 个 LEFT JOIN，无可见性谓词 | P1-4a | **join 后对不可见 subject 把标题渲染成「该内容已被移除」，行本身保留。** 通知不是法律留痕，但它是「有没有告诉过用户」的送达副本，删行会破坏这个语义 |
| N7 | `quoted.excerpt` | web 要求返回，`PostView.quoted` 带 `deleted` 标志 | P1-4b | **`deleted === true` 时服务端置空，与 `listPosts` 的 `bodyMd: r.deletedAt ? '' : r.bodyMd` 逐字一致。** RR8 的 SSR 会把整个 loader 返回值序列化进 HTML——不置空的话，一条被版主删掉的骚扰内容会以明文出现在每一个引用了它的页面源码里。截断用 `[...str].slice(0,100)` 而非 UTF-16 切片 |
| N8 | 已读语义 | `read_at` 行级，否决水位线 | 折叠删除后第一条理由消失，其余两条仍成立 | **`read_at` 行级。** 「全部已读」用 `before` 游标而非 `all:true`——点击瞬间刚到的那条不该被吞掉 |
| N9 | 未读数 | 部分索引 + 100 截断，搭 `GET /api/me` | 赞同 | **照办。** 不做反范式计数器：部分索引随阅读自然缩小，是自愈的；计数器要在五处同步维护，漏一处永久漂移 |
| N10 | `markReadSchema` | api `z.object` + XOR refine；notification `z.union` | — | **取 `z.object` + XOR refine。** `z.union` 在 `{ids, before}` 同时给出时会静默走第一分支并剥掉 `before` |
| N11 | 邮件 / WebPush / SSE | 不做，且不预留任何列 | 赞同 | **照办。** 前置链的每一环都是硬门槛（邮箱验证 / 发信域名 DNS / 退订 / 退信 / 摘要节流），加起来是一个独立里程碑 |

### 2.6 本文新增的裁决（四份文档都没覆盖）

| # | 问题 | **裁决与理由** |
|---|---|---|
| X1 | **注册流程走客户端 better-auth，API 看不到注册** | `apps/web/app/routes/register.tsx:25` 调的是 `authClient.signUp.email`，`user_profile` 由 `sessionMiddleware` 在首次带会话请求时惰性创建。三份设计都假设「注册时生成/收取 handle」能挂在 API 上——**挂不上**。实现形状：sessionMiddleware 建档时写**派生 handle**（见 X2），register.tsx 在 `signUp.email` 成功后调一次 `PUT /api/me/handle` 认领用户自选的 handle；该端点只在 `handle_set_at IS NULL` 时接受写入。因此 `handleSetAt` 一列**保留**（D8 主张删它，那是基于「注册表单直接写 DB」的错误前提） |
| X2 | **handle 的生成方式** | **从 `user.id` 派生，不随机生成。** better-auth 的 id 是 32 位随机串；取 `u` + 小写后过滤成 `[a-z0-9]` 的前 8 位，冲突时确定性地延长前缀（+4 位，上限 19 位），耗尽则 500。这消掉了 `designs-schema` §9.4 花整节描述的随机重试死循环，且它是确定性的、必然终止的。**注意：前缀不继承 id 的唯一性**（simplify 的说法有误），所以延长逻辑不能省 |
| X3 | **`sessionMiddleware` 的惰性建档有两个会静默出错的坑** | `onConflictDoNothing()` 无 target，加了 handle 唯一约束之后会连 handle 冲突一起吞掉 → profile 建不成 → `returning()` 空 → actor 落默认值 → `strikeCount` / `approvedResourceCount` 的 `UPDATE ... WHERE user_id` 更新 0 行且不报错，**信任梯度对这个用户永久失效且无日志**。改成 `onConflictDoNothing({ target: userProfile.userId })` + **冲突后重新 SELECT 一次**（不再依赖 `returning()`）+ 对 handle 唯一违例单独 catch 并延长前缀。这是全站每个请求都走的路径 |
| X4 | **`DELETE /shrine/topics/:id` 会让投稿者永久摧毁自己资源的评论区** | 资源主题的 `authorId` 就是投稿者（`kourindou/index.ts:195-201`），而「无他人回复」在零评论时恒成立。删掉之后没有任何路径能恢复（`topic.resourceId` 有 `.unique()`，补插撞唯一约束）。动机不是误操作是**审查规避**。**裁决：`kind='resource'` 一律 409。** 资源讨论主题的生命周期归资源不归主题，「不让讨论继续」的正确动作是下架资源（可逆、留痕、通知作者），已经存在 |
| X5 | **举报队列没有处置动作** | 三份文档都只说「补投影」，没人指出 `reports.tsx:48-74` 的 `Actions` 只有 resolve/dismiss、都只改 `report.status` 不动目标。处理一条帖子举报的实际流程是「复制 uuid → 猜属于哪个主题 → 去删楼 → 回来 resolve」，而第 2、3 步今天做不到。**裁决：队列卡片加第三个按钮「删除该楼层」（走 `DELETE /shrine/posts/:id`）+ 投影补跳转零件 + `total` + 排序进 `orderBy`。一个混合队列 + `targetKind` 徽章 + 按 reason 优先级排序**——队列按紧急度分工而非按对象类型，solo 运营下分 tab 的唯一收益（分工）不存在 |
| X6 | **资源侧没有举报按钮** | `detail_favorite` / `detail_favorited` / `detail_report` 三个 message key 已定义但全仓无引用——API 端点齐全，UI 从来没做。M4 若只做帖子举报 UI 会出现「帖子能举报、资源不能举报」的倒挂，而**版权举报才是生死线那一条**。**裁决：顺手补上，边际成本是一个 `targetKind` 参数** |
| X7 | **`detail.tsx` 评论区无分页** | `:51-54` 传 `query:{}`，`paginationQuerySchema` 默认 `pageSize=20`，页面没有任何分页 UI——**第 21 条评论今天就看不见且无提示**。换 `<Discussion>` 时一并补 |
| X8 | **dev 库不是空的** | 实测：`topic` 672 行（657 行资源主题 title 非空、611 行 `last_post_at` 为空、10 行测试残留的 `board_slug='shrine'`）、`post` 177、`user_profile` 603。三份设计共用的「库里没有数据」前提**对生产成立、对 dev 库不成立**，而每次 migrate / test / e2e 都打在 dev 库上。**裁决：把说法改成「不可逆损失为零，但迁移必须写对，否则 dev 环境当场停摆」，三条回填 SQL 写进计划**（见 §4.3） |
| X9 | **测试直接往 dev 库写且不清理** | `packages/db/src/kourindou.test.ts:151` 是那 10 行垃圾的来源。M4 会大幅增加这类写入。**裁决：shrine 的测试必须接上 `test-support.ts` 已有的 track/cleanup 机制**（`content.test.ts` 已在用） |

---

## 三、M4 最终范围

### 3.1 新增表：1 张

| 表 | 一句话 |
|---|---|
| `notification` | 宽表 + 写扇出 + `read_at` 行级已读。收件人 cascade（收件箱是私有数据），触发者 `set null`（「你曾被回复过」不该因对方注销而消失），subject 是类型化可空外键 `topic_id`/`post_id`/`resource_id`，**purge 类通知不带任何外键、只在 `payload.title` 存快照** |

新 pgEnum：**1 个**（`notification_kind`，7 值）。
明确不建：`board` · `topic_subscription` · `post_like` · `post_image` · `post_mention` · `post_revision` · `topic_read` · `board_moderator` · `topic_tag` · `notification_pref` · `rate_limit` · `emoji` · `draft` · `sensitive_word` · `notification_event`+`notification_inbox`。

### 3.2 新增/改动列：4 新 + 1 改名 + 1 收窄 + 5 条 CHECK

| 变更 | 位置 | 理由 |
|---|---|---|
| `+ pinnedAt timestamptz` | `topic` | 承载六篇引导帖，无写端点（seed / SQL 写） |
| `+ locale varchar(5)` | `post` | 只用于 `<div lang=>`，修 CJK 字形被渲染错这个既有显示错误 |
| `+ handle varchar(20) NOT NULL UNIQUE` | `user_profile` | 唯一命中两条不可逆红线的字段 |
| `+ handleSetAt timestamptz` | `user_profile` | 「自选一次后锁定」的状态位（X1） |
| `postCount` → `floorSeq` | `topic` | 现名邀请人写 `- 1` |
| `lastPostAt` → `NOT NULL DEFAULT now()` | `topic` | PG 的 `DESC` 默认 NULLS FIRST |
| `CHECK topic_kind_shape` | `topic` | `kind='resource'` → `title IS NULL`（修既有 bug：标题快照不随 PATCH 更新且是单语的）；`kind='board'` → `title`/`boardSlug` 非空 |
| `CHECK topic_board_slug` | `topic` | 六值白名单，代替 `board` 表的外键 |
| `CHECK post_body_len` | `post` | `char_length between 1 and 20000`，legacy 缺 DB 层上限是未修的 6 条之一 |
| `CHECK user_profile_handle_fmt` | `user_profile` | 正则由 `handleSchema` 的同一个字面量派生，加测试断言两者一致 |
| `CHECK user_profile_handle_not_reserved` | `user_profile` | 只写在 zod 里的约束绕过 API 就没了，而这里的绕过后果是**不可逆冒充**（`@admin` / `@everyone` 被注册） |

索引：新增 `topic_latest_idx` / `topic_author_idx` / `notification_user_created_idx` / `notification_unread_idx`（部分索引 `WHERE read_at IS NULL`）/ `user_profile_handle_uq` / `report_open_uq`（部分唯一）；`topic_board_last_post_idx` 与 `post_author_idx` 重建带 DESC；**删除 `post_topic_floor_idx`**（与 `post_topic_floor_uq` 键完全相同，在全站最热的写表上白付一倍索引维护）与 `topic_kind_idx`（两值低选择性，无查询只按 kind 过滤）。

### 3.3 新增路由：11 条（另删 2、搬家 2，净 +9）

**`/api/shrine`（7 条新增 + 1 条搬入）**

| Method + Path | 权限 | 备注 |
|---|---|---|
| `GET /shrine/topics` | 公开 | offset 分页；`?board=`；`ORDER BY pinned_at DESC NULLS LAST, last_post_at DESC`；过 `visibleTopicWhere()` |
| `POST /shrine/topics` | `requireAuth` + `assertRate('post')` | 外层事务内调 `createPost(tx, ...)` 建 floor 1 |
| `GET /shrine/topics/:id` | 公开 | 过 `loadVisibleTopic()`；**必须返回 opening post**；`kind='resource'` 时返回 `resourceSlug` 供 301 |
| `DELETE /shrine/topics/:id` | 作者（`kind='board'` 且无他人回复）或 staff（`kind='board'`） | **`kind='resource'` 一律 409**（X4） |
| `GET /shrine/topics/:id/posts` | 公开 | 楼层区间 `?from=137`，服务端吸附页边界，`POSTS_PAGE_SIZE` 固定并回显 |
| `POST /shrine/topics/:id/posts` | `requireAuth` + `assertRate('post')` | |
| `PATCH /shrine/posts/:id` | **仅作者本人**（`isSelf`） | 无时间窗；staff 403；只对新增 handle 发提及通知 |
| `DELETE /shrine/posts/:id` | 作者或 staff | 搬家自 `/kourindou/posts/:id`。staff 必须给 `reason: z.enum(REPORT_REASON)`，同事务写 `moderationLog` + 通知 + `strikeCount` |

**`/api/notifications`（2 条）**：`GET /` · `POST /read`
**`/api/users`（1 条）**：`GET /:handle`（只有「帖子」tab，必须用 `visibleTopicWhere()` + `post.deleted_at IS NULL`）
**`/api/me`（1 条）**：`PUT /handle`（只在 `handle_set_at IS NULL` 时接受）

**删除 2 条**：`GET`/`POST /api/kourindou/resources/:slug/posts`
**搬家 2 条**：`DELETE /api/kourindou/posts/:id` → `/api/shrine/posts/:id`；`POST /api/kourindou/reports` → `POST /api/reports`

**修改既有响应**：`GET /kourindou/resources/:slug` 加 `topicId`；`GET /api/me` 加 `handle`/`handleSetAt`/`unread`；`GET /moderation/reports` 投影加目标上下文 + `total` + 排序进 `orderBy`。

**明确不做的路由**：`GET /shrine/boards`（六值常量）· `POST /topics/:id/moderate`（pin/lock/move 走 SQL）· 主题/楼层恢复端点（走 SQL）· `PUT /topics/:id/subscription`（订阅表已删）· 点赞 2 条 · `GET /api/users?q=`（@ 补全已删）· 通知偏好 · 未读标记 · 私信 · 帖子全文搜索。

### 3.4 新增页面：6 个（无新 layout 路由）

| 路径 | 说明 |
|---|---|
| `/shrine` | 全站最新流（默认视图）。顶部固定六版块网格，下面 board 主题与资源主题混排 |
| `/shrine/b/:board` | 单版块。loader 先用 `BOARD_SLUGS.includes()` 挡一道 |
| `/shrine/t/:id` | 主题详情。`kind='resource'` → 301 到 `/kourindou/:slug#discussion`；楼层进 query `?floor=137#p137`，`?page=` 在这个页面不存在 |
| `/shrine/new` | 发主题。未登录 → `/login?next=`；草稿走 localStorage（`useEffect` 内读 + `try/catch`） |
| `/notifications` | 通知中心。空态必须写清通知会从哪几处来 |
| `/u/:handle` | 个人主页，只有「帖子」tab |

版块导航条是**组件**不是 layout 路由。

### 3.5 必须改动的现有文件（M4 不是纯新增）

标 **高** 的五个是「改错了会静默出错」的。

**packages/db（11）**

| 文件 | 改什么 | 风险 |
|---|---|---|
| `src/schema/content.ts` | `topic`: 改名 `floorSeq`、`lastPostAt` NOT NULL、`+pinnedAt`、2 条 CHECK、索引重做；`post`: `+locale`、`+CHECK`、删重复索引、`post_author_idx` 加 `created_at DESC` | **高** |
| `src/schema/kourindou.ts` | `userProfile` 加 `handle`/`handleSetAt`/2 条 CHECK。**表定义从「无第二参数」变成有表级约束数组**——忘了第二参数 CHECK 会静默不生成 | **高** |
| `src/schema/shrine.ts` | 新建（`notification`） | — |
| `src/schema/index.ts` | `export * from './shrine'` | 低 |
| `src/kourindou.test.ts:151` | `boardSlug:'shrine'` → 正式 slug；补 `afterAll` 清理 | 低 |
| `scripts/seed-demo{,-tools,-fanworks,-official,-lilywhite,-official-free}.ts`（6 个） | 建 topic 时**删掉 `title`**。**抽成 `scripts/_shared/createResourceTopic.ts`**——它们现在是六份逐字重复的代码，正是一条 CHECK 会一次打穿六处的原因 | 中 |

（`scripts/seed.ts` 不改——`board` 表已删）

**packages/shared（5）**：`kourindou/enums.ts`（`REPORT_REASON` +2；`TOPIC_KIND` 迁出）· `kourindou/schemas.ts`（三种 id schema 上提到 `src/ids.ts`；`createPostSchema` 迁到 shrine 并加 `.trim()` 与 `locale`；`REPORT_TARGET_KIND` 提常量）· `kourindou/localized.ts`（`LOCALES` 上提）· `src/index.ts` · `package.json`（`"./kourindou"` 子路径导出的内容会漂移，顺手删掉或改成两条）

**apps/api（17）**

| 文件 | 改什么 | 风险 |
|---|---|---|
| `src/middleware/session.ts` | `Actor` 加 `handle`/`createdAt`；惰性建档改 `onConflictDoNothing({target})` + **冲突后重查**；handle 派生与延长；`canAutoPublish` 改名 | **高** |
| `src/modules/content/post.ts` | 签名改 `(tx, TopicView, input)`；**删 `topicForResource()`**；`listPosts` 改楼层区间 + 宽投影 + 单一 `toPostView()`；`createPost` 加提及/扇出/SAVEPOINT；`catch{}` 收窄到 23505；`findPost` 带主题上下文 | **高** |
| `scripts/gc-images.ts` | `referencedUrls()` 加 `post.bodyMd`（正则**锚死到 key 文法**）+ `siteConfig.announcement`；加交集自检；post 前缀宽限期 7 天 | **高** |
| `src/modules/content/visibility.ts` | **新建**：`visibleTopicWhere()` 表达式 + `loadVisibleTopic()`（放 content 不放 shrine——消费者含治理模块） | — |
| `src/modules/content/index.ts` | **整个删除**（三条路由搬走） | 中 |
| `src/app.ts` | `+/shrine` `+/notifications` `+/users` `+/reports`；**删 `.route('/kourindou', content)`** | 中 |
| `src/modules/kourindou/index.ts` | `GET /:slug` 加 `topicId`；建 topic 时不写 `title`、写 `lastPostAt`；`/status` 加通知挂点 | 中 |
| `src/modules/moderation.ts` | `GET /reports` 投影 + `total` + `orderBy`；`/review` 加通知挂点；`resolve` 补状态守卫 | 中 |
| `src/modules/admin.ts` | `DELETE` 的 select 加 `uploaderId` + 幂等闸门 + 通知（**不带 `resourceId` 外键**）；`restore` 补 `moderationLog` | 中 |
| `src/modules/interactions.ts` | post 分支加主题可见性；举报端点整体搬到 `/api/reports` | 中 |
| `src/modules/uploads.ts` | `purpose` 白名单加 `'post'`（现在是二元三目，未知值静默变 `cover`）；加上传限流 | 低 |
| `src/storage.ts` | `ImagePurpose` 加 `'post'` | 低 |
| `src/modules/me.ts` | 返回 `handle`/`handleSetAt`/`unread`；加 `PUT /handle` | 低 |
| `src/errors.ts` | 加 2 个码 + `handleParam`（**用不带保留字 refine 的 schema**——`/u/admin` 的正确答案是 404 不是 400） | 低 |
| `src/middleware/require.ts` | 加 `isSelf()` | 低 |
| `src/content.test.ts` | 基本重写；**5 条既有用例必须原样保留语义**，尤其并发楼层号 | 中 |
| `scripts/e2e.ts` | 端点改名 + 补 shrine 验收项 | 低 |

**apps/web（12）**：`routes.ts` · `routes/stub.tsx:8` · `routes/kourindou/detail.tsx`（换端点 + `<Discussion>` + `id="discussion"` + 404 三态 + **补分页** + **补举报按钮** + 回神社的链接）· `routes/dash/reports.tsx`（新投影 + 删楼按钮 + `targetKind` i18n + 两条新 reason）· `routes/dash/layout.tsx`（待办计数 + 「今天的新主题/新楼层」）· `routes/login.tsx`（`?next=` + `safeNext()`）· `routes/register.tsx`（handle 字段 + claim 调用）· `root.tsx`（`unread` + `imageHost`）· `components/site-header.tsx`（`SessionUser` 手写类型加字段 + 铃铛 + `/shrine` 从 stub 换真入口）· `lib/display.ts`（`boardLabel`/`boardDesc`）· `messages/{zh,ja,en}.json`（3 份，key 集合必须逐字相同）· `package.json`

**根目录（1）**：`CLAUDE.md` 加「博丽神社（M4）约定」小节，至少含：可见性只有 `visibleTopicWhere()` / `loadVisibleTopic()` 一个来源；`isSelf` vs `isOwnerOrStaff` 的边界；`requireAuth` 永远在 `entityIdParam` 之前；`floorSeq` 只增不减；扇出 SELECT 必须在事务外；**`rehype-raw` 禁令**；handle 不可逆。

**合计约 44 个既有文件 + 3 份文案文件。**

### 3.6 明确的不做清单

| 不做 | 理由 | 触发条件（什么时候回来做） |
|---|---|---|
| 点赞 | 上线首月稀缺的是读者不是表态意愿，点赞造不出读者 | 第一周出现 10 条以上非站长发的帖 |
| 显式订阅 / mute | 收件人可从 `topic.authorId` / `resource.uploaderId` 推出 | 第一个出现三个不同发言者的主题 |
| 通知折叠 | 扇出 ≤2 时不会变垃圾场；补做时旧行 `collapse_key` 为 null 天然兼容 | 第一个让某人一天内收到 10 条以上通知的主题 |
| 锁帖 / 置顶端点 / 移动版块 | 首月频次 0，走 SQL（项目已有两条先例） | 第一次有两个人在一个主题里吵起来 |
| 东方表情 | 既踩不可逆红线又踩生死线（同人图授权），收益是「能插小图」而 `![](url)` 已做得到 | 站长手上有了一批授权明确的表情图 |
| @ 补全 | handle 可读之后降级为便利；它需要的用户搜索端点从未被计价 | 注册用户上三位数 |
| `board` 表 | 外键挡不住它声称要挡的错误，CHECK 提供同等保证 | 第一次想加第七个版块且不愿为它跑一次部署 |
| 游标分页 | 首月没有第二页 | 任一版块主题数超过一页且回帖频率高到翻页期间会重排 |
| `/settings` 页面 | 「自选一次后锁定」使它的受众为空 | 第一个用户来信说想改名 |
| 硬词表 | 不做变体检测的词表绕过成本是插一个空格，只误伤正常用户 | 永不 |
| 踩 / 多 emoji 反应 / 加精 / 勋章 / 等级 | 加是 additive，撤不是 | 永不（前四项）；等级永不 |
| 未读标记体系 | 实现最复杂 × 冷启动价值最低，替代品是「最新流 + 相对时间」 | 一眼扫不完全站时 |
| 邮件 / WebPush / SSE / 轮询 | 前置链每一环都是硬门槛，加起来是独立里程碑 | 独立里程碑 |
| 私信 | 骚扰主通道，补的时候必须同时补拉黑与举报 | 独立里程碑 |
| 帖子全文搜索 | 要一条新 Meili 管道 + 不可见内容的权限过滤；主题标题搜索先顶着 | 主题数上千 |
| `gc-notifications.ts` / `recount.ts` | 为还没发生的规模写维护机制 | `notification` 超 10 万行 |
| 按语言分版块 / 语言徽章 / 翻译入口 | 把一个 0 帖社区切成三个 0 帖社区；标错的徽章比没有更糟；翻译按钮是一次质量承诺 | 语言分区：某语言用户成规模时 |
| 代码高亮 / 富文本 WYSIWYG / 无限滚动 / 服务端草稿 / 签名档 | 纯增强或已知负价值 | — |

---

## 四、P0 清单

实施时会反复查这一节。**「设计阶段解决」= 本文已给出裁决，实施时照抄即可；「实施时注意」= 需要在写那段代码时主动做对，编译器和测试兜不住。**

### 4.1 设计阶段已解决（本文即裁决）

| # | 问题 | 裁决 |
|---|---|---|
| P0-A | 四份设计在 14 处互相矛盾，3 处落在不可逆红线 | §2 全表。**在写第一行代码之前把 §2 的裁决抄进计划书的 Global Constraints** |
| P0-B | 六个版块 slug 两套值（对外 URL，不可逆） | `tea-house` / `danmaku` / `workshop` / `music-hall` / `kappa` / `meta`，落 `packages/shared/src/shrine/enums.ts` 单一文件（站长最终确认，§5 问题 1） |
| P0-C | handle 三套定义（可空性 / 正则 / 保留字 / 生成策略） | NOT NULL；`^[a-z0-9][a-z0-9_]{1,19}$`；保留字表取并集且**在 DB 层也有一道 CHECK**；从 `user.id` 派生 + 注册表单认领。**`handleSchema` 是唯一事实来源，DB CHECK 由同一个正则字面量派生，加测试断言两者一致** |
| P0-D | `NOTIFICATION_KIND` 5 值 vs 13 值 | 扁平 7 值（§2.2 D10） |
| P0-E | `/shrine` 默认视图三方矛盾，上线当天是白页 | 置顶进排序键不抽出流外；零回复资源主题进流；offset 分页有 `total`；六版块网格无条件渲染。**四条一起，故障链整条消失** |
| P0-F | `MODERATION_ACTION` 三份三个答案 | 一个值都不加（§2.2 D11） |
| P0-G | `board` 建不建表 | 不建，加 CHECK（§2.2 D1） |

### 4.2 实施时注意（会丢数据、会泄漏、或上线第一天就坏）

| # | 问题 | 必须做对的事 | 落在哪个 Task |
|---|---|---|---|
| P0-1 | **`/u/:handle` 的「他的发言」没有可见性闸门** —— 被下架资源与被版主删掉的楼层从个人主页泄漏。触发序列全是正常运营动作：资源被版权下架 → `/shrine` 与 `/kourindou` 都看不到了 → 但 `/u/A`、`/u/B` 仍公开列出「在《R 的标题》的 #2 楼」。一份因版权被下架的资源，标题、讨论内容、讨论者名单仍可被任何人经任一参与者主页枚举 | 闸门必须是**表达式**（`visibleTopicWhere()`）而不只是函数——函数只能被「取一行」的路径复用，列表路径必然各写一遍 WHERE。`/u/:handle` 的查询 `INNER JOIN topic` + `LEFT JOIN resource` 用同一谓词 + `post.deleted_at IS NULL`。**PR 模板加一条：任何新增能返回 `post` 行或 `topic.title` 的端点，必须回答「它用的是哪一份 `visibleTopicWhere()`」** | T3 / T8 |
| P0-2 | **投稿者可永久摧毁自己资源的评论区**（X4） | 三条都要：① `DELETE /shrine/topics/:id` 对 `kind='resource'` 一律 409；② 删掉 `topicForResource()`（它现在是一条会返回墓碑的查询）；③ 「删主题」的权限判断表达在 `resourceId IS NULL` 上，不是 handler 里一句 if | T3 / T4 |
| P0-3 | **`gc-images` 的「逐字子串匹配」失败方向是反的** —— 白名单里装的是**对象 key**（`url.slice(base.length+1)`），判定是精确字符串相等。正则若把闭括号吃进去，派生的 key 是 `post/xxx.webp)`，桶里是 `post/xxx.webp`，`has()` 为 false → **过 24h 宽限期后这张正在用的图被精确删掉**。熔断挡不住（封面还在，`keys.size` 远大于 0） | ① 正则锚死到 key 的完整文法（key 由 `storage.ts:111` 自己生成，文法是我们定的）：`escapeRegExp(base)+'/(?:avatar\|cover\|post)/[0-9a-f-]{36}\\.(?:webp\|png\|jpe?g\|gif)'`；② 加**自检**写进脚本：正文解析出的 key 与桶里 objects 求交集，命中率不足 90% 拒绝执行；③ 帖子图宽限期按 key 前缀调到 7 天（草稿被设计成跨天存活，而图片上传是立即落桶的）；④ **顺序是硬要求：这个修复必须在 `uploads.ts` 接受 `purpose==='post'` 之前合入**——`gc:images` 是手工脚本，开发期间任何人跑一次就会删 | **T5（必须先于 T7）** |
| P0-4 | **Markdown 站内链接判定被 `/\evil.com` 绕过** —— WHATWG URL 解析器对 special scheme 把 `\` 等同于 `/`，`evil.com` 被当成 host。CommonMark 里 `\e` 不是可转义序列，`hast-util-sanitize` 看不到冒号判为相对路径放行。产物是一个**看起来像站内链接的钓鱼链接**，不触发任何浏览器警告；中键 / Ctrl+点击 / 右键复制 / 爬虫读 SSR HTML 全部拿到 `https://evil.com`，带 Referer、没有 `noopener`、没有 `nofollow ugc`。第二个变体：`/<TAB>/evil.com` | 两道都要：先剥控制字符与 TAB/LF/CR，再 `/^\/[^/\\]/` 挡形状，最后用 `new URL()` 复核 origin（解析器永远比正则更懂它自己）。判为 external 一律 `rel="nofollow ugc noreferrer noopener" target="_blank"`。同一条 `classify()` 复用到 `safeNext()`（`login.tsx` 的 `?next=` 今天不支持，M4 要加，加的时候就带上校验） | T7 |
| P0-5 | **可见性闸门实际有三处而不是两处** —— `publishedTopic()` 把关的是 resource，它调用的 `topicForResource()` 把关的是**什么都没有**。今天一个被软删的资源主题，GET 仍完整列出全部楼层，POST 才 404。M3 侥幸的真实原因是 M3 没有任何路径会软删 topic；M4 第一次给出这个能力 | `loadVisibleTopic()` **取代**而非并列 `topicForResource()`；`content/post.ts` 全部函数改成接收 `TopicView`，让「没过闸就拿不到参数」成为编译期事实 | T3 |
| P0-6 | **`content/post.ts` 被两份设计以不兼容方式改写** | 计划必须指定唯一目标签名 `createPost(tx, topic, input)`，通知挂点的行号描述作废、改成结构描述。**「复用 M3 的 service」要改成「重写 service，两个视图共用重写后的版本」**，工作量估算随之变化——五个导出函数没有一个能原样复用 | T3 |
| P0-7 | **举报队列处理不了帖子举报** —— 队列显示裸 uuid 且没有任何处置动作。「举报-处理-申诉闭环」在帖子上上线当天就是断的 | 投影补跳转零件 + `total` + 排序进 `orderBy` + 第三个按钮「删除该楼层」。**JOIN 必须写 `post.id::text = report.target_id`**，反向 cast 会在出现非 uuid targetId 时让整个队列 500 | T4 / T8 |
| P0-8 | **迁移会在 dev 库上失败**（X8） | 三条回填 SQL 按序执行，见 §4.3。**在写任何新功能之前，先让迁移在 dev 库上跑通且 `bun test` 全绿** | T2 |
| P0-9 | **六篇引导帖 + 一篇站规不在任何任务里** —— `topic.pinnedAt` 这一列的唯一理由是它，而「写那六篇帖」只作为一列的论据出现，从未作为一件要做的事出现。一个有完整通知系统、完整 Markdown 渲染、完整举报闭环但六个版块全空的论坛，读到的是「这地方是死的」。站规同时是举报与处置的依据——没有它，站长第一次删帖就没有可以引用的东西 | **做成 T9 的硬交付物，且是 T0 的硬前置**：写不出「弹幕研究所该发什么」往往意味着这个版块不该存在，那时该推迟的是开工日期不是这七篇 | T0 / T9 |
| P0-10 | **`sessionMiddleware` 的 `onConflictDoNothing()` 加 handle 之后会静默失效**（X3） | 显式 target + 冲突后重查 + handle 唯一违例单独 catch。这是全站每个请求都走的路径，故障形态是「上线后所有新用户都没有 profile 而且没人会立刻发现」 | T6 |
| P0-11 | **`purge` 通知会在同一事务里被自己级联删掉** | `resource_deleted` 绝不带 `resourceId` 外键，只存 `payload.title` 快照。**症状是「什么都没发生」，唯一能发现它的方式是 e2e**：站长 purge 一个资源 → 作者收到通知 **且该通知在 purge 之后仍然存在** | T6 / T9 |

### 4.3 迁移回填 SQL（写进计划，不要留给实施时现想）

```sql
-- ① lastPostAt 回填（必须在 SET NOT NULL 之前）—— 611 行
UPDATE topic SET last_post_at = created_at WHERE last_post_at IS NULL;

-- ② 资源主题的 title 清空（必须在 topic_kind_shape CHECK 之前）—— 657 行
UPDATE topic SET title = NULL WHERE kind = 'resource';

-- ③ 测试留下的孤儿 board 主题（board_slug='shrine' 不在六个正式 slug 里，
--    会让 topic_board_slug CHECK 失败）—— 10 行，全是 title='x' 的残留
DELETE FROM topic WHERE kind = 'board' AND board_slug NOT IN
  ('tea-house','danmaku','workshop','music-hall','kappa','meta');

-- ④ user_profile.handle 回填（NOT NULL UNIQUE 之前）—— 603 行
--    用与运行时相同的派生逻辑：'u' + 小写 id 前 8 位过滤成 [a-z0-9]，冲突延长
```

---

## 五、需要站长拍板的问题

技术上有明确最优解的我已经在 §2 定了。以下 6 条是真正需要人做决定的。

**1. 六个版块的 slug 定值。（不可逆）**
它进 `/shrine/b/:board`，发出去就是一批死链。
**推荐：`tea-house` / `danmaku` / `workshop` / `music-hall` / `kappa` / `meta`。**
判据：URL 段越短越经得起口头传播与 IM 粘贴；`kappa` 比 `kappa-heavy` 好，`danmaku` 比 `danmaku-lab` 好（后者更通用，但通用意味着以后想开「弹幕游戏创作」板时撞名）；`tea-house` 比 `tea-party` 更像地点，与「幻想乡茶话会」的场所感一致。

**2. handle 字符集：`^[a-z0-9][a-z0-9_]{1,19}$`（纯 ASCII、无连字符、首字符必须字母数字）。（不可逆）**
它同时进 `/u/:handle` 和所有已发布帖子的正文，改动等于重写历史正文 + 死链。
**推荐：确认这一套。** 需要你明确接受的一点是**日本社团用户只能用 ASCII handle**——我的判断是可以：显示名（`user.name`）完全自由，handle 只是稳定标识，与 X / GitHub 的做法一致；假名会让 `/u/` 路径进入 percent-encoding，且 @ 的终止边界判定复杂化。

**3. 主题 URL 用 uuid 还是全局序号。（不可逆）**
**推荐：uuid。** 序号能口头传播（「你看 1234 帖」是真实的论坛用法），但它把主题总数公开了——上线第二周 `/shrine/t/7` 会告诉每个访客这里只有 7 个主题，正中冷启动失败模式 A。序号是纯 additive 升级（加一列 `seq`，旧 uuid 链 301 过去），等主题数上三位数再做。

**4. 六篇引导帖 + 一篇站规写不写得出来。（决定 M4 的开工日期）**
这不是技术问题，是 M4 最高杠杆的一件事，而且它不是代码。
**推荐：把它设为 T0 的硬前置。** 如果这七篇文字写不出来（写不出「弹幕研究所该发什么」，往往意味着这个版块不该存在），**M4 该推迟的是开工日期，不是这七篇**。顺带，这七篇会立刻告诉你版块划分对不对——比任何 schema 讨论都准。ja 版有战略意义（产品文档说 ja 是社团认领通道真正可用的前提），en 可后补。

**5. 点赞要不要保留。**
**我判为删**（理由见 §2.2 D4），这是全部裁决里唯一一条可能因偏好而翻转的。
如果你要保留，**保留的理由应该是「我想要」而不是「冷启动需要」**——并且要一起接受：`post_like` 表 + `post.likeCount` 冗余计数（有与 `rating.ratingSum` 同形的删号漂移）+ `recount.ts` + 最热读路径上多一个 `likedByViewer` join + `sonner` + 2 条路由 + 1 个通知 kind + **点赞轰炸这条骚扰链路**（无限「取消赞→再赞」可把受害者收件箱顶部顶满，而私信/拉黑明确不做，他没有任何屏蔽手段）。若保留，`PUT /like` 必须先过 `loadVisibleTopic()` 且计入 `assertRate`。

**6. `/status` 绕开 `/review` 要不要顺手收口。（M3 遗留）**
现状：staff 可以走 `POST /resources/:id/status` 把 pending 直接改 published，完全绕开 `/review`，于是不递增 `approvedResourceCount`、审计写成 `status_change` 而非 `review`。同一个业务动作（通过审核）有两条路径，只有一条推进信任梯度。
**推荐：收口**（把 `pending -> published` 从 `/status` 的允许集合里去掉）。收口之后 `/status` 的通知分支能少一个。
**风险要说清楚**：`moderation.ts:84-93` 的 `canTransition` 调用走的正是这条边，改错了**审核通过会 409**。所以它必须与 `content.test.ts` / `e2e.ts` 的审核用例同一个 PR。

---

## 六、Task 拆分建议

**分两阶段发布。** 阶段 A（T1–T3 + T7 的最小子集）单独可上线且可回滚——它是整个 M4 里唯一一件不做就真的转不起来的事，也是风险最高的那个重构。阶段 B 是其余部分。

| # | Task | 交付物 | 依赖 |
|---|---|---|---|
| **T0** | **裁决与内容前置**（不写代码） | §2 的裁决抄进计划书 Global Constraints + CLAUDE.md 的 M4 约定小节；§5 的 6 个问题拍板；**六篇引导帖 + 一篇站规的真实文字定稿**（zh 必须有，ja 优先） | — |
| **T1** | `@gensokyo/shared` 神社契约 | `src/ids.ts`（三种 id 上提 + `handleSchema`）；`src/shrine/{enums,schemas,mention,types}.ts`（`BOARD_SLUGS` / `NOTIFICATION_KIND` / `RESERVED_HANDLES` / 页大小常量 / `extractMentions()` + 测试 / `PostView` 响应契约）；`LOCALES` 上提；`REPORT_REASON` +2；`REPORT_TARGET_KIND` | T0 |
| **T2** | db schema + 迁移 | 1 表 + 4 列 + 改名 + 收窄 + 5 条 CHECK + 索引增删；**§4.3 的四条回填**；6 个 seed 脚本抽成 `_shared/createResourceTopic.ts`；`kourindou.test.ts` 修 + 清理。**验收：迁移在 dev 库跑通且 `bun test` 全绿，再写任何新功能** | T1 |
| **T3** | 闸门收口 + service 重写 + **URL 合并** | `modules/content/visibility.ts`（表达式 + 函数）；`content/post.ts` 重写（`(tx, TopicView, input)` / `floorSeq` / 楼层区间 / `toPostView()` / `catch` 收窄 / 删 `topicForResource`）；删 `content/index.ts`；`GET /resources/:slug` 加 `topicId`；`content.test.ts` 重写。**这个 Task 只重构不加功能，单独跑 e2e、单独发布** | T2 |
| **T4** | shrine 读写路由 + 治理接线 | 7 条新路由 + `DELETE /posts/:id` 搬入（补事务 + 审计 + `strikeCount`）；`assertRate()` + `canPostLinks()`；`isSelf()` + 「moderator 编辑他人楼层 → 403」测试；举报端点搬到 `/api/reports` + post 分支过闸门 + `report_open_uq`；`GET /moderation/reports` 投影 + `total` + `orderBy` | T3 |
| **T5** | **`gc-images` 修复 + 上传接入** | `referencedUrls()` 加两个来源 + 正则锚死 + 交集自检 + 分前缀宽限期；`purpose='post'`；上传限流。**必须先于 T7** | T2 |
| **T6** | 通知 + handle | `notify.ts`（唯一写入口，SAVEPOINT，RANKED 去重）+ 2 条路由 + 7 个挂点 + `/api/me` 未读数；`user_profile.handle` 派生与认领 + `PUT /me/handle` + `session.ts` 两个坑 | T2 · T4 |
| **T7** | web 基础 | `discussion/` 五件套 + Markdown 管线（`classify()` / 净化 schema / 图片策略）；`/shrine` `/shrine/b/:board` `/shrine/t/:id` `/shrine/new` 四页 + 版块导航组件；`detail.tsx` 改造（换端点 + `<Discussion>` + 三态 + 分页 + 举报按钮 + 回神社链接）；`login.tsx` 的 `?next=` + `safeNext()`；`register.tsx` 的 handle 字段 | T4 · T5 |
| **T8** | web 治理与身份 | `/notifications` + `/u/:handle`；`site-header` 铃铛 + `/shrine` 真入口；`dash/reports.tsx` 新投影 + 删楼按钮 + i18n；`dash/layout.tsx` 待办计数 + 「今天的新主题/新楼层」；`errorLabel()` 收口 | T6 · T7 |
| **T9** | 内容与验收 | 六篇引导帖 + 站规入库并置顶（seed 脚本）；六个版块名与说明 3 语；≈75 条新 message key × 3 语审计（`check-messages.ts` 通过）；e2e 扩充 | T8 |

**e2e 必须覆盖的（`designs-notification` 只写了「加 4 项」，不够）：**

1. 发主题 → 回帖 → 楼层号连续；并发发帖不撞楼层号（既有用例，必须在新 URL 下重跑）
2. 资源评论与论坛帖走同一段 service（同一条 post 从两个视图读到相同投影）
3. **版主软删一个 `kind='resource'` 的主题 → 资源详情页的评论区不再列出楼层**（P0-5 的回归测试）
4. **资源下架后，参与者的 `/u/:handle` 不再列出那些楼层**（P0-1 的回归测试）
5. **站长 purge 一个资源 → 作者收到 `resource_deleted` 通知，且该通知在 purge 之后仍然存在**（P0-11 的回归测试，这是唯一能发现它的方式）
6. @ 提及产生通知；提及超过 10 人被拒
7. 限流触发（冷却窗 + 小时配额 + 新账号外链）
8. **一条 `targetKind='post'` 的举报，从提交到审核员在 `/dash/reports` 里看到标题+楼层、点进去、删楼、结案——全程不复制 uuid**（P0-7 的闭环验收）
9. `moderator` 编辑他人楼层 → 403

---

## 七、如果只能记住三件事

**一、先裁决，再写代码。** §2 那 30 多条不裁完，计划书写不了——按任意一份设计实施都会与另外三份冲突。其中版块 slug 与 handle 字符集发出去就锁死，其余只是返工。

**二、七篇文字比任何一张表都重要。** 论坛冷启动缺的从来不是功能，是内容。一个功能齐备但六个版块全空的论坛，读到的是「这地方是死的」；一个只有主题、楼层和回复通知，但每个版块有一篇像样开场帖的论坛，读到的是「这里有人」。

**三、先把「资源讨论进最新流」单独做完并上线（T1–T3 + 最小前端），再做其余的 M4。** 它的全部内容是：`lastPostAt` 改 NOT NULL、资源主题不再快照标题、闸门收口、URL 合并、一个混排的最新流页面、资源页与 `/shrine` 之间的双向链接。**没有通知、没有 @、没有 Markdown 渲染器，也能上线。** 这么做把风险最高的那个重构单独放进一次可回滚的发布，而不是和通知、handle、Markdown 混在一个大 commit 里——M3 有过未评审的 schema 草稿混进大 commit、最后整个被撤回的先例。做完之后，点赞、订阅、折叠该不该做，就有数据可以回答了。
