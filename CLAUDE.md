# Certificados GELB — instruções para o Claude

## Deploy
- O Worker `gerador-certificados` é publicado pelo Cloudflare Workers Builds a partir da branch `main` deste repositório (diretório raiz em branco).
- Endereço: https://gerador-certificados.geleoesdeblumenau.com.br (domínio personalizado declarado no `wrangler.toml`).
- Ao concluir cada parte do trabalho (com `npm run build` passando), envie para a `main` além da branch de trabalho.
- Banco D1 de produção: `gelb-certificados-db` (id no `wrangler.toml`). O esquema é criado/atualizado pelo próprio Worker (`ensureSchema` em `src/index.ts`) e deve continuar idempotente.
- O app antigo do AI Studio (React/Firebase) está guardado na branch `ai-studio-original`, só para consulta.
- Segredos: `APP_PASSWORD` (senha da diretoria) e `SESSION_SECRET` (32+ caracteres).

## Projeto
- Cloudflare Workers + Hono (só API em `src/index.ts`), D1, app em HTML/JS puro em `public/`.
- O certificado é desenhado em `<canvas>` por `public/js/render.js`; prévia, PDF, PNG e impressão usam o mesmo desenho.
- Testes: `npm run build` (tipos) e `npm run test:e2e` com `npm run dev` rodando sobre banco local zerado.
- Público-alvo: diretoria leiga — manter a interface simples, em passos, sem jargão.
- Textos e comunicação em português do Brasil.
