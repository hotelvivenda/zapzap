import express from 'express';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { db, getSettings, saveSetting, signatureFor, listStages, stageExists, isFinalStage, upsertContact, addMessage, setStage, reopenIfFinal } from './db.js';
import { mock } from './whatsapp/mock.js';
import { cloud, parseWebhook, downloadMedia } from './whatsapp/cloud.js';
import { MEDIA_DIR, MAX_BYTES, MEDIA_TYPES, TYPE_LABEL, TYPE_RECEIVED, canInline, saveMedia, safeName, discardMedia } from './media.js';
import { join, basename } from 'node:path';
import { setupAuth } from './auth.js';

const provider = process.env.WHATSAPP_PROVIDER === 'cloud' ? cloud : mock;
const app = express();
app.set('trust proxy', 1);
// Guarda o corpo original: a Meta assina o webhook e a assinatura é conferida sobre ele.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const auth = setupAuth({
  passwordHash: process.env.CRM_PASSWORD_HASH,
  passwordPlain: process.env.CRM_PASSWORD,
  adminName: process.env.CRM_ADMIN_NAME,
});
auth.mount(app);
app.use('/api', auth.require);
auth.mountUsers(app);

const normalize = (p) => String(p || '').replace(/\D/g, '');

app.get('/api/config', (req, res) =>
  res.json({
    provider: provider.name,
    stages: listStages(),
    settings: getSettings(),
    signature: signatureFor(req.user), // como o nome de quem está logado aparece para o hóspede
  })
);

app.patch('/api/settings', auth.requireAdmin, (req, res) => {
  const { sign_messages, hotel_name } = req.body;
  if (sign_messages !== undefined) {
    if (typeof sign_messages !== 'boolean') return res.status(400).json({ error: 'Valor inválido' });
    saveSetting('sign_messages', sign_messages ? '1' : '0');
  }
  if (hotel_name !== undefined) saveSetting('hotel_name', String(hotel_name).trim().slice(0, 60));
  res.json(getSettings());
});

// ---- Respostas prontas ----
const cleanReply = (b) => ({
  title: String(b.title ?? '').trim().slice(0, 60),
  body: String(b.body ?? '').trim().slice(0, 1000),
});

app.get('/api/replies', (_req, res) => {
  res.json(db.prepare('SELECT id, title, body FROM quick_replies ORDER BY id').all());
});

app.post('/api/replies', auth.requireAdmin, (req, res) => {
  const { title, body } = cleanReply(req.body);
  if (!title || !body) return res.status(400).json({ error: 'Preencha o título e o texto da resposta' });
  const r = db.prepare('INSERT INTO quick_replies (title, body) VALUES (?, ?)').run(title, body);
  res.status(201).json(db.prepare('SELECT id, title, body FROM quick_replies WHERE id = ?').get(r.lastInsertRowid));
});

app.patch('/api/replies/:id', auth.requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Resposta não encontrada' });
  const c = cleanReply({ title: req.body.title ?? cur.title, body: req.body.body ?? cur.body });
  if (!c.title || !c.body) return res.status(400).json({ error: 'Preencha o título e o texto da resposta' });
  db.prepare('UPDATE quick_replies SET title = ?, body = ? WHERE id = ?').run(c.title, c.body, cur.id);
  res.json({ id: cur.id, ...c });
});

app.delete('/api/replies/:id', auth.requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Resposta não encontrada' });
});

// ---- Etapas do funil ----
const cleanName = (n) => String(n || '').trim().slice(0, 40);

app.post('/api/stages', auth.requireAdmin, (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Dê um nome para a etapa' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM stages').get().p;
  db.prepare('INSERT INTO stages (key, name, position) VALUES (?,?,?)').run('e' + Date.now().toString(36), name, pos);
  res.status(201).json(listStages());
});

app.put('/api/stages/order', auth.requireAdmin, (req, res) => {
  const keys = req.body.keys;
  const current = listStages().map((s) => s.key);
  if (!Array.isArray(keys) || keys.length !== current.length || !current.every((k) => keys.includes(k)))
    return res.status(400).json({ error: 'Ordem inválida' });
  const up = db.prepare('UPDATE stages SET position = ? WHERE key = ?');
  keys.forEach((k, idx) => up.run(idx, k));
  res.json(listStages());
});

