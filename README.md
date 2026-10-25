# Gerador de Certificados — GELB 32/SC

Versão simplificada do gerador de certificados do **Grupo Escoteiro Leões de Blumenau**, feita para a
diretoria imprimir certificados sem precisar de treinamento. Endereço previsto:
**https://gerador-certificados.geleoesdeblumenau.com.br**

Repositório `editoranpe/Gerador-Certificados-GELB`, Worker `gerador-certificados`, separado do site da Editora NPE.
O app antigo do AI Studio fica guardado na branch `ai-studio-original`.

## Como a diretoria usa

1. **Emitir certificado** — 4 passos na mesma tela, com a prévia ao lado:
   1. escolha a categoria e o modelo (ex.: *Progressão › Acolhida*);
   2. escolha a aparência (layout padrão GELB ou uma arte própria do modelo);
   3. preencha nome, data e o que mais for pedido (os campos mudam conforme o modelo);
   4. **Imprimir**, **Baixar PDF** (A4 ou A5) ou **Baixar imagem**.
   Ao imprimir/baixar, o certificado fica registrado em *Emitidos* com um código `GELB-XXXX-XXXX-XXXX`.
2. **Vários de uma vez** — cole uma lista de nomes (um por linha; pode vir de planilha) e gere um único PDF
   ou imprima todos de uma vez, usando as escolhas feitas na aba *Emitir*.
3. **Emitidos** — busca, reabre para reimprimir, baixa o PDF de novo ou exclui.
4. **Configurações** — nome do grupo, cidade, logos, quem assina (com imagem da assinatura) e
   **modelos com arte própria**: envie um PDF/imagem, diga onde vai cada informação arrastando os quadros, e pronto.

Qualquer pessoa pode conferir um certificado em **/validar** (é para lá que o QR Code aponta).

## O que mudou em relação ao app do AI Studio

Todas as funções do original continuam, com menos passos:

| No original | Aqui |
|---|---|
| 9 categorias e 37 modelos, campos por categoria | Iguais, mais a categoria **Eventos e Cursos** (participação, conclusão, honra ao mérito — antes escondidos no código) |
| Layout padrão com 4 molduras, marca-d'água, logos, emblemas | Igual |
| Modelo em PDF com "modo especialista"/"modo diploma" e ~30 controles deslizantes | Um editor visual: **arrasta** cada informação para o lugar; posições ficam salvas **no modelo** (calibra uma vez só) |
| Modelo "Acolhida dos Filhotes" embutido | Igual (pode ser excluído e restaurado) |
| PDF A4/A5, PNG, impressão | Igual — e a impressão sai idêntica ao PDF (antes dependia do navegador redesenhar a página) |
| Lote: baixava um PDF por pessoa (e baixava sempre o mesmo certificado, por um erro) | Um PDF único com todos ou "imprimir todos" |
| Histórico só no navegador de quem emitiu | Histórico no servidor, igual para toda a diretoria |
| Validação aceitava qualquer código começando com `GELB-` | Validação real pelo banco + **QR Code no certificado** |
| Login Google + Firebase + Gemini | Uma senha da diretoria; sem Firebase, sem IA |
| Configuração de fontes globais (não tinha efeito no certificado) | Escolha de letra e cor por modelo, no editor de posições |

O campo "Seção/Ramo" do lote do original não aparecia em lugar nenhum do certificado; no lote, a 3ª coluna agora
é **responsáveis** (útil na Acolhida).

## Tecnologia

Cloudflare Workers (Hono) + D1. O certificado é desenhado no navegador num `<canvas>` (`public/js/render.js`),
e a mesma imagem vira prévia, PDF (jsPDF), PNG e impressão. Bibliotecas ficam em `public/vendor/`
(jsPDF, pdf.js e qrcode-generator), sem depender de CDN.

```
src/index.ts          API: login, configurações, modelos, emitidos e validação
public/index.html     o app
public/js/data.js     categorias, modelos, textos automáticos e posições padrão
public/js/render.js   desenho do certificado
public/js/app.js      telas
public/validar/       página pública de conferência
```

## Publicar (uma vez)

O banco D1 **`gelb-certificados-db`** já foi criado na conta Cloudflare (id no `wrangler.toml`).
As tabelas são criadas sozinhas pelo Worker no primeiro acesso.

1. **Cloudflare → Workers & Pages → Create → Import a repository** e escolha `editoranpe/Gerador-Certificados-GELB`.
   - Root directory: (em branco)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Branch: `main`
2. Em **Settings → Variables and Secrets** do Worker `gerador-certificados`, crie os segredos:
   - `APP_PASSWORD` — a senha da diretoria;
   - `SESSION_SECRET` — um texto aleatório com 32+ caracteres.
   (ou pelo terminal: `npx wrangler secret put APP_PASSWORD` e `npx wrangler secret put SESSION_SECRET`)
3. **Subdomínio:** `gerador-certificados.geleoesdeblumenau.com.br` já está declarado no `wrangler.toml`
   (`custom_domain = true`) e é ligado a cada deploy. Isso exige que o domínio `geleoesdeblumenau.com.br`
   esteja com o DNS na Cloudflare (plano gratuito serve). Se o DNS estiver em outro provedor (ex.: hospedagem do WordPress),
   é preciso primeiro mudar os nameservers do domínio para a Cloudflare — o site WordPress continua funcionando igual.
   Enquanto isso, o app já funciona no endereço `*.workers.dev` que a Cloudflare mostrar.

## Desenvolver e testar

```bash
npm install
printf 'APP_PASSWORD=diretoria-teste\nSESSION_SECRET=desenvolvimento-local-0123456789abcdef\n' > .dev.vars
npm run dev          # http://localhost:8787
npm run build        # checagem de tipos
npm run test:e2e     # com o dev rodando sobre banco local zerado (apague .wrangler/state)
```
