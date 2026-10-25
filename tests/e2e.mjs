// Teste de ponta a ponta: rode `npm run dev` (com .dev.vars) e depois `npm run test:e2e`.
// Usa um banco local; cria certificados e um modelo de teste.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const PASS = process.env.APP_PASSWORD || 'diretoria-teste';
const OUT = process.env.OUT_DIR || 'tests/out';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE);
await page.fill('#login-pass', 'errada');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#login-error:not([hidden])');
check((await page.textContent('#login-error')).includes('incorreta'), 'senha errada é recusada');

await page.fill('#login-pass', PASS);
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#app:not([hidden])');
check(true, 'login com a senha da diretoria');

// Acolhida usa o modelo padrão embutido automaticamente
await page.waitForSelector('.design.active');
check((await page.textContent('.design.active')).includes('Acolhida'), 'Acolhida abre com o modelo de arte padrão');

await page.fill('#f-recipientName', 'Gabriel Schmidt Silva');
await page.fill('[data-field=responsaveis]', 'Carlos Silva e Maria Schmidt');
await page.fill('#f-date', '2026-08-25');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-emitir-acolhida.png`, fullPage: true });

// Emitir PDF
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-emit=pdf]')]);
await dl.saveAs(`${OUT}/acolhida.pdf`);
check(dl.suggestedFilename().endsWith('.pdf'), `PDF baixado (${dl.suggestedFilename()})`);
await page.waitForSelector('#emit-status:has-text("Registrado")');
const code = (await page.textContent('#cert-code')).trim();
check(/^GELB-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code), `código gerado ${code}`);

// Trocar a pessoa gera um novo código (não sobrescreve o anterior)
await page.fill('#f-recipientName', 'Mariana Souza');
await page.waitForTimeout(200);
check((await page.textContent('#cert-code')).trim() !== code, 'nova pessoa recebe novo código');

// Layout padrão GELB + categoria Especialidades
await page.click('[data-cat="Especialidades"]');
await page.click('[data-design="padrao"]');
await page.fill('[data-field=nomeEspecialidade]', 'Radioamadorismo');
await page.selectOption('[data-field=nivelConquistado]', '2');
await page.waitForTimeout(600);
await page.locator('.preview-card').screenshot({ path: `${OUT}/02-padrao-especialidade.png` });
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-emit=png]')]);
check(dl2.suggestedFilename().endsWith('.png'), 'PNG baixado');

// Validação pública
const vpage = await ctx.newPage();
await vpage.goto(`${BASE}/validar/?c=${code}`);
await vpage.waitForSelector('.result');
check((await vpage.textContent('.result')).includes('Gabriel Schmidt Silva'), 'QR Code: certificado verdadeiro é confirmado');
await vpage.screenshot({ path: `${OUT}/03-validar.png`, fullPage: true });
await vpage.goto(`${BASE}/validar/?c=GELB-0000-0000-0000`);
await vpage.waitForSelector('.result');
check((await vpage.textContent('.result')).includes('não encontrado'), 'código inexistente é recusado');
await vpage.close();

// Lote
await page.click('[data-tab=lote]');
await page.fill('#batch-text', 'Ana Paula, 111111-1\nBruno Lima; 222222-2\nCarla Dias');
check((await page.textContent('#batch-count')).includes('3 certificados'), 'lote conta 3 nomes');
const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#batch-pdf')]);
await dl3.saveAs(`${OUT}/lote.pdf`);
check(dl3.suggestedFilename().endsWith('.pdf'), 'PDF do lote baixado');
await page.screenshot({ path: `${OUT}/04-lote.png`, fullPage: true });

// Emitidos
await page.click('[data-tab=emitidos]');
await page.waitForSelector('.hcard');
const n = await page.locator('.hcard').count();
check(n >= 5, `histórico mostra ${n} certificados`);
await page.fill('#history-search', 'Bruno');
await page.waitForTimeout(600);
check((await page.locator('.hcard').count()) >= 1 && (await page.locator('.hcard h3').allTextContents()).every((t) => t.includes('Bruno')), 'busca no histórico');
await page.screenshot({ path: `${OUT}/05-emitidos.png`, fullPage: true });

// Configurações: enviar modelo (imagem gerada na hora)
await page.click('[data-tab=config]');
const png = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1131;
  const x = c.getContext('2d');
  x.fillStyle = '#fff8e1';
  x.fillRect(0, 0, 1600, 1131);
  x.strokeStyle = '#2e7d32';
  x.lineWidth = 30;
  x.strokeRect(30, 30, 1540, 1071);
  x.fillStyle = '#2e7d32';
  x.font = 'bold 80px serif';
  x.textAlign = 'center';
  x.fillText('PROMESSA ESCOTEIRA', 800, 260);
  return c.toDataURL('image/png').split(',')[1];
});
await page.click('#tpl-new');
await page.setInputFiles('#tpl-file', { name: 'promessa-geral.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await page.selectOption('#tpl-category', 'Promessas');
await page.selectOption('#tpl-model', 'Promessa (Geral)');
await page.click('#tpl-save');
await page.waitForSelector('#layout-editor[open]');
check(true, 'modelo enviado e editor de posições aberto');
// arrastar o nome para cima
const box = page.locator('.le-box[data-k=nome]');
const b = await box.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 60, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/06-editor.png` });
await page.click('#le-save');
await page.waitForSelector('#layout-editor', { state: 'hidden' });
const tpls = await page.evaluate(() => fetch('/api/templates').then((r) => r.json()));
const promessa = tpls.find((t) => t.model === 'Promessa (Geral)');
check(promessa && promessa.layout.fields.nome.y < 52, `posição do nome salva (y=${promessa && promessa.layout.fields.nome.y})`);
await page.screenshot({ path: `${OUT}/07-config.png`, fullPage: true });

// Usar o modelo enviado
await page.click(`[data-tpl-use="${promessa.id}"]`);
await page.fill('#f-recipientName', 'Pedro Henrique');
await page.waitForTimeout(800);
await page.locator('.preview-card').screenshot({ path: `${OUT}/08-modelo-enviado.png` });
check((await page.textContent('.design.active')).includes('Promessa'), 'emissão usa o modelo enviado');

// Configurações salvas
await page.click('[data-tab=config]');
await page.fill('#s-groupName', 'Grupo Escoteiro Leões de Blumenau - GELB 32/SC');
await page.click('#save-settings');
await page.waitForSelector('#settings-status:has-text("salvas")');
check(true, 'configurações salvas');

// Celular
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.context().addCookies(await ctx.cookies());
await m.goto(BASE);
await m.waitForSelector('#app:not([hidden])');
await m.waitForTimeout(800);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, 'sem rolagem lateral no celular');
await m.screenshot({ path: `${OUT}/09-celular.png`, fullPage: true });

check(errors.length === 0, `sem erros de JavaScript${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