app.patch('/api/stages/:key', auth.requireAdmin, (req, res) => {
  const { name, alert_days, is_final } = req.body;
  if (!stageExists(req.params.key)) return res.status(404).json({ error: 'Etapa não encontrada' });
  if (name !== undefined) {
    const n = cleanName(name);
    if (!n) return res.status(400).json({ error: 'Dê um nome para a etapa' });
    db.prepare('UPDATE stages SET name = ? WHERE key = ?').run(n, req.params.key);
  }
  if (alert_days !== undefined) {
    const ok = alert_days === null || (Number.isInteger(alert_days) && alert_days >= 1 && alert_days <= 365);
    if (!ok) return res.status(400).json({ error: 'Informe um número de dias entre 1 e 365, ou deixe vazio' });
    db.prepare('UPDATE stages SET alert_days = ? WHERE key = ?').run(alert_days, req.params.key);
  }
  if (is_final !== undefined) {
    if (typeof is_final !== 'boolean') return res.status(400).json({ error: 'Valor inválido' });
    if (is_final && listStages()[0].key === req.params.key)
      return res.status(400).json({ error: 'A primeira etapa recebe os clientes novos e não pode ser final.' });
    db.prepare('UPDATE stages SET is_final = ? WHERE key = ?').run(is_final ? 1 : 0, req.params.key);
    if (is_final) {
      db.prepare('UPDATE stages SET alert_days = NULL WHERE key = ?').run(req.params.key);
      db.prepare('UPDATE contacts SET followup_at = NULL WHERE stage = ?').run(req.params.key);
    }
  }
  res.json(listStages());
});

app.delete('/api/stages/:key', auth.requireAdmin, (req, res) => {
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
        `SELECT c.*, CAST(julianday('now') - julianday(c.stage_changed_at) AS INTEGER) AS days_in_stage,
           (SELECT CASE WHEN body != '' THEN body ELSE CASE media_type
              WHEN 'image' THEN 'Foto' WHEN 'audio' THEN 'Áudio' WHEN 'video' THEN 'Vídeo'
              WHEN 'document' THEN 'Documento' WHEN 'sticker' THEN 'Figurinha' ELSE '' END END
            FROM messages WHERE contact_id = c.id ORDER BY id DESC LIMIT 1) AS last_body
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

const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

app.patch('/api/contacts/:id', (req, res) => {
  const { name, stage, notes, value_cents, followup_at } = req.body;
  if (stage !== undefined && !stageExists(stage)) return res.status(400).json({ error: 'Etapa inválida' });
  if (value_cents !== undefined && !(Number.isInteger(value_cents) && value_cents >= 0))
    return res.status(400).json({ error: 'Valor inválido' });
  if (followup_at !== undefined && followup_at !== null && !isRealDate(followup_at))
    return res.status(400).json({ error: 'Data inválida. Use o formato AAAA-MM-DD' });
  if (followup_at) {
    const cur = db.prepare('SELECT stage FROM contacts WHERE id = ?').get(req.params.id);
    if (cur && isFinalStage(stage ?? cur.stage))
      return res.status(400).json({ error: 'Cliente de etapa final não tem follow-up. Se ele voltar a escrever, o follow-up volta a valer.' });
  }
  if (followup_at !== undefined) db.prepare('UPDATE contacts SET followup_at = ? WHERE id = ?').run(followup_at, req.params.id);
  db.prepare(
    `UPDATE contacts SET name = COALESCE(?, name), notes = COALESCE(?, notes),
       value_cents = COALESCE(?, value_cents) WHERE id = ?`
  ).run(name ?? null, notes ?? null, value_cents ?? null, req.params.id);
  if (stage !== undefined) setStage(req.params.id, stage);
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Contato não encontrado' });
});

app.get('/api/contacts/:id/messages', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, contact_id, direction, body, created_at, author_name, media_type, media_mime, media_name
         FROM messages WHERE contact_id = ? ORDER BY id`
      )
      .all(req.params.id)
  );
});

// Abre o arquivo de uma mensagem. Só tipos seguros abrem na tela; o resto baixa, e nunca é executado.
app.get('/api/messages/:id/media', (req, res) => {
  const m = db.prepare('SELECT media_type, media_file, media_mime, media_name FROM messages WHERE id = ?').get(req.params.id);
  if (!m?.media_file) return res.status(404).json({ error: 'Arquivo não encontrado' });
  const inline = canInline(m.media_type, m.media_mime);
  res.setHeader('Content-Type', m.media_mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName(m.media_name || m.media_file)}"`);
  res.sendFile(join(MEDIA_DIR, basename(m.media_file)), { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado' });
  });
});

