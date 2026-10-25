-- Gerador de Certificados GELB 32/SC
-- O Worker também cria estas tabelas sozinho (ver ensureSchema em src/index.ts).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Modelos de fundo (arte enviada em PDF/imagem) com as posições dos campos
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  model TEXT NOT NULL,
  description TEXT,
  image TEXT,                -- data URL (JPEG/PNG) da página; NULL no modelo padrão embutido
  layout TEXT NOT NULL,      -- JSON com campos, posições, fonte e cor
  is_default INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Arquivo original enviado (para "baixar original"), quando cabe no banco
CREATE TABLE IF NOT EXISTS template_files (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Certificados emitidos (histórico e validação pelo QR Code)
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  registration TEXT,
  category TEXT,
  model TEXT,
  event_date TEXT,
  data TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificates_issued ON certificates(issued_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
