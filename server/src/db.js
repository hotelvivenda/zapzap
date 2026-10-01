import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });
export const db = new DatabaseSync('data/crm.db');

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  stage TEXT NOT NULL DEFAULT 'novo',
  notes TEXT NOT NULL DEFAULT '',
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL,
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);
`);

export const STAGES = ['novo', 'em_conversa', 'proposta', 'fechado', 'perdido'];

export function upsertContact(phone, name) {
  db.prepare(
    `INSERT INTO contacts (phone, name) VALUES (?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(contacts.name, excluded.name)`
  ).run(phone, name || null);
  return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
}

export function addMessage(contactId, direction, body, externalId = null) {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO messages (contact_id, direction, body, external_id) VALUES (?,?,?,?)`
    )
    .run(contactId, direction, body, externalId);
  if (r.changes) {
    db.prepare(`UPDATE contacts SET last_message_at = datetime('now') WHERE id = ?`).run(contactId);
  }
  return r.changes > 0;
}
