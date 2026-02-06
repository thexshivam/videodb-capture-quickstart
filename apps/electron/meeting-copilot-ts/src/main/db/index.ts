import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as schema from './schema';
import { logger } from '../lib/logger';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlite: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return path.join(dbDir, 'meeting-copilot.db');
}

export function initDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db;

  const dbPath = getDbPath();
  logger.info({ dbPath }, 'Initializing database');

  sqlite = new Database(dbPath);
  db = drizzle(sqlite, { schema });

  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      access_token TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      stream_url TEXT,
      player_url TEXT,
      session_id TEXT NOT NULL,
      duration INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'processing', 'available', 'failed')),
      insights TEXT,
      insights_status TEXT NOT NULL DEFAULT 'pending' CHECK(insights_status IN ('pending', 'processing', 'ready', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_access_token ON users(access_token);
    CREATE INDEX IF NOT EXISTS idx_recordings_session_id ON recordings(session_id);
  `);

  logger.info('Database initialized successfully');
  return db;
}

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
    logger.info('Database connection closed');
  }
}

// User queries
export function getUserByAccessToken(accessToken: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.users)
    .where(eq(schema.users.accessToken, accessToken))
    .get();
}

export function createUser(data: schema.NewUser) {
  const database = getDatabase();
  return database.insert(schema.users).values(data).returning().get();
}

// Recording queries
export function getRecordingById(id: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .get();
}

export function getRecordingBySessionId(sessionId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.sessionId, sessionId))
    .get();
}

export function getAllRecordings() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .orderBy(schema.recordings.createdAt)
    .all();
}

export function createRecording(data: schema.NewRecording) {
  const database = getDatabase();
  return database.insert(schema.recordings).values(data).returning().get();
}

export function updateRecording(id: number, data: Partial<schema.Recording>) {
  const database = getDatabase();
  return database
    .update(schema.recordings)
    .set(data)
    .where(eq(schema.recordings.id, id))
    .returning()
    .get();
}

export function updateRecordingBySessionId(
  sessionId: string,
  data: Partial<schema.Recording>
) {
  const database = getDatabase();
  return database
    .update(schema.recordings)
    .set(data)
    .where(eq(schema.recordings.sessionId, sessionId))
    .returning()
    .get();
}

export { schema };
