// Teste de ponta a ponta: rode `npm run dev` (com .dev.vars) e depois `npm run test:e2e`.
// Usa um banco local; cria certificados e um modelo de teste.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';

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

const ADMIN = { name: 'Admin Teste', email: 'admin@gelb.test', pass: 'senha-admin-123' };

// Primeiro acesso: cria o administrador com a chave de instalação
await page.goto(BASE);
await page.waitForSelector('#setup-form:not([hidden])');
check(true, 'banco zerado abre o primeiro acesso');
await page.fill('#setup-key', 'chave-errada');
await page.fill('#setup-name', ADMIN.name);
await page.fill('#setup-email', ADMIN.email);
await page.fill('#setup-pass', ADMIN.pass);
await page.fill('#setup-pass2', ADMIN.pass);
await page.click('#setup-form button[type=submit]');
await page.waitForSelector('#login-error:not([hidden])');
check((await page.textContent('#login-error')).includes('incorreta'), 'chave de instalação errada é recusada');
await page.fill('#setup-key', PASS);
await page.click('#setup-form button[type=submit]');
await page.waitForSelector('#app:not([hidden])');
check((await page.textContent('#who-name')) === ADMIN.name && !(await page.locator('#tab-btn-usuarios').isHidden()), 'administrador criado e logado (vê "Usuários")');

// Sair e entrar de novo por e-mail e senha
await page.click('.who [data-logout]');
await page.waitForSelector('#login-form:not([hidden])');
await page.fill('#login-email', ADMIN.email);
await page.fill('#login-pass', 'errada');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#login-error:not([hidden])');
check((await page.textContent('#login-error')).includes('incorretos'), 'senha errada é recusada');
await page.fill('#login-pass', ADMIN.pass);
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#app:not([hidden])');
check(true, 'login com e-mail e senha');

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
await page.locator('#tab-emitir .preview-card').screenshot({ path: `${OUT}/02-padrao-especialidade.png` });
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

