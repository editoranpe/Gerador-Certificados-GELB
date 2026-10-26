/**
 * Usuários da diretoria: login por e-mail e senha, senha provisória com troca no 1º acesso,
 * gestão de usuários (só administradores) e histórico de alterações.
 */
import type { Context, Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD?: string; // chave de instalação (cria o 1º administrador) e de recuperação de administrador
  SESSION_SECRET?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  must_change: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
type C = Context<AppEnv>;

const COOKIE = 'gelb_cert_session';
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 dias: a diretoria não precisa entrar toda hora
const MIN_PASSWORD = 8;

export const AUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, last_login_at TEXT, last_seen_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL, details TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)`,
];

const now = () => new Date().toISOString();
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([hmac('cmp', a), hmac('cmp', b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- senhas (PBKDF2)

const ITERATIONS = 100_000; // máximo aceito pelo Workers

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ITERATIONS))}`;
}

async function checkPassword(password: string, stored: string) {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2' || !salt || !hash) return false;
  return safeEqual(b64url(await pbkdf2(password, fromB64url(salt), Number(iter))), hash);
}

/** Senha provisória fácil de ditar: 3 grupos de 4 (sem letras que se confundem). */
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

// ---------------------------------------------------------------- sessão

export const configured = (env: Env) => !!env.APP_PASSWORD && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;

async function startSession(c: C, userId: string, version: number) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = `${userId}.${version}.${exp}`;
  setCookie(c, COOKIE, `${body}.${await hmac(c.env.SESSION_SECRET!, 's:' + body)}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

interface UserRow extends SessionUser {
  pass_hash: string;
  active: number;
  session_version: number;
  last_seen_at: string | null;
}

/** Usuário da sessão, ou null. Desativar ou trocar a senha derruba as sessões antigas na hora. */
async function sessionUser(c: C): Promise<UserRow | null> {
  const cookie = getCookie(c, COOKIE);
  if (!cookie || !configured(c.env)) return null;
  const [id, ver, exp, sig] = cookie.split('.');
  if (!id || !ver || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  if (!(await safeEqual(sig, await hmac(c.env.SESSION_SECRET!, `s:${id}.${ver}.${exp}`)))) return null;
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!u || !u.active || String(u.session_version) !== ver) return null;
  return u;
}

const publicUser = (u: SessionUser) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChange: !!u.must_change });

/** Registra no histórico de alterações quem fez o quê. */
export async function audit(c: C, action: string, details = '') {
  const u = c.get('user');
  await c.env.DB.prepare('INSERT INTO audit_log (at, user_id, user_name, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(now(), u?.id ?? null, u?.name ?? null, action, details.slice(0, 500))
    .run();
}

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const userCount = async (db: D1Database) => (await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;

async function tooManyAttempts(db: D1Database, ip: string) {
  const t = Math.floor(Date.now() / 1000);
  const row = await db.prepare('SELECT count, window_start FROM login_attempts WHERE ip = ?').bind(ip).first<{ count: number; window_start: number }>();
  return !!row && t - row.window_start < 900 && row.count >= 8;
}

async function failedAttempt(db: D1Database, ip: string) {
  const t = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET count = CASE WHEN ?2 - window_start >= 900 THEN 1 ELSE count + 1 END,
                                     window_start = CASE WHEN ?2 - window_start >= 900 THEN ?2 ELSE window_start END`,
    )
    .bind(ip, t)
    .run();
}

// ---------------------------------------------------------------- rotas públicas

