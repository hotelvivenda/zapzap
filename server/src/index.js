import express from 'express';
import { existsSync } from 'node:fs';
import { db, listStages, stageExists, upsertContact, addMessage } from './db.js';
import { mock } from './whatsapp/mock.js';
import { cloud, parseWebhook } from './whatsapp/cloud.js';

const provider = process.env.WHATSAPP_PROVIDER === 'cloud' ? cloud : mock;
const app = express();
app.use(express.json());

const normalize = (p) => String(p || '').replace(/\D/g, '');

app.get('/api/config', (_req, res) => res.json({ provider: provider.name, stages: listStages() }));

// ---- Etapas do funil ----
const cleanName = (n) => String(n || '').trim().slice(0, 40);

app.post('/api/stages', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Dê um nome para a etapa' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM stages').get().p;
  db.prepare('INSERT INTO stages (key, name, position) VALUES (?,?,?)').run('e' + Date.now().toString(36), name, pos);
  res.status(201).json(listStages());
});

app.put('/api/stages/order', (req, res) => {
  const keys = req.body.keys;
  const current = listStages().map((s) => s.key);
  if (!Array.isArray(keys) || keys.length !== current.length || !current.every((k) => keys.includes(k)))
    return res.status(400).json({ error: 'Ordem inválida' });
  const up = db.prepare('UPDATE stages SET position = ? WHERE key = ?');
  keys.forEach((k, idx) => up.run(idx, k));
  res.json(listStages());
});

app.patch('/api/stages/:key', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Dê um nome para a etapa' });
  const r = db.prepare('UPDATE stages SET name = ? WHERE key = ?').run(name, req.params.key);
  r.changes ? res.json(listStages()) : res.status(404).json({ error: 'Etapa não encontrada' });
});

app.delete('/api/stages/:key', (req, res) => {
  if (!stageExists(req.params.key)) return res.status(404).json({ error: 'Etapa não encontrada' });
  if (listStages().length <= 1) return res.status(400).json({ error: 'O funil precisa ter pelo menos uma etapa' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE stage = ?').get(req.params.key).n;
  if (n > 0) return res.status(409).json({ error: `Há ${n} cliente(s) nesta etapa. Mova-os para outra etapa antes de excluir.` });
  db.prepare('DELETE FROM stages WHERE key = ?').run(req.params.key);
  res.json(listStages());
});

app.get('/api/contacts', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(
    db
      .prepare(
        `SELECT c.*, (SELECT body FROM messages WHERE contact_id = c.id ORDER BY id DESC LIMIT 1) AS last_body
         FROM contacts c WHERE c.name LIKE ? OR c.phone LIKE ?
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
      )
      .all(q, q)
  );
});

app.post('/api/contacts', (req, res) => {
  const phone = normalize(req.body.phone);
  if (phone.length < 10) return res.status(400).json({ error: 'Telefone inválido (use DDI+DDD+número)' });
  const { stage, value_cents: value = 0 } = req.body;
  if (stage && !stageExists(stage)) return res.status(400).json({ error: 'Etapa inválida' });
  if (!(Number.isInteger(value) && value >= 0)) return res.status(400).json({ error: 'Valor inválido' });
  res.status(201).json(upsertContact(phone, req.body.name, stage, value));
});

app.patch('/api/contacts/:id', (req, res) => {
  const { name, stage, notes, value_cents } = req.body;
  if (stage !== undefined && !stageExists(stage)) return res.status(400).json({ error: 'Etapa inválida' });
  if (value_cents !== undefined && !(Number.isInteger(value_cents) && value_cents >= 0))
    return res.status(400).json({ error: 'Valor inválido' });
  db.prepare(
    `UPDATE contacts SET name = COALESCE(?, name), stage = COALESCE(?, stage), notes = COALESCE(?, notes),
       value_cents = COALESCE(?, value_cents) WHERE id = ?`
  ).run(name ?? null, stage ?? null, notes ?? null, value_cents ?? null, req.params.id);
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Contato não encontrado' });
});

app.get('/api/contacts/:id/messages', (req, res) => {
  res.json(db.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY id').all(req.params.id));
});

app.post('/api/contacts/:id/messages', async (req, res) => {
  const text = String(req.body.text || '').trim();
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contato não encontrado' });
  if (!text) return res.status(400).json({ error: 'Mensagem vazia' });
  try {
    const { id } = await provider.send(c.phone, text);
    addMessage(c.id, 'out', text, id);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Simula uma mensagem recebida (só no modo de teste).
app.post('/api/dev/incoming', (req, res) => {
  if (provider.name !== 'mock') return res.status(404).end();
  const phone = normalize(req.body.phone);
  const c = upsertContact(phone, req.body.name);
  addMessage(c.id, 'in', String(req.body.text || ''));
  res.status(201).json({ ok: true });
});

// Webhook da Meta: verificação e recebimento.
app.get('/webhook', (req, res) => {
  const ok =
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;
  ok ? res.send(req.query['hub.challenge']) : res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  for (const m of parseWebhook(req.body)) {
    const c = upsertContact(m.phone, m.name);
    addMessage(c.id, 'in', m.text, m.id);
  }
  res.sendStatus(200);
});

if (existsSync('web/dist')) {
  app.use(express.static('web/dist'));
  app.get('*', (_req, res) => res.sendFile('index.html', { root: 'web/dist' }));
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CRM em http://localhost:${port} (WhatsApp: ${provider.name})`));
