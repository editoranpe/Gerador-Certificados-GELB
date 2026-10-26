/**
 * Gerador de Certificados GELB 32/SC — API do Worker.
 * As páginas e o desenho dos certificados ficam em public/ (rodam no navegador).
 * Aqui ficam: login da diretoria, modelos, configurações, histórico e validação pública.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
}

type AppEnv = { Bindings: Env };

const COOKIE = 'gelb_cert_session';
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 dias: a diretoria não precisa entrar toda hora
const MAX_VALUE = 1_900_000; // limite de texto por linha no D1 (~2 MB)

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------- banco

let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, model TEXT NOT NULL, description TEXT, image TEXT, layout TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, file_name TEXT, file_size INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS template_files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS certificates (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, registration TEXT, category TEXT, model TEXT, event_date TEXT, data TEXT NOT NULL, issued_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_certificates_issued ON certificates(issued_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fonts (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)`),
    // Modelo padrão embutido: a arte é desenhada pelo navegador; aqui só guardamos as posições.
    db
      .prepare(
        `INSERT OR IGNORE INTO templates (id, name, category, model, description, image, layout, is_default, builtin, hidden, created_at, updated_at)
         VALUES ('acolhida-padrao', 'Certificado de Acolhida dos Filhotes', 'Progressão', 'Acolhida', 'Modelo oficial de Acolhida do Ramo Filhotes (já vem com o sistema).', NULL, '{"preset":"linhas"}', 1, 1, 0, ?1, ?1)`,
      )
      .bind(new Date().toISOString()),
  ]);
  schemaReady = true;
}

app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// ---------------------------------------------------------------- sessão

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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

const configured = (env: Env) => !!env.APP_PASSWORD && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;

async function makeSession(env: Env) {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL);
  return `${exp}.${await hmac(env.SESSION_SECRET!, 'sessao:' + exp)}`;
}

async function validSession(env: Env, cookie?: string) {
  if (!cookie || !configured(env)) return false;
  const [exp, sig] = cookie.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET!, 'sessao:' + exp));
}

app.get('/api/me', async (c) => {
  if (!configured(c.env)) return c.json({ ok: false, configured: false }, 401);
  const ok = await validSession(c.env, getCookie(c, COOKIE));
  return c.json({ ok, configured: true }, ok ? 200 : 401);
});

app.post('/api/login', async (c) => {
  if (!configured(c.env)) return c.json({ ok: false, message: 'O sistema ainda não tem senha configurada. Veja o README.' }, 503);
  const ip = c.req.header('cf-connecting-ip') || 'local';
  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE ip = ?').bind(ip).first<{ count: number; window_start: number }>();
  if (row && now - row.window_start < 900 && row.count >= 8) {
    return c.json({ ok: false, message: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }, 429);
  }
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (await safeEqual(String(body.password || ''), c.env.APP_PASSWORD!)) {
    await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
    setCookie(c, COOKIE, await makeSession(c.env), {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL,
    });
    return c.json({ ok: true });
  }
  const fresh = !row || now - row.window_start >= 900;
  await c.env.DB.prepare(
    'INSERT INTO login_attempts (ip, count, window_start) VALUES (?1, 1, ?2) ON CONFLICT(ip) DO UPDATE SET count = CASE WHEN ?3 THEN 1 ELSE count + 1 END, window_start = CASE WHEN ?3 THEN ?2 ELSE window_start END',
  )
    .bind(ip, now, fresh ? 1 : 0)
    .run();
  return c.json({ ok: false, message: 'Senha incorreta.' }, 401);
});

app.post('/api/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- validação pública (QR Code)

app.get('/api/validar/:code', async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  const row = await c.env.DB.prepare('SELECT recipient, registration, category, model, event_date, issued_at, code FROM certificates WHERE code = ?')
    .bind(code)
    .first();
  if (!row) return c.json({ ok: false }, 404);
  return c.json({ ok: true, certificate: row });
});

// Logo do grupo (pública: aparece na tela de entrada, no topo e na página de conferência)
app.get('/api/logo', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'logoLeft'").first<{ value: string }>();
  let logo: unknown = null;
  try {
    logo = row ? JSON.parse(row.value) : null;
  } catch {
    /* valor corrompido: usa a logo original */
  }
  if (typeof logo === 'string' && logo.startsWith('data:image/')) return dataUrlResponse(logo, undefined, 'public, max-age=300');
  return c.redirect('/img/logo-gelb.svg', 302);
});