export function publicAuthRoutes(app: Hono<AppEnv>) {
  app.get('/api/me', async (c) => {
    if (!configured(c.env)) return c.json({ ok: false, configured: false }, 401);
    if ((await userCount(c.env.DB)) === 0) return c.json({ ok: false, configured: true, setup: true }, 401);
    const u = await sessionUser(c);
    if (!u) return c.json({ ok: false, configured: true }, 401);
    return c.json({ ok: true, user: publicUser(u) });
  });

  // Primeiro acesso: cria o administrador com a chave de instalação (APP_PASSWORD)
  app.post('/api/setup', async (c) => {
    if (!configured(c.env)) return c.json({ ok: false, message: 'O sistema ainda não foi configurado. Veja o README.' }, 503);
    if ((await userCount(c.env.DB)) > 0) return c.json({ ok: false, message: 'O administrador já foi criado. Entre com seu e-mail e senha.' }, 409);
    const ip = c.req.header('cf-connecting-ip') || 'local';
    if (await tooManyAttempts(c.env.DB, ip)) return c.json({ ok: false, message: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }, 429);
    const b = await c.req.json<{ key?: string; name?: string; email?: string; password?: string }>().catch(() => ({}) as Record<string, string>);
    if (!(await safeEqual(String(b.key || ''), c.env.APP_PASSWORD!))) {
      await failedAttempt(c.env.DB, ip);
      return c.json({ ok: false, message: 'Chave de instalação incorreta.' }, 401);
    }
    const name = clean(b.name, 80);
    const email = clean(b.email, 120).toLowerCase();
    const password = String(b.password || '');
    if (!name || !validEmail(email)) return c.json({ ok: false, message: 'Informe seu nome e um e-mail válido.' }, 400);
    if (password.length < MIN_PASSWORD) return c.json({ ok: false, message: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` }, 400);
    const id = 'u-' + crypto.randomUUID().slice(0, 12);
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, pass_hash, role, active, must_change, session_version, created_at, last_login_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, 'admin', 1, 0, 1, ?5, ?5, ?5)`,
    )
      .bind(id, name, email, await hashPassword(password), now())
      .run();
    c.set('user', { id, name, email, role: 'admin', must_change: 0 });
    await audit(c, 'Criou o primeiro administrador', `${name} <${email}>`);
    await startSession(c, id, 1);
    return c.json({ ok: true });
  });

  app.post('/api/login', async (c) => {
    if (!configured(c.env)) return c.json({ ok: false, message: 'O sistema ainda não foi configurado. Veja o README.' }, 503);
    const ip = c.req.header('cf-connecting-ip') || 'local';
    if (await tooManyAttempts(c.env.DB, ip)) return c.json({ ok: false, message: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }, 429);
    const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as Record<string, string>);
    const email = clean(b.email, 120).toLowerCase();
    const password = String(b.password || '');
    const u = email ? await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>() : null;
    let ok = !!u && !!u.active && (await checkPassword(password, u.pass_hash));
    // Recuperação: administrador que esqueceu a senha entra com a chave de instalação e cria outra
    let recovery = false;
    if (!ok && u && u.active && u.role === 'admin' && (await safeEqual(password, c.env.APP_PASSWORD!))) ok = recovery = true;
    if (!ok || !u) {
      await failedAttempt(c.env.DB, ip);
      const inactive = u && !u.active && (await checkPassword(password, u.pass_hash));
      return c.json({ ok: false, message: inactive ? 'Este acesso foi desativado. Fale com o administrador.' : 'E-mail ou senha incorretos.' }, 401);
    }
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
      c.env.DB.prepare(`UPDATE users SET last_login_at = ?1, last_seen_at = ?1${recovery ? ', must_change = 1' : ''} WHERE id = ?2`).bind(now(), u.id),
    ]);
    if (recovery) {
      c.set('user', u);
      await audit(c, 'Entrou com a chave de recuperação', u.email);
    }
    await startSession(c, u.id, u.session_version);
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
}

// ---------------------------------------------------------------- daqui para baixo, só com login

