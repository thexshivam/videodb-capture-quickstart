import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull(),
  accessToken: text('access_token').notNull().unique(),
});

export const recordings = sqliteTable('recordings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id'),
  streamUrl: text('stream_url'),
  playerUrl: text('player_url'),
  sessionId: text('session_id').notNull(),
  duration: integer('duration'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  status: text('status', { enum: ['recording', 'processing', 'available', 'failed'] })
    .notNull()
    .default('recording'),
  insights: text('insights'),
  insightsStatus: text('insights_status', { enum: ['pending', 'processing', 'ready', 'failed'] })
    .notNull()
    .default('pending'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