// ---------------------------------------------------------------- daqui para baixo, só com login

app.use('/api/*', async (c, next) => {
  if (!(await validSession(c.env, getCookie(c, COOKIE)))) return c.json({ ok: false, message: 'Faça login novamente.' }, 401);
  await next();
});

const now = () => new Date().toISOString();
const tooBig = (v: unknown) => typeof v === 'string' && v.length > MAX_VALUE;

// Configurações (nome do grupo, cidade, logos e assinaturas)
app.get('/api/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of results) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignora valor corrompido */
    }
  }
  return c.json(out);
});

const SETTING_KEYS = ['groupName', 'city', 'logoLeft', 'logoRight', 'signatories', 'typography'];

app.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const stmts = [];
  for (const key of SETTING_KEYS) {
    if (!(key in body)) continue;
    const value = JSON.stringify(body[key] ?? null);
    if (value.length > MAX_VALUE) return c.json({ ok: false, message: 'Imagem grande demais. Use um arquivo menor.' }, 413);
    stmts.push(
      c.env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3').bind(key, value, now()),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// Modelos
interface TemplateRow {
  id: string;
  name: string;
  category: string;
  model: string;
  description: string | null;
  layout: string;
  is_default: number;
  builtin: number;
  hidden: number;
  file_name: string | null;
  file_size: number | null;
  has_original: number;
  updated_at: string;
}

const templateOut = (r: TemplateRow) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  model: r.model,
  description: r.description,
  layout: JSON.parse(r.layout || '{}'),
  isDefault: !!r.is_default,
  builtin: !!r.builtin,
  hidden: !!r.hidden,
  fileName: r.file_name,
  fileSize: r.file_size,
  hasOriginal: !!r.has_original,
  version: r.updated_at,
});

