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

// Atendentes: cada pessoa tem login próprio e o nome aparece nas mensagens que enviar.
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'atendente' CHECK (role IN ('admin','atendente')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
for (const col of ['author_user_id INTEGER', 'author_name TEXT']) {
  if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === col.split(' ')[0])) {
    db.exec(`ALTER TABLE messages ADD COLUMN ${col}`);
  }
}

// Data combinada para voltar a falar com o cliente (AAAA-MM-DD, vazio = sem follow-up).
if (!db.prepare('PRAGMA table_info(contacts)').all().some((c) => c.name === 'followup_at')) {
  db.exec('ALTER TABLE contacts ADD COLUMN followup_at TEXT');
}

// Textos que a equipe usa sempre. {nome} e {atendente} são trocados na hora de usar.
db.exec(`CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM quick_replies').get().n === 0) {
  const add = db.prepare('INSERT INTO quick_replies (title, body) VALUES (?, ?)');
  add.run('Boas-vindas', 'Olá, {nome}! Aqui é {atendente}. Como posso ajudar?');
  add.run('Follow-up da proposta', 'Olá, {nome}! Passando para saber se você conseguiu ver o orçamento que enviei. Posso tirar alguma dúvida ou já reservar para você?');
  add.run('Lembrar do sinal', 'Olá, {nome}! Tudo bem? Passando para lembrar do sinal da reserva. Assim que o pagamento cair, eu confirmo tudo por aqui.');
  add.run('Reserva confirmada', 'Reserva confirmada, {nome}! Se tiver qualquer dúvida antes da chegada, é só chamar. Aguardamos você!');
}

// Desde quando o cliente está na etapa atual (base do aviso de cliente parado).
if (!db.prepare('PRAGMA table_info(contacts)').all().some((c) => c.name === 'stage_changed_at')) {
  db.exec('ALTER TABLE contacts ADD COLUMN stage_changed_at TEXT');
  db.exec('UPDATE contacts SET stage_changed_at = COALESCE(last_message_at, created_at)');
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

// Aviso: depois de quantos dias parado o cliente aparece como "precisa de atenção" (vazio = sem aviso).
if (!db.prepare('PRAGMA table_info(stages)').all().some((c) => c.name === 'alert_days')) {
  db.exec('ALTER TABLE stages ADD COLUMN alert_days INTEGER');
  db.exec(`UPDATE stages SET alert_days = 2 WHERE key = 'proposta'`);
  db.exec(`UPDATE stages SET alert_days = 1 WHERE key = 'aguardando_pagamento'`);
}

// Etapa final (ex.: Fechado, Perdido): sem follow-up nem aviso de parado.
// Se o cliente voltar a escrever, ele reaparece na primeira etapa como uma nova consulta.
if (!db.prepare('PRAGMA table_info(stages)').all().some((c) => c.name === 'is_final')) {
  db.exec('ALTER TABLE stages ADD COLUMN is_final INTEGER NOT NULL DEFAULT 0');
  db.exec(`UPDATE stages SET is_final = 1 WHERE key IN ('fechado', 'perdido')`);
}

export const listStages = () =>
  db
    .prepare('SELECT key, name, alert_days, is_final FROM stages ORDER BY position')
    .all()
    .map((s) => ({ ...s, is_final: !!s.is_final }));
export const isFinalStage = (key) => !!db.prepare('SELECT is_final FROM stages WHERE key = ?').get(key)?.is_final;
export const stageExists = (key) => !!db.prepare('SELECT 1 FROM stages WHERE key = ?').get(key);
const firstStageKey = () => db.prepare('SELECT key FROM stages ORDER BY position LIMIT 1').get().key;

// Cliente novo entra na etapa informada ou, se não houver, na primeira coluna do funil.
export function upsertContact(phone, name, stage = null, valueCents = 0) {
  db.prepare(
    `INSERT INTO contacts (phone, name, stage, value_cents, stage_changed_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(contacts.name, excluded.name)`
  ).run(phone, name || null, stage || firstStageKey(), valueCents);
  return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
}

export function setStage(contactId, stage) {
  db.prepare(
    `UPDATE contacts SET stage = ?, stage_changed_at = datetime('now'),
       followup_at = CASE WHEN (SELECT is_final FROM stages WHERE key = ?) THEN NULL ELSE followup_at END
     WHERE id = ? AND stage != ?`
  ).run(stage, stage, contactId, stage);
}

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Cliente de etapa final que volta a escrever começa uma nova negociação na primeira etapa.
// O valor antigo sai do cartão (para não contar de novo) e fica registrado nas anotações.
export function reopenIfFinal(contactId) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  const first = firstStageKey();
  if (!c || c.stage === first || !isFinalStage(c.stage)) return false;
  const old = db.prepare('SELECT name FROM stages WHERE key = ?').get(c.stage)?.name ?? c.stage;
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const note =
    `[${today}] Cliente voltou a escrever. Negociação anterior: etapa "${old}"` +
    (c.value_cents > 0 ? `, ${brl(c.value_cents)}` : '') + '.';
  db.prepare(`UPDATE contacts SET notes = ?, value_cents = 0, followup_at = NULL WHERE id = ?`).run(
    c.notes ? `${c.notes}\n${note}` : note,
    c.id
  );
  setStage(c.id, first);
  return true;
}

// `author` é quem enviou (atendente); mensagens recebidas do cliente não têm autor.
export function addMessage(contactId, direction, body, externalId = null, author = null) {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO messages (contact_id, direction, body, external_id, author_user_id, author_name)
       VALUES (?,?,?,?,?,?)`
    )
    .run(contactId, direction, body, externalId, author?.id || null, author?.name || null);
  if (r.changes) {
    db.prepare(`UPDATE contacts SET last_message_at = datetime('now') WHERE id = ?`).run(contactId);
  }
  return r.changes > 0;
}