app.post('/api/contacts/:id/messages', async (req, res) => {
  const text = String(req.body.text || '').trim();
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contato não encontrado' });
  if (!text) return res.status(400).json({ error: 'Mensagem vazia' });
  try {
    // "Primeira resposta" = ainda sem resposta nossa desde que o cliente entrou nesta etapa.
    const firstReply = !db.prepare(
      `SELECT 1 FROM messages WHERE contact_id = ? AND direction = 'out'
         AND created_at >= (SELECT stage_changed_at FROM contacts WHERE id = ?)`
    ).get(c.id, c.id);
    // O hóspede recebe o nome do atendente no começo; no CRM guardamos o texto sem a assinatura.
    const signature = signatureFor(req.user);
    const { id } = await provider.send(c.phone, signature ? `*${signature}*\n${text}` : text);
    addMessage(c.id, 'out', text, id, req.user);
    // Primeira resposta a quem está na primeira coluna: avança para a segunda.
    const [first, second] = listStages();
    if (firstReply && second && c.stage === first.key) {
      setStage(c.id, second.key);
    }
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Registra uma mensagem recebida: texto e/ou mídia (baixada na hora pela API oficial).
const inflight = new Set(); // evita baixar duas vezes quando a Meta reenvia a mesma mensagem
async function ingest({ phone, name, text, id = null, media = null, buffer = null, mime = null }) {
  const c = upsertContact(phone, name);
  if (id) {
    if (inflight.has(id) || db.prepare('SELECT 1 FROM messages WHERE external_id = ?').get(id)) return; // repetida
    inflight.add(id);
  }
  let saved = null;
  try {
    let body = text || '';
    if (media) {
      try {
        if (!buffer) ({ buffer, mime } = await downloadMedia(media.id, MAX_BYTES));
        const { file, mime: finalMime } = await saveMedia(buffer, mime || media.mime, media.type);
        saved = { type: media.type, file, mime: finalMime, name: media.filename || null };
      } catch (e) {
        console.error('Falha ao baixar mídia:', e.message);
        body = `${body ? body + '\n' : ''}[${TYPE_LABEL[media.type] || 'Arquivo'} ${TYPE_RECEIVED[media.type] || 'recebido'}, mas não foi possível baixar. Veja no WhatsApp.]`;
      }
    }
    if (addMessage(c.id, 'in', body, id, null, saved)) reopenIfFinal(c.id);
    else if (saved) discardMedia(saved.file);
  } finally {
    if (id) inflight.delete(id);
  }
}

// Simula uma mensagem recebida (só no modo de teste). `media` = { type, mime, name, data (base64) }.
app.post('/api/dev/incoming', async (req, res) => {
  if (provider.name !== 'mock') return res.status(404).end();
  const phone = normalize(req.body.phone);
  const m = req.body.media;
  if (m && !MEDIA_TYPES.includes(m.type)) return res.status(400).json({ error: 'Tipo de mídia inválido' });
  const buffer = m ? Buffer.from(String(m.data || ''), 'base64') : null;
  if (m && (!buffer.length || buffer.length > 5 * 1024 * 1024)) return res.status(400).json({ error: 'Arquivo inválido ou maior que 5 MB' });
  await ingest({
    phone, name: req.body.name, text: String(req.body.text || ''),
    media: m ? { type: m.type, filename: m.name } : null, buffer, mime: m?.mime,
  });
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
  // Só o provedor oficial recebe mensagens, e só com a assinatura da Meta válida.
  if (provider.name !== 'cloud') return res.sendStatus(404);
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return res.sendStatus(503);
  const got = Buffer.from(req.get('x-hub-signature-256') || '');
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex'));
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.sendStatus(401);
  res.sendStatus(200); // a Meta exige resposta rápida; o download dos arquivos acontece em seguida
  (async () => {
    for (const m of parseWebhook(req.body)) {
      try {
        await ingest({ phone: m.phone, name: m.name, text: m.text, id: m.id, media: m.media });
      } catch (e) {
        console.error('Erro ao registrar mensagem recebida:', e.message);
      }
    }
  })();
});

if (existsSync('web/dist')) {
  app.use(express.static('web/dist'));
  app.get('*', (_req, res) => res.sendFile('index.html', { root: 'web/dist' }));
}

// Erros sempre em formato simples, sem detalhes internos.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'Conteúdo grande demais' : status < 500 ? 'Requisição inválida' : 'Erro interno' });
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
if (!auth.enabled && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('Recusado: defina CRM_PASSWORD_HASH (ou CRM_PASSWORD) antes de abrir o sistema para a rede.');
  process.exit(1);
}
if (!auth.enabled) console.warn('Aviso: sem senha configurada. Use apenas no seu computador.');
app.listen(port, host, () =>
  console.log(`CRM em http://${host}:${port} (WhatsApp: ${provider.name}, login: ${auth.enabled ? 'ligado' : 'desligado'})`)
);