app.get('/api/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.category, t.model, t.description, t.layout, t.is_default, t.builtin, t.hidden, t.file_name, t.file_size, t.updated_at,
            (SELECT COUNT(*) FROM template_files f WHERE f.id = t.id) AS has_original
     FROM templates t ORDER BY t.category, t.model, t.name`,
  ).all<TemplateRow>();
  return c.json(results.map(templateOut));
});

function dataUrlResponse(dataUrl: string, filename?: string, cache = 'private, max-age=31536000, immutable') {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return new Response('Arquivo inválido', { status: 500 });
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (ch) => ch.charCodeAt(0)) : enc.encode(decodeURIComponent(m[3]));
  const headers: Record<string, string> = { 'content-type': m[1], 'cache-control': cache };
  if (filename) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(bytes, { headers });
}

app.get('/api/templates/:id/image', async (c) => {
  const row = await c.env.DB.prepare('SELECT image FROM templates WHERE id = ?').bind(c.req.param('id')).first<{ image: string | null }>();
  if (!row?.image) return c.text('Sem imagem', 404);
  return dataUrlResponse(row.image);
});

app.get('/api/templates/:id/original', async (c) => {
  const id = c.req.param('id');
  const [file, tpl] = await Promise.all([
    c.env.DB.prepare('SELECT mime, data FROM template_files WHERE id = ?').bind(id).first<{ mime: string; data: string }>(),
    c.env.DB.prepare('SELECT file_name FROM templates WHERE id = ?').bind(id).first<{ file_name: string | null }>(),
  ]);
  if (!file) return c.text('O arquivo original deste modelo não foi guardado.', 404);
  return dataUrlResponse(file.data, tpl?.file_name || 'modelo.pdf');
});

interface TemplateInput {
  name?: string;
  category?: string;
  model?: string;
  description?: string;
  image?: string;
  layout?: unknown;
  isDefault?: boolean;
  hidden?: boolean;
  fileName?: string;
  fileSize?: number;
  original?: string;
}

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

async function clearOtherDefaults(db: D1Database, id: string) {
  const t = await db.prepare('SELECT category, model FROM templates WHERE id = ?').bind(id).first<{ category: string; model: string }>();
  if (t) await db.prepare('UPDATE templates SET is_default = 0 WHERE category = ? AND model = ? AND id <> ?').bind(t.category, t.model, id).run();
}

app.post('/api/templates', async (c) => {
  const b = await c.req.json<TemplateInput>();
  const name = clean(b.name);
  const category = clean(b.category, 100);
  const model = clean(b.model, 150);
  if (!name || !category || !model) return c.json({ ok: false, message: 'Informe nome, categoria e modelo.' }, 400);
  if (typeof b.image !== 'string' || !b.image.startsWith('data:image/')) return c.json({ ok: false, message: 'A imagem do modelo não foi gerada.' }, 400);
  if (tooBig(b.image)) return c.json({ ok: false, message: 'A arte ficou grande demais. Tente um arquivo menor.' }, 413);
  const id = 'tpl-' + crypto.randomUUID().slice(0, 12);
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO templates (id, name, category, model, description, image, layout, is_default, builtin, hidden, file_name, file_size, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?10, ?11, ?11)`,
    ).bind(id, name, category, model, clean(b.description, 1000) || null, b.image, JSON.stringify(b.layout ?? {}), b.isDefault === false ? 0 : 1, clean(b.fileName, 255) || null, Number(b.fileSize) || null, now()),
  ];
  // O arquivo original só é guardado se couber no banco; a arte (imagem) já basta para emitir.
  if (typeof b.original === 'string' && b.original.startsWith('data:') && !tooBig(b.original)) {
    stmts.push(c.env.DB.prepare('INSERT INTO template_files (id, mime, data) VALUES (?, ?, ?)').bind(id, b.original.slice(5, b.original.indexOf(';')), b.original));
  }
  await c.env.DB.batch(stmts);
  if (b.isDefault !== false) await clearOtherDefaults(c.env.DB, id);
  return c.json({ ok: true, id });
});

app.put('/api/templates/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<TemplateInput>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?${vals.length + 1}`);
    vals.push(v);
  };
  if (b.name !== undefined) put('name', clean(b.name) || 'Modelo');
  if (b.category !== undefined) put('category', clean(b.category, 100));
  if (b.model !== undefined) put('model', clean(b.model, 150));
  if (b.description !== undefined) put('description', clean(b.description, 1000) || null);
  if (b.layout !== undefined) put('layout', JSON.stringify(b.layout));
  if (b.isDefault !== undefined) put('is_default', b.isDefault ? 1 : 0);
  if (b.hidden !== undefined) put('hidden', b.hidden ? 1 : 0);
  if (!sets.length) return c.json({ ok: true });
  put('updated_at', now());
  vals.push(id);
  await c.env.DB.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  if (b.isDefault) await clearOtherDefaults(c.env.DB, id);
  return c.json({ ok: true });
});

app.delete('/api/templates/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT builtin FROM templates WHERE id = ?').bind(id).first<{ builtin: number }>();
  if (row?.builtin) {
    // O modelo embutido não é apagado de verdade: fica oculto e pode ser restaurado.
    await c.env.DB.prepare('UPDATE templates SET hidden = 1, updated_at = ? WHERE id = ?').bind(now(), id).run();
  } else {
    await c.env.DB.batch([c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id), c.env.DB.prepare('DELETE FROM template_files WHERE id = ?').bind(id)]);
  }
  return c.json({ ok: true });
});

// Fontes enviadas pela diretoria (usadas nos certificados)
const FONT_TYPES: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

app.get('/api/fonts', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name FROM fonts ORDER BY name').all();
  return c.json(results);
});

app.get('/api/fonts/:id/file', async (c) => {
  const row = await c.env.DB.prepare('SELECT data FROM fonts WHERE id = ?').bind(c.req.param('id')).first<{ data: string }>();
  if (!row) return c.text('Fonte não encontrada', 404);
  return dataUrlResponse(row.data);
});

