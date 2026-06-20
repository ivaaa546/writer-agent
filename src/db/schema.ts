export const SCHEMA_SQL = /* sql */ `
-- Proyectos
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  path        TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Conversaciones (siempre dentro de un proyecto)
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Mensajes
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  tokens_used     INTEGER DEFAULT 0,
  provider        TEXT,
  model           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Resúmenes automáticos de conversaciones (Context Builder)
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  message_range   TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Documentos
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  path          TEXT NOT NULL,
  hash          TEXT NOT NULL,
  size_bytes    INTEGER,
  format        TEXT,
  summary       TEXT,
  provider_used TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Chunks (fragmentos para contexto eficiente)
CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  token_count  INTEGER,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Búsqueda rápida (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  document_id UNINDEXED
);

-- Memoria del sistema
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK(scope IN ('global','project','session')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Uso de tokens (monitoreo de costos)
CREATE TABLE IF NOT EXISTS token_usage (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Config global (proveedor activo, proyecto activo, etc.)
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`;