// Montar impressão: blocos com certificados diferentes, 4 por folha
await page.click('[data-tab=lote]');
await page.waitForSelector('.block');
await page.selectOption('.block[data-b="0"] [data-k=category]', 'Progressão');
await page.click('.block[data-b="0"] [data-act=paste-open]');
await page.fill('.block[data-b="0"] [data-paste]', 'Ana Paula, Ailson Luiz e Liene Maria\nBruno Lima; Raul e Regina; 222222-2\nCarla Dias');
await page.click('.block[data-b="0"] [data-act=paste-add]');
check((await page.locator('.block[data-b="0"] tbody tr').count()) === 3, 'lista colada vira 3 linhas');
await page.click('#block-add');
await page.selectOption('.block[data-b="1"] [data-k=model]', 'Progressão Lobinho');
await page.fill('.block[data-b="1"] tbody tr:first-child [data-rk=name]', 'Amanda Samagaia');
await page.fill('.block[data-b="1"] tbody tr:first-child [data-rk=responsaveis]', 'Jeferson e Gisele');
await page.click('#block-add');
await page.selectOption('.block[data-b="2"] [data-k=category]', 'Especialidades');
await page.fill('.block[data-b="2"] [data-k=nomeEspecialidade]', 'Radioamadorismo');
await page.fill('.block[data-b="2"] tbody tr:first-child [data-rk=name]', 'João Samagaia');
check((await page.locator('.block[data-b="2"] [data-rk=responsaveis]').count()) === 0, 'especialidade não pede responsáveis');
await page.waitForTimeout(300);
check((await page.textContent('#batch-count')).includes('5 certificados em 2 folhas'), 'conta 5 certificados em 2 folhas');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/04-montar.png`, fullPage: true });
await page.locator('#sheet-canvas').screenshot({ path: `${OUT}/04b-folha1.png` });
const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#batch-pdf')]);
await dl3.saveAs(`${OUT}/montagem.pdf`);
const pdfPages = (readFileSync(`${OUT}/montagem.pdf`, 'latin1').match(/\/Type \/Page[^s]/g) || []).length;
check(pdfPages === 2, `PDF da montagem com ${pdfPages} folhas (4 + 1)`);
const lote = await page.evaluate(() => fetch('/api/certificates').then((r) => r.json()));
const by = (n) => lote.find((c) => c.recipient === n)?.data || {};
check(by('Ana Paula').responsaveis === 'Ailson Luiz e Liene Maria' && !by('Ana Paula').recipientRegistration, 'responsáveis da linha (sem registro)');
check(by('Bruno Lima').responsaveis === 'Raul e Regina' && by('Bruno Lima').recipientRegistration === '222222-2', 'responsáveis e registro em qualquer ordem');
check(!by('Carla Dias').responsaveis, 'linha sem responsáveis fica em branco');
check(by('Amanda Samagaia').model === 'Progressão Lobinho' && by('Amanda Samagaia').responsaveis === 'Jeferson e Gisele', 'bloco 2: Progressão Lobinho com responsáveis');
check(!by('Amanda Samagaia').progressionStage && by('Ana Paula').progressionStage === 'Acolhida dos Filhotes', 'etapa da Acolhida não passa para o bloco da Progressão Lobinho');
check(by('João Samagaia').category === 'Especialidades' && by('João Samagaia').nomeEspecialidade === 'Radioamadorismo', 'bloco 3: especialidade');
// imprimir de novo não duplica o histórico
const [dl4] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#batch-pdf')]);
await dl4.path();
const again = await page.evaluate(() => fetch('/api/certificates').then((r) => r.json()));
check(again.length === lote.length, 'baixar de novo não duplica os emitidos');
// rascunho sobrevive a recarregar a página
await page.reload();
await page.waitForSelector('#app:not([hidden])');
await page.click('[data-tab=lote]');
check((await page.locator('.block').count()) === 3, 'montagem continua depois de recarregar');

// Emitidos
await page.click('[data-tab=emitidos]');
await page.waitForSelector('.hcard');
const n = await page.locator('.hcard').count();
check(n >= 7, `histórico mostra ${n} certificados`);
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
await page.locator('#tab-emitir .preview-card').screenshot({ path: `${OUT}/08-modelo-enviado.png` });
check((await page.textContent('.design.active')).includes('Promessa'), 'emissão usa o modelo enviado');
// Mesmo sem estar marcada como padrão (ex.: o padrão foi excluído), a arte enviada vem selecionada
await page.evaluate((id) => fetch('/api/templates/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isDefault: false }) }), promessa.id);
await page.reload();
await page.waitForSelector('#app:not([hidden])');
await page.click('[data-cat="Promessas"]');
await page.click('[data-model="Promessa (Geral)"]');
await page.waitForTimeout(300);
check((await page.textContent('.design.active')).includes('Promessa'), 'arte enviada vem selecionada por padrão');
const tplAfter = await page.evaluate(() => fetch('/api/templates').then((r) => r.json()));
check(tplAfter.find((t) => t.id === promessa.id).isDefault, 'servidor volta a marcar a arte como padrão');

// Configurações salvas
await page.click('[data-tab=config]');
await page.fill('#s-groupName', 'Grupo Escoteiro Leões de Blumenau - GELB 32/SC');
check((await page.getAttribute('.topbar .brand-logo', 'src')).startsWith('/api/logo'), 'logo do topo vem da configuração');

// Logo do grupo: a enviada passa a aparecer no topo e na tela de entrada
const logoPng = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#c62828';
  x.beginPath();
  x.arc(100, 100, 90, 0, Math.PI * 2);
  x.fill();
  return c.toDataURL('image/png').split(',')[1];
});
await page.setInputFiles('[data-logo=logoLeft]', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logoPng, 'base64') });

// Letras: fonte enviada, cor e transparência
const FONT = process.env.FONT_FILE || '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf';
if (existsSync(FONT)) {
  await page.setInputFiles('#font-file', FONT);
  await page.fill('#font-name', 'Letra Teste');
  await page.click('#font-save');
  await page.waitForSelector('#font-status:has-text("enviada")');
  check((await page.locator('.font-item').count()) === 1, 'fonte enviada aparece na lista');
  await page.selectOption('[data-role=nome] select', "'Letra Teste', sans-serif");
} else console.log('(sem arquivo de fonte para testar o envio)');
await page.locator('[data-role=nome] input[type=color]').fill('#c62828');
await page.locator('[data-role=texto] input[type=range]').fill('60');
await page.waitForTimeout(600);
await page.locator('.type-grid').screenshot({ path: `${OUT}/10-letras.png` });

await page.click('#save-settings');
await page.waitForSelector('#settings-status:has-text("salvas")');
check(true, 'configurações salvas');
const saved = await page.evaluate(() => fetch('/api/settings').then((r) => r.json()));
check(saved.typography?.nome?.color === '#c62828' && saved.typography?.texto?.opacity === 40, 'cor e transparência salvas');
const logoRes = await page.evaluate(() => fetch('/api/logo').then((r) => r.headers.get('content-type')));
check(logoRes === 'image/png', 'logo enviada é servida em /api/logo');

// Usuários: administrador cria o acesso; a pessoa entra com a senha provisória e cria a dela
await page.click('[data-tab=usuarios]');
await page.waitForSelector('.user-row');
await page.click('#user-new');
await page.fill('#user-name', 'Maria Diretoria');
await page.fill('#user-email', 'Maria@GELB.test');
await page.click('#user-save');
await page.waitForSelector('#user-access:not([hidden])');
const temp = (await page.textContent('.temp-pass')).trim();
check(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(temp), `senha provisória gerada (${temp})`);
check((await page.inputValue('#user-access textarea')).includes(temp), 'mensagem pronta para enviar traz a senha');
await page.screenshot({ path: `${OUT}/12-usuarios.png`, fullPage: true });

const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const maria = await ctx2.newPage();
maria.on('pageerror', (e) => errors.push('maria: ' + e.message));
await maria.goto(BASE);
await maria.fill('#login-email', 'maria@gelb.test');
await maria.fill('#login-pass', temp);
await maria.click('#login-form button[type=submit]');
await maria.waitForSelector('#change-form:not([hidden])');
check(true, 'senha provisória pede para criar a senha');
const blocked = await maria.evaluate(() => fetch('/api/settings').then((r) => r.status));
check(blocked === 403, 'antes de criar a senha, o sistema fica bloqueado');
await maria.fill('#change-pass', temp);
await maria.fill('#change-pass2', temp);
await maria.click('#change-form button[type=submit]');
await maria.waitForSelector('#login-error:not([hidden])');
check((await maria.textContent('#login-error')).includes('diferente'), 'não aceita repetir a senha provisória');
await maria.fill('#change-pass', 'senha-da-maria');
await maria.fill('#change-pass2', 'senha-da-maria');
await maria.click('#change-form button[type=submit]');
await maria.waitForSelector('#app:not([hidden])');
check(await maria.locator('#tab-btn-usuarios').isHidden(), 'usuário comum não vê "Usuários"');
const usersApi = await maria.evaluate(() => fetch('/api/users').then((r) => r.status));
check(usersApi === 403, 'usuário comum não acessa a gestão pela API');
await maria.waitForSelector('.design.active');
await maria.fill('#f-recipientName', 'Lucas da Maria');
const [dlm] = await Promise.all([maria.waitForEvent('download'), maria.click('[data-emit=png]')]);
await dlm.path();

await page.click('[data-tab=emitidos]');
await page.waitForSelector('.hcard');
await page.fill('#history-search', '');
await page.waitForTimeout(600);
await page.selectOption('#history-by', { label: 'Emitidos por Maria Diretoria (1)' });
await page.waitForFunction(() => document.querySelectorAll('.hcard').length === 1 && document.querySelector('#history-list').textContent.includes('Lucas da Maria'), null, { timeout: 10000 }).catch(() => null);
const cards = await page.locator('.hcard').allTextContents();
check(cards.length === 1 && cards[0].includes('Lucas da Maria') && cards[0].includes('Emitido por Maria Diretoria'), 'Emitidos mostra e filtra quem emitiu');

await page.click('[data-tab=usuarios]');
await page.waitForFunction(() => document.querySelector('#audit-list').textContent.includes('Trocou a própria senha'), null, { timeout: 10000 }).catch(() => null);
const auditText = await page.textContent('#audit-list');
check(auditText.includes('Criou usuário') && auditText.includes('Maria Diretoria') && auditText.includes('Trocou a própria senha'), 'histórico de alterações registra as ações');
const mariaRow = page.locator('.user-row', { hasText: 'Maria Diretoria' });
check((await mariaRow.textContent()).includes('Último acesso') && !(await mariaRow.textContent()).includes('nunca entrou'), 'lista mostra o último acesso');
await mariaRow.locator('[data-u-act=off]').click();
await page.click('#confirm-yes');
await page.waitForSelector('.user-row.off');
check(true, 'administrador desativa o acesso');
await maria.click('[data-tab=emitidos]');
await maria.waitForSelector('#login-form:not([hidden])');
check(true, 'quem foi desativado sai do sistema na hora');
await maria.fill('#login-email', 'maria@gelb.test');
await maria.fill('#login-pass', 'senha-da-maria');
await maria.click('#login-form button[type=submit]');
await maria.waitForFunction(() => document.querySelector('#login-error').textContent.includes('desativado'), null, { timeout: 10000 }).catch(() => null);
check((await maria.textContent('#login-error')).includes('desativado'), 'login de desativado avisa para falar com o administrador');
const selfOff = await page.evaluate(async (id) => (await fetch('/api/users/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }) })).status, (await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).user.id);
check(selfOff === 400, 'administrador não consegue desativar a si mesmo');
await page.screenshot({ path: `${OUT}/13-usuarios-historico.png`, fullPage: true });

// Celular
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.context().addCookies(await ctx.cookies());
await m.goto(BASE);
await m.waitForSelector('#app:not([hidden])');
await m.waitForTimeout(800);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, 'sem rolagem lateral no celular');
const anon = await browser.newPage();
await anon.goto(BASE);
await anon.waitForSelector('#login:not([hidden])');
const loginLogoOk = await anon.evaluate(() => {
  const img = document.querySelector('#login .brand-logo');
  return img.complete && img.naturalWidth === 200;
});
check(loginLogoOk, 'tela de entrada mostra a logo enviada');
await anon.screenshot({ path: `${OUT}/11-entrada.png` });
await m.screenshot({ path: `${OUT}/09-celular.png`, fullPage: true });

// Recuperação: administrador que esqueceu a senha entra com a chave de instalação e cria outra
const ctx3 = await browser.newContext();
const rec = await ctx3.newPage();
await rec.goto(BASE);
await rec.fill('#login-email', ADMIN.email);
await rec.fill('#login-pass', PASS);
await rec.click('#login-form button[type=submit]');
await rec.waitForSelector('#change-form:not([hidden])');
check(true, 'chave de instalação recupera o acesso do administrador');
const userKey = await ctx3.request.post(`${BASE}/api/login`, { data: { email: 'maria@gelb.test', password: PASS } });
check(userKey.status() === 401, 'chave de instalação não serve para usuário comum');

check(errors.length === 0, `sem erros de JavaScript${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
