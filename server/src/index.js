import express from 'express';
import { existsSync } from 'node:fs';
import { db, STAGES, upsertContact, addMessage } from './db.js';
import { mock } from './whatsapp/mock.js';
import { cloud, parseWebhook } from './whatsapp/cloud.js';

const provider = process.env.WHATSAPP_PROVIDER === 'cloud' ? cloud : mock;
const app = express();
app.use(express.json());

const normalize = (p) => String(p || '').replace(/\D/g, '');

app.get('/api/config', (_req, res) => res.json({ provider: provider.name, stages: STAGES }));

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
  res.status(201).json(upsertContact(phone, req.body.name));
});

app.patch('/api/contacts/:id', (req, res) => {
  const { name, stage, notes, value_cents } = req.body;
  if (stage !== undefined && !STAGES.includes(stage)) return res.status(400).json({ error: 'Etapa inválida' });
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
