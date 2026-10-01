import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { db } from './db.js';

const COOKIE = 'crm_session';
const MAX_AGE_S = 30 * 24 * 3600;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const ROLES = ['admin', 'atendente'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt.${salt}.${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('.');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const DUMMY_HASH = hashPassword('sem-usuario');

function loadSecret() {
  mkdirSync('data', { recursive: true });
  const file = 'data/session.key';
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
// A sessão guarda uma "impressão" da senha: trocar a senha encerra as sessões antigas.
const fingerprint = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active });
const normUsername = (s) => String(s || '').trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

// Sem nenhum usuário cadastrado, a proteção fica desligada (só para uso local).
export function setupAuth({ passwordHash, passwordPlain, adminName }) {
  const seed = passwordHash || (passwordPlain ? hashPassword(passwordPlain) : '');
  if (seed && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    db.prepare(`INSERT INTO users (username, name, password_hash, role) VALUES ('admin', ?, ?, 'admin')`).run(
      String(adminName || 'Administrador').trim().slice(0, 60) || 'Administrador',
      seed
    );
  }
  const enabled = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  const secret = enabled ? loadSecret() : null;
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const DEV_USER = { id: 0, username: 'local', name: process.env.CRM_DEV_NAME || 'Você', role: 'admin', active: true };

  const userFromCookie = (req) => {
    if (!enabled) return DEV_USER;
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [payload, mac] = raw.slice(COOKIE.length + 1).split('.');
    if (!payload || !mac) return null;
    const expected = sign(payload);
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    try {
      const { uid, exp, v } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!(exp > Date.now())) return null;
      const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
      return u && fingerprint(u.password_hash) === v ? u : null;
    } catch {
      return null;
    }
  };

  const cookieFlags = (req) => `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;
  const issue = (req, res, u) => {
    const payload = b64(JSON.stringify({ uid: u.id, exp: Date.now() + MAX_AGE_S * 1000, v: fingerprint(u.password_hash) }));
    res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Max-Age=${MAX_AGE_S}; ${cookieFlags(req)}`);
  };
  const activeAdmins = () => db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get().n;
  const needLogin = (res) => res.status(400).json({ error: 'O login não está ativado neste sistema.' });

  const fails = new Map();

  return {
    enabled,
    require(req, res, next) {
      const u = userFromCookie(req);
      if (!u) return res.status(401).json({ error: 'Faça login para continuar' });
      req.user = u;
      next();
    },
    requireAdmin(req, res, next) {
      req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Só administradores podem fazer isso' });
    },

    // Rotas abertas: quem ainda não entrou precisa poder chegar nelas.
    mount(app) {
      app.get('/api/me', (req, res) => {
        const u = userFromCookie(req);
        res.json({ auth: enabled, authenticated: !!u, user: u ? publicUser(u) : null });
      });

      app.post('/api/login', (req, res) => {
        if (!enabled) return res.json({ ok: true });
        const now = Date.now();
        const rec = fails.get(req.ip);
        if (rec && rec.reset > now && rec.n >= MAX_FAILS)
          return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
        const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(normUsername(req.body.username));
        const ok = verifyPassword(String(req.body.password || ''), u ? u.password_hash : DUMMY_HASH) && !!u;
        if (!ok) {
          const cur = rec && rec.reset > now ? rec : { n: 0, reset: now + WINDOW_MS };
          cur.n += 1;
          fails.set(req.ip, cur);
          return res.status(401).json({ error: 'Usuário ou senha incorretos' });
        }
        fails.delete(req.ip);
        issue(req, res, u);
        res.json({ ok: true });
      });

      app.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
        res.json({ ok: true });
      });
    },

    // Rotas que exigem login (registrar depois do `require`).
    mountUsers(app) {
      app.post('/api/me/password', (req, res) => {
        if (!enabled) return needLogin(res);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!verifyPassword(String(req.body.current || ''), u.password_hash))
          return res.status(400).json({ error: 'A senha atual está incorreta' });
        const pw = String(req.body.password || '');
        if (pw.length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres' });
        const hash = hashPassword(pw);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
        issue(req, res, { ...u, password_hash: hash }); // continua logado neste aparelho
        res.json({ ok: true });
      });

      app.get('/api/users', this.requireAdmin, (_req, res) => {
        if (!enabled) return res.json([]);
        res.json(db.prepare('SELECT * FROM users ORDER BY active DESC, name').all().map(publicUser));
      });

      app.post('/api/users', this.requireAdmin, (req, res) => {
        if (!enabled) return needLogin(res);
        const username = normUsername(req.body.username);
        const name = String(req.body.name || '').trim().slice(0, 60);
        const role = req.body.role || 'atendente';
        const pw = String(req.body.password || '');
        if (!name) return res.status(400).json({ error: 'Informe o nome do atendente' });
        if (!USERNAME_RE.test(username))
          return res.status(400).json({ error: 'Usuário: 3 a 30 letras minúsculas, números, ponto, traço ou sublinhado' });
        if (!ROLES.includes(role)) return res.status(400).json({ error: 'Tipo de acesso inválido' });
        if (pw.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres' });
        try {
          const r = db
            .prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)')
            .run(username, name, hashPassword(pw), role);
          res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)));
        } catch {
          res.status(409).json({ error: 'Esse usuário já existe' });
        }
      });

      app.patch('/api/users/:id', this.requireAdmin, (req, res) => {
        if (!enabled) return needLogin(res);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!u) return res.status(404).json({ error: 'Atendente não encontrado' });
        const next = { ...u };
        const b = req.body;
        if (b.name !== undefined) {
          next.name = String(b.name).trim().slice(0, 60);
          if (!next.name) return res.status(400).json({ error: 'Informe o nome do atendente' });
        }
        if (b.username !== undefined) {
          next.username = normUsername(b.username);
          if (!USERNAME_RE.test(next.username)) return res.status(400).json({ error: 'Usuário inválido' });
        }
        if (b.role !== undefined) {
          if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Tipo de acesso inválido' });
          next.role = b.role;
        }
        if (b.active !== undefined) next.active = b.active ? 1 : 0;
        if (b.password !== undefined) {
          if (String(b.password).length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres' });
          next.password_hash = hashPassword(String(b.password));
        }
        const losesAdmin = u.role === 'admin' && u.active && !(next.role === 'admin' && next.active);
        if (losesAdmin && activeAdmins() <= 1)
          return res.status(400).json({ error: 'Precisa existir pelo menos um administrador ativo' });
        if (u.id === req.user.id && !next.active)
          return res.status(400).json({ error: 'Você não pode desativar o seu próprio acesso' });
        try {
          db.prepare('UPDATE users SET username=?, name=?, role=?, active=?, password_hash=? WHERE id=?').run(
            next.username, next.name, next.role, next.active, next.password_hash, u.id
          );
        } catch {
          return res.status(409).json({ error: 'Esse usuário já existe' });
        }
        res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
      });
    },
  };
}