export function requireLogin(app: Hono<AppEnv>) {
  app.use('/api/*', async (c, next) => {
    const u = await sessionUser(c);
    if (!u) return c.json({ ok: false, message: 'Faça login novamente.' }, 401);
    c.set('user', u);
    // "Último acesso": atualizado no máximo a cada 10 minutos
    if (!u.last_seen_at || Date.now() - Date.parse(u.last_seen_at) > 10 * 60 * 1000) {
      await c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now(), u.id).run();
    }
    // Senha provisória: só deixa criar a senha nova
    if (u.must_change && !['/api/password', '/api/logout'].includes(c.req.path)) {
      return c.json({ ok: false, mustChange: true, message: 'Crie a sua senha para continuar.' }, 403);
    }
    await next();
  });

  app.post('/api/password', async (c) => {
    const u = c.get('user') as UserRow;
    const b = await c.req.json<{ current?: string; password?: string }>().catch(() => ({}) as Record<string, string>);
    const password = String(b.password || '');
    if (!u.must_change && !(await checkPassword(String(b.current || ''), u.pass_hash))) {
      return c.json({ ok: false, message: 'A senha atual não confere.' }, 400);
    }
    if (password.length < MIN_PASSWORD) return c.json({ ok: false, message: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` }, 400);
    if (await checkPassword(password, u.pass_hash)) return c.json({ ok: false, message: 'Escolha uma senha diferente da provisória.' }, 400);
    const version = u.session_version + 1; // derruba sessões abertas em outros aparelhos
    await c.env.DB.prepare('UPDATE users SET pass_hash = ?, must_change = 0, session_version = ? WHERE id = ?').bind(await hashPassword(password), version, u.id).run();
    await audit(c, 'Trocou a própria senha');
    await startSession(c, u.id, version);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ gestão (só administradores)

  const adminOnly = async (c: C, next: () => Promise<void>) => {
    if (c.get('user').role !== 'admin') return c.json({ ok: false, message: 'Somente administradores.' }, 403);
    await next();
  };
  app.use('/api/users/*', adminOnly);
  app.use('/api/users', adminOnly);
  app.use('/api/audit', adminOnly);

  app.get('/api/users', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.must_change, u.created_at, u.last_login_at, u.last_seen_at,
              (SELECT name FROM users x WHERE x.id = u.created_by) AS created_by_name,
              (SELECT COUNT(*) FROM certificates k WHERE k.issued_by = u.id) AS issued
       FROM users u ORDER BY u.active DESC, u.name COLLATE NOCASE`,
    ).all();
    return c.json(results);
  });

  app.post('/api/users', async (c) => {
    const b = await c.req.json<{ name?: string; email?: string; role?: string }>();
    const name = clean(b.name, 80);
    const email = clean(b.email, 120).toLowerCase();
    if (!name || !validEmail(email)) return c.json({ ok: false, message: 'Informe o nome e um e-mail válido.' }, 400);
    if (await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) {
      return c.json({ ok: false, message: 'Já existe um usuário com esse e-mail.' }, 409);
    }
    const role = b.role === 'admin' ? 'admin' : 'user';
    const id = 'u-' + crypto.randomUUID().slice(0, 12);
    const temp = tempPassword();
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, pass_hash, role, active, must_change, session_version, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`,
    )
      .bind(id, name, email, await hashPassword(temp), role, now(), c.get('user').id)
      .run();
    await audit(c, 'Criou usuário', `${name} <${email}>${role === 'admin' ? ' (administrador)' : ''}`);
    return c.json({ ok: true, id, tempPassword: temp });
  });

  /** Impede deixar o sistema sem nenhum administrador ativo. */
  async function lastActiveAdmin(db: D1Database, id: string) {
    const r = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").bind(id).first<{ n: number }>();
    return (r?.n ?? 0) === 0;
  }

  app.put('/api/users/:id', async (c) => {
    const id = c.req.param('id');
    const me = c.get('user');
    const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    if (!target) return c.json({ ok: false, message: 'Usuário não encontrado.' }, 404);
    const b = await c.req.json<{ name?: string; email?: string; role?: string; active?: boolean }>();
    const name = b.name !== undefined ? clean(b.name, 80) : target.name;
    const email = b.email !== undefined ? clean(b.email, 120).toLowerCase() : target.email;
    const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'user') : target.role;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : target.active;
    if (!name || !validEmail(email)) return c.json({ ok: false, message: 'Informe o nome e um e-mail válido.' }, 400);
    if (id === me.id && !active) return c.json({ ok: false, message: 'Você não pode desativar o seu próprio acesso.' }, 400);
    if (target.role === 'admin' && target.active && (role !== 'admin' || !active) && (await lastActiveAdmin(c.env.DB, id))) {
      return c.json({ ok: false, message: 'É preciso ter pelo menos um administrador ativo.' }, 400);
    }
    if (email !== target.email && (await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').bind(email, id).first())) {
      return c.json({ ok: false, message: 'Já existe um usuário com esse e-mail.' }, 409);
    }
    // desativar derruba a sessão na hora
    const version = target.session_version + (active ? 0 : 1);
    await c.env.DB.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ?, session_version = ? WHERE id = ?').bind(name, email, role, active, version, id).run();
    const changes = [];
    if (name !== target.name) changes.push(`nome: ${target.name} → ${name}`);
    if (email !== target.email) changes.push(`e-mail: ${target.email} → ${email}`);
    if (role !== target.role) changes.push(role === 'admin' ? 'virou administrador' : 'deixou de ser administrador');
    if (active !== target.active) changes.push(active ? 'reativado' : 'desativado');
    if (changes.length) await audit(c, active !== target.active ? (active ? 'Reativou usuário' : 'Desativou usuário') : 'Editou usuário', `${name}: ${changes.join('; ')}`);
    return c.json({ ok: true });
  });

  app.post('/api/users/:id/reset', async (c) => {
    const id = c.req.param('id');
    const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    if (!target) return c.json({ ok: false, message: 'Usuário não encontrado.' }, 404);
    const temp = tempPassword();
    await c.env.DB.prepare('UPDATE users SET pass_hash = ?, must_change = 1, session_version = session_version + 1 WHERE id = ?').bind(await hashPassword(temp), id).run();
    await audit(c, 'Gerou senha provisória', `${target.name} <${target.email}>`);
    return c.json({ ok: true, tempPassword: temp });
  });

  app.get('/api/audit', async (c) => {
    const who = c.req.query('user') || '';
    const { results } = await c.env.DB.prepare(
      `SELECT id, at, user_id, user_name, action, details FROM audit_log WHERE (?1 = '' OR user_id = ?1) ORDER BY id DESC LIMIT 300`,
    )
      .bind(who)
      .all();
    return c.json(results);
  });
}