app.post('/api/fonts', async (c) => {
  const b = await c.req.json<{ name?: string; fileName?: string; data?: string }>();
  const ext = String(b.fileName || '').toLowerCase().split('.').pop() || '';
  const mime = FONT_TYPES[ext];
  if (!mime) return c.json({ ok: false, message: 'Envie um arquivo de fonte .ttf, .otf, .woff ou .woff2.' }, 400);
  if (typeof b.data !== 'string' || !b.data.includes(';base64,')) return c.json({ ok: false, message: 'Arquivo de fonte inválido.' }, 400);
  if (tooBig(b.data)) return c.json({ ok: false, message: 'Fonte grande demais (máximo de 1,4 MB).' }, 413);
  // Nome da família: só letras, números, espaço e hífen (vai dentro de CSS e do canvas)
  const name = clean(b.name, 60).replace(/[^\p{L}\p{N} \-]/gu, '').trim();
  if (!name) return c.json({ ok: false, message: 'Dê um nome para a fonte.' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM fonts WHERE name = ?').bind(name).first();
  if (dup) return c.json({ ok: false, message: `Já existe uma fonte chamada "${name}".` }, 409);
  const id = 'font-' + crypto.randomUUID().slice(0, 12);
  const data = `data:${mime};base64,` + b.data.slice(b.data.indexOf(';base64,') + 8);
  await c.env.DB.prepare('INSERT INTO fonts (id, name, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, mime, data, now()).run();
  return c.json({ ok: true, id, name });
});

app.delete('/api/fonts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM fonts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// Certificados emitidos
interface CertInput {
  id?: string;
  code?: string;
  recipientName?: string;
  recipientRegistration?: string;
  category?: string;
  model?: string;
  date?: string;
  [k: string]: unknown;
}

app.get('/api/certificates', async (c) => {
  const q = `%${(c.req.query('q') || '').trim()}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, recipient, registration, category, model, event_date, issued_at, updated_at, data FROM certificates
     WHERE recipient LIKE ?1 OR registration LIKE ?1 OR code LIKE ?1 OR model LIKE ?1 OR category LIKE ?1
     ORDER BY updated_at DESC LIMIT 500`,
  )
    .bind(q)
    .all<{ data: string; [k: string]: unknown }>();
  return c.json(results.map((r) => ({ ...r, data: JSON.parse(r.data) })));
});

app.post('/api/certificates', async (c) => {
  const body = await c.req.json<{ certificates?: CertInput[] }>();
  const list = Array.isArray(body.certificates) ? body.certificates.slice(0, 500) : [];
  if (!list.length) return c.json({ ok: false, message: 'Nada para salvar.' }, 400);
  const t = now();
  const stmts = [];
  for (const cert of list) {
    const id = clean(cert.id, 80);
    const code = clean(cert.code, 40).toUpperCase();
    if (!id || !/^GELB-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code)) return c.json({ ok: false, message: 'Código de certificado inválido.' }, 400);
    const data = JSON.stringify(cert);
    if (data.length > 100_000) return c.json({ ok: false, message: 'Dados do certificado grandes demais.' }, 413);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO certificates (id, code, recipient, registration, category, model, event_date, data, issued_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(id) DO UPDATE SET recipient = ?3, registration = ?4, category = ?5, model = ?6, event_date = ?7, data = ?8, updated_at = ?9`,
      ).bind(id, code, clean(cert.recipientName) || '(sem nome)', clean(cert.recipientRegistration, 60) || null, clean(cert.category, 100), clean(cert.model, 150), clean(cert.date, 20) || null, data, t),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, saved: stmts.length });
});

app.delete('/api/certificates/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM certificates WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.notFound((c) => (c.req.path.startsWith('/api') ? c.json({ ok: false, message: 'Não encontrado.' }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  console.error('Erro não tratado', err);
  return c.json({ ok: false, message: 'Erro inesperado. Tente novamente.' }, 500);
});

export default app;
