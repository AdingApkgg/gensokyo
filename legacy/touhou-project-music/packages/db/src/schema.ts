import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['user', 'contributor', 'admin']);
export const submissionStatus = pgEnum('submission_status', ['pending', 'approved', 'rejected']);
export const audioProvider = pgEnum('audio_provider', [
  'netease',
  'tencent',
  'kugou',
  'bilibili',
  'local',
]);

export const circle = pgTable(
  'circle',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    nameRomaji: text('name_romaji'),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    website: text('website'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('circle_name_uq').on(t.name)],
);

export const album = pgTable(
  'album',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circle.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleRomaji: text('title_romaji'),
    catalogNo: text('catalog_no'),
    releaseEvent: text('release_event'),
    releaseDate: timestamp('release_date', { withTimezone: true }),
    coverUrl: text('cover_url'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('album_circle_idx').on(t.circleId),
    uniqueIndex('album_catalog_uq').on(t.catalogNo),
  ],
);

export const originalSong = pgTable(
  'original_song',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    titleRomaji: text('title_romaji'),
    work: text('work').notNull(),
    workCode: text('work_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('original_work_idx').on(t.work)],
);

export const track = pgTable(
  'track',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    albumId: uuid('album_id')
      .notNull()
      .references(() => album.id, { onDelete: 'cascade' }),
    trackNo: integer('track_no'),
    discNo: integer('disc_no').default(1),
    title: text('title').notNull(),
    titleRomaji: text('title_romaji'),
    durationSec: integer('duration_sec'),
    arrangers: text('arrangers').array(),
    vocalists: text('vocalists').array(),
    lyricists: text('lyricists').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('track_album_idx').on(t.albumId),
    uniqueIndex('track_album_no_uq').on(t.albumId, t.discNo, t.trackNo),
  ],
);

export const arrangement = pgTable(
  'arrangement',
  {
    trackId: uuid('track_id')
      .notNull()
      .references(() => track.id, { onDelete: 'cascade' }),
    originalSongId: uuid('original_song_id')
      .notNull()
      .references(() => originalSong.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.originalSongId] })],
);

export const audioSource = pgTable(
  'audio_source',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => track.id, { onDelete: 'cascade' }),
    provider: audioProvider('provider').notNull(),
    externalId: text('external_id'),
    url: text('url'),
    localPath: text('local_path'),
    quality: text('quality'),
    bitrate: integer('bitrate'),
    format: text('format'),
    sizeBytes: integer('size_bytes'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('audio_track_idx').on(t.trackId),
    uniqueIndex('audio_provider_ext_uq').on(t.provider, t.externalId),
  ],
);

export const tag = pgTable('tag', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').notNull(),
});

export const trackTag = pgTable(
  'track_tag',
  {
    trackId: uuid('track_id')
      .notNull()
      .references(() => track.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.tagId] })],
);

export const user = pgTable(
  'user',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    role: userRole('role').default('user').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const submission = pgTable(
  'submission',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submitterId: uuid('submitter_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status: submissionStatus('status').default('pending').notNull(),
    reviewerId: uuid('reviewer_id').references(() => user.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [index('submission_status_idx').on(t.status)],
);

export const downloadLog = pgTable(
  'download_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => track.id, { onDelete: 'cascade' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('dl_user_idx').on(t.userId),
    index('dl_track_idx').on(t.trackId),
    index('dl_time_idx').on(sql`${t.createdAt} DESC`),
  ],
);

// --- Relations ---

export const circleRelations = relations(circle, ({ many }) => ({
  albums: many(album),
}));

export const albumRelations = relations(album, ({ one, many }) => ({
  circle: one(circle, { fields: [album.circleId], references: [circle.id] }),
  tracks: many(track),
}));

export const trackRelations = relations(track, ({ one, many }) => ({
  album: one(album, { fields: [track.albumId], references: [album.id] }),
  arrangements: many(arrangement),
  sources: many(audioSource),
  tags: many(trackTag),
}));

export const arrangementRelations = relations(arrangement, ({ one }) => ({
  track: one(track, { fields: [arrangement.trackId], references: [track.id] }),
  original: one(originalSong, {
    fields: [arrangement.originalSongId],
    references: [originalSong.id],
  }),
}));

export const audioSourceRelations = relations(audioSource, ({ one }) => ({
  track: one(track, { fields: [audioSource.trackId], references: [track.id] }),
}));

export const trackTagRelations = relations(trackTag, ({ one }) => ({
  track: one(track, { fields: [trackTag.trackId], references: [track.id] }),
  tag: one(tag, { fields: [trackTag.tagId], references: [tag.id] }),
}));

export const userRelations = relations(user, ({ many }) => ({
  submissions: many(submission, { relationName: 'submitter' }),
  downloads: many(downloadLog),
}));

export const submissionRelations = relations(submission, ({ one }) => ({
  submitter: one(user, {
    fields: [submission.submitterId],
    references: [user.id],
    relationName: 'submitter',
  }),
  reviewer: one(user, { fields: [submission.reviewerId], references: [user.id] }),
}));
