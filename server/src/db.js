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

// Bancos criados antes do campo de valor ganham a coluna automaticamente.
if (!db.prepare('PRAGMA table_info(contacts)').all().some((c) => c.name === 'value_cents')) {
  db.exec('ALTER TABLE contacts ADD COLUMN value_cents INTEGER NOT NULL DEFAULT 0');
}

// Etapas do funil ficam no banco para poderem ser editadas pela tela.
db.exec(`CREATE TABLE IF NOT EXISTS stages (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM stages').get().n === 0) {
  const seed = db.prepare('INSERT INTO stages (key, name, position) VALUES (?,?,?)');
  [
    ['novo', 'Novo'],
    ['em_conversa', 'Em conversa'],
    ['proposta', 'Proposta enviada'],
    ['aguardando_pagamento', 'Aguardando pagamento'],
    ['fechado', 'Fechado'],
    ['perdido', 'Perdido'],
  ].forEach(([key, name], i) => seed.run(key, name, i));
}

export const listStages = () => db.prepare('SELECT key, name FROM stages ORDER BY position').all();
export const stageExists = (key) => !!db.prepare('SELECT 1 FROM stages WHERE key = ?').get(key);
const firstStageKey = () => db.prepare('SELECT key FROM stages ORDER BY position LIMIT 1').get().key;

// Cliente novo entra na etapa informada ou, se não houver, na primeira coluna do funil.
export function upsertContact(phone, name, stage = null, valueCents = 0) {
  db.prepare(
    `INSERT INTO contacts (phone, name, stage, value_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(contacts.name, excluded.name)`
  ).run(phone, name || null, stage || firstStageKey(), valueCents);
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
