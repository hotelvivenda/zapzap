import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const COOKIE = 'crm_session';
const MAX_AGE_S = 30 * 24 * 3600;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt.${salt}.${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split(".");
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadSecret() {
  mkdirSync('data', { recursive: true });
  const file = 'data/session.key';
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const b64 = (s) => Buffer.from(s).toString('base64url');

// Login por senha única. Sem senha configurada, a proteção fica desligada (só para uso local).
export function setupAuth({ passwordHash, passwordPlain }) {
  const stored = passwordHash || (passwordPlain ? hashPassword(passwordPlain) : '');
  const enabled = !!stored;
  // A chave depende da senha: trocar a senha encerra todas as sessões abertas.
  const key = enabled ? crypto.createHmac('sha256', loadSecret()).update(stored).digest() : null;
  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  const isAuthed = (req) => {
    if (!enabled) return true;
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [payload, mac] = raw.slice(COOKIE.length + 1).split('.');
    if (!payload || !mac) return false;
    const expected = sign(payload);
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
    } catch {
      return false;
    }
  };

  const fails = new Map();
  const cookieFlags = (req) => `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;

  return {
    enabled,
    isAuthed,
    require(req, res, next) {
      isAuthed(req) ? next() : res.status(401).json({ error: 'Faça login para continuar' });
    },
    mount(app) {
      app.get('/api/me', (req, res) => res.json({ auth: enabled, authenticated: isAuthed(req) }));

      app.post('/api/login', (req, res) => {
        if (!enabled) return res.json({ ok: true });
        const now = Date.now();
        const rec = fails.get(req.ip);
        if (rec && rec.reset > now && rec.n >= MAX_FAILS)
          return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
        if (!verifyPassword(String(req.body.password || ''), stored)) {
          const cur = rec && rec.reset > now ? rec : { n: 0, reset: now + WINDOW_MS };
          cur.n += 1;
          fails.set(req.ip, cur);
          return res.status(401).json({ error: 'Senha incorreta' });
        }
        fails.delete(req.ip);
        const payload = b64(JSON.stringify({ exp: now + MAX_AGE_S * 1000 }));
        res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Max-Age=${MAX_AGE_S}; ${cookieFlags(req)}`);
        res.json({ ok: true });
      });

      app.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
        res.json({ ok: true });
      });
    },
  };
}
