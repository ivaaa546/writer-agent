import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SCHEMA_SQL } from "./schema.js";

const WRITER_DIR = join(homedir(), ".writer-agent");
const DB_PATH = join(WRITER_DIR, "writer.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure ~/.writer-agent/ exists
  if (!existsSync(WRITER_DIR)) {
    mkdirSync(WRITER_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // Enable WAL mode for concurrent writes
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Initialize schema on first run
  _db.exec(SCHEMA_SQL);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export { DB_PATH, WRITER_DIR };
