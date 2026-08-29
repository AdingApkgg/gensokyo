import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  bigint,
  boolean,
  primaryKey,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
  serial,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["user", "uploader", "moderator", "admin"]);
export const resourceStatusEnum = pgEnum("resource_status", [
  "public",
  "pending",
  "hidden",
  "takedown",
]);
export const categoryEnum = pgEnum("category", [
  "game",
  "music",
  "doujinshi",
  "cg",
  "mmd",
  "video",
  "wallpaper",
  "tool",
  "other",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: roleEnum("role").notNull().default("user"),
  bio: text("bio"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const resources = pgTable(
  "resources",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 128 }).notNull().unique(),
    title: varchar("title", { length: 200 }).notNull(),
    category: categoryEnum("category").notNull().default("other"),
    descriptionMd: text("description_md").notNull().default(""),
    coverKey: text("cover_key"),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: resourceStatusEnum("status").notNull().default("public"),
    circle: varchar("circle", { length: 120 }),
    author: varchar("author", { length: 120 }),
    eventName: varchar("event_name", { length: 80 }),
    language: varchar("language", { length: 16 }),
    externalLinks: jsonb("external_links").$type<{ label: string; url: string }[]>().default([]),
    downloads: integer("downloads").notNull().default(0),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("resources_status_created_idx").on(t.status, t.createdAt),
    index("resources_category_idx").on(t.category),
  ]
);

export const resourceFiles = pgTable("resource_files", {
  id: serial("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resources.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  s3Key: text("s3_key").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  checksum: text("checksum"),
  contentType: varchar("content_type", { length: 100 }),
  version: varchar("version", { length: 32 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
});

export const resourceTags = pgTable(
  "resource_tags",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.tagId] })]
);

export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: integer("parent_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("comments_resource_idx").on(t.resourceId)]
);

export const ratings = pgTable(
  "ratings",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.userId] })]
);

export const favorites = pgTable(
  "favorites",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.userId] })]
);

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resources.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const downloadLogs = pgTable(
  "download_logs",
  {
    id: serial("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("dl_resource_idx").on(t.resourceId)]
);

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  uploader: one(users, { fields: [resources.uploaderId], references: [users.id] }),
  files: many(resourceFiles),
  tags: many(resourceTags),
  comments: many(comments),
  ratings: many(ratings),
}));

export const resourceFilesRelations = relations(resourceFiles, ({ one }) => ({
  resource: one(resources, { fields: [resourceFiles.resourceId], references: [resources.id] }),
}));

export const resourceTagsRelations = relations(resourceTags, ({ one }) => ({
  resource: one(resources, { fields: [resourceTags.resourceId], references: [resources.id] }),
  tag: one(tags, { fields: [resourceTags.tagId], references: [tags.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  resource: one(resources, { fields: [comments.resourceId], references: [resources.id] }),
}));

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type User = typeof users.$inferSelect;
