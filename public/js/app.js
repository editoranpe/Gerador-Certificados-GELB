/* Gerador de Certificados GELB 32/SC — interface. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const state = {
    settings: { ...GELBRender.DEFAULT_SETTINGS },
    templates: [],
    fonts: [], // fontes enviadas pela diretoria
    cert: null,
    emitted: false, // o certificado atual já foi impresso/baixado (registrado)
    history: [],
  };

  // ------------------------------------------------------------ API

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !['/api/me', '/api/login', '/api/setup'].includes(path)) {
      showLogin('Sua sessão terminou. Entre de novo.');
      throw new Error('Faça login novamente.');
    }
    if (res.status === 403 && data.mustChange) {
      showChange();
      throw new Error(data.message);
    }
    if (!res.ok) throw new Error(data.message || 'Não foi possível concluir. Verifique a internet e tente de novo.');
    return data;
  }

  // ------------------------------------------------------------ certificado atual

  function newCode() {
    const b = crypto.getRandomValues(new Uint8Array(6));
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `GELB-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  }

  function newId() {
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function blankCert(base) {
    const cert = {
      id: newId(),
      code: newCode(),
      category: 'Progressão',
      model: 'Acolhida',
      design: 'auto',
      borderStyle: 'classic-gelb',
      showWatermark: true,
      showQr: true,
      recipientName: '',
      recipientRegistration: '',
      city: state.settings.city || 'Blumenau - SC',
      date: todayIso(),
      signers: (state.settings.signatories || []).filter((s) => s.enabled).map((s) => s.id),
      nivelConquistado: '1',
    };
    if (base) {
      // "Começar outro": mantém tipo, aparência, data, cidade e assinaturas.
      for (const k of ['category', 'model', 'design', 'borderStyle', 'showWatermark', 'showQr', 'city', 'date', 'signers', 'eventName', 'workloadHours', 'startDate', 'endDate', 'progressionStage', 'nomeEspecialidade', 'nivelConquistado', 'ramo']) {
        if (base[k] !== undefined) cert[k] = base[k];
      }
    }
    return cert;
  }

  function visibleTemplates() {
    return state.templates.filter((t) => !t.hidden);
  }

  function templatesFor(cert) {
    return visibleTemplates().filter((t) => t.category === cert.category && t.model === cert.model);
  }

  /** Modelo de arte em uso (ou null = layout padrão GELB). */
  function currentTemplate(cert = state.cert) {
    if (cert.design === 'padrao') return null;
    const list = templatesFor(cert);
    if (cert.design && cert.design !== 'auto') {
      const t = visibleTemplates().find((x) => x.id === cert.design);
      if (t) return t;
    }
    return list.find((t) => t.isDefault) || null;
  }

  function verifyUrl(code) {
    return `${location.origin}/validar/?c=${encodeURIComponent(code)}`;
  }

  function renderEnv(cert, preview) {
    return { settings: state.settings, template: currentTemplate(cert), preview, qrUrl: verifyUrl(cert.code) };
  }

  // ------------------------------------------------------------ pré-visualização

  let previewSeq = 0;
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreview, 120);
  }

  async function drawPreview() {
    const seq = ++previewSeq;
    const off = document.createElement('canvas');
    await GELBRender.draw(off, state.cert, renderEnv(state.cert, true), 1.4);
    if (seq !== previewSeq) return;
    const target = $('#preview-canvas');
    target.width = off.width;
    target.height = off.height;
    target.getContext('2d').drawImage(off, 0, 0);
    $('#cert-code').textContent = state.cert.code;
  }

  // ------------------------------------------------------------ formulário "Emitir"

  function renderCategoryChips() {
    $('#category-chips').innerHTML = Object.keys(GELB.CATEGORIES)
      .map((c) => `<button type="button" data-cat="${esc(c)}" class="${c === state.cert.category ? 'active' : ''}">${esc(c)}</button>`)
      .join('');
    $('#model-buttons').innerHTML = (GELB.CATEGORIES[state.cert.category] || [])
      .map((m) => `<button type="button" data-model="${esc(m)}" class="${m === state.cert.model ? 'active' : ''}">${esc(m)}</button>`)
      .join('');
  }

  function renderDesigns() {
    const list = templatesFor(state.cert);
    const current = currentTemplate();
    const opts = [{ id: 'padrao', name: 'Layout padrão GELB' }, ...list.map((t) => ({ id: t.id, name: t.name, tpl: t }))];
    $('#design-options').innerHTML = opts
      .map(
        (o) => `<button type="button" class="design ${(current ? current.id : 'padrao') === o.id ? 'active' : ''}" data-design="${esc(o.id)}">
          <canvas data-thumb="${esc(o.id)}" width="280" height="198"></canvas>${esc(o.name)}</button>`,
      )
      .join('');
    // miniaturas
    for (const o of opts) {
      const c = $(`canvas[data-thumb="${CSS.escape(o.id)}"]`);
      const sample = { ...state.cert, design: o.id };
      GELBRender.draw(c, sample, { settings: state.settings, template: o.tpl || null, preview: true, qrUrl: '' }, 0.25);
    }
    $('#standard-options').hidden = !!current;
    $('#template-hint').hidden = !current;
  }

  function renderExtraFields() {
    const keys = GELB.EXTRA_FIELDS[state.cert.category] || [];
    const html = keys
      .map((k) => {
        const def = GELB.FIELD_LABELS[k];
        const val = state.cert[k] ?? '';
        const wide = ['responsaveis', 'progressionStage', 'nomeEspecialidade', 'eventName'].includes(k) ? 'span-2' : '';
        if (def.options) {
          return `<label class="${wide}">${esc(def.label)}<select data-field="${k}">${def.options
            .map((o) => `<option value="${o}" ${String(val) === o ? 'selected' : ''}>Nível ${o}</option>`)
            .join('')}</select></label>`;
        }
        return `<label class="${wide}">${esc(def.label)}<input data-field="${k}" type="${def.type || 'text'}" ${def.type === 'number' ? 'min="0"' : ''} value="${esc(val)}" placeholder="${esc(def.placeholder || '')}" autocomplete="off"></label>`;
      })
      .join('');
    $('#extra-fields').innerHTML = html;
  }

  function renderSignerChecks() {
    const sigs = state.settings.signatories || [];
    $('#signer-checks').innerHTML = sigs.length
      ? sigs
          .map(
            (s) => `<label class="check"><input type="checkbox" data-signer="${esc(s.id)}" ${state.cert.signers.includes(s.id) ? 'checked' : ''}>
              ${esc(s.name)} <small>— ${esc(s.role)}</small></label>`,
          )
          .join('')
      : '<p class="hint">Nenhuma assinatura cadastrada.</p>';
  }

  function fillForm() {
    const c = state.cert;
    for (const el of $$('#tab-emitir [data-field]')) {
      const k = el.dataset.field;
      if (el.closest('#extra-fields')) continue;
      el.value = c[k] ?? '';
    }
    $('#f-customText').placeholder = GELB.autoText({ ...c, city: c.city || state.settings.city }, state.settings.groupName);
    $('#border-style').value = c.borderStyle || 'classic-gelb';
    $('#show-watermark').checked = c.showWatermark !== false;
    $('#show-qr').checked = c.showQr !== false;
    renderCategoryChips();
    renderDesigns();
    renderExtraFields();
    renderSignerChecks();
    updateEmitStatus();
    schedulePreview();
  }

  function updateEmitStatus() {
    const el = $('#emit-status');
    el.classList.remove('error');
    el.textContent = state.emitted ? `✓ Registrado em "Emitidos" com o código ${state.cert.code}.` : '';
  }

  function setField(k, v) {
    // Se o certificado já foi emitido e mudou a pessoa, vira um certificado novo (não sobrescreve o anterior).
    if (state.emitted && (k === 'recipientName' || k === 'recipientRegistration') && v !== state.cert[k]) {
      state.cert.id = newId();
      state.cert.code = newCode();
      state.emitted = false;
      updateEmitStatus();
    }
    state.cert[k] = v;
    if (k !== 'customText') $('#f-customText').placeholder = GELB.autoText({ ...state.cert, city: state.cert.city || state.settings.city }, state.settings.groupName);
    schedulePreview();
  }

  function bindEmit() {
    $('#tab-emitir').addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.field) setField(el.dataset.field, el.value);
    });
    $('#tab-emitir').addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.signer) {
        const id = el.dataset.signer;
        state.cert.signers = el.checked ? [...new Set([...state.cert.signers, id])] : state.cert.signers.filter((s) => s !== id);
        // mantém a ordem das configurações
        const order = (state.settings.signatories || []).map((s) => s.id);
        state.cert.signers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        schedulePreview();
      } else if (el.dataset.field && el.tagName === 'SELECT') setField(el.dataset.field, el.value);
    });
    $('#category-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      state.cert.category = b.dataset.cat;
      selectModel(GELB.CATEGORIES[b.dataset.cat][0]);
    });
    $('#model-buttons').addEventListener('click', (e) => {
      const b = e.target.closest('[data-model]');
      if (b) selectModel(b.dataset.model);
    });
    $('#design-options').addEventListener('click', (e) => {
      const b = e.target.closest('[data-design]');
      if (!b) return;
      state.cert.design = b.dataset.design;
      renderDesigns();
      schedulePreview();
    });
    $('#border-style').innerHTML = GELB.BORDERS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    $('#border-style').addEventListener('change', (e) => {
      state.cert.borderStyle = e.target.value;
      renderDesigns();
      schedulePreview();
    });
    $('#show-watermark').addEventListener('change', (e) => {
      state.cert.showWatermark = e.target.checked;
      schedulePreview();
    });
    $('#show-qr').addEventListener('change', (e) => {
      state.cert.showQr = e.target.checked;
      schedulePreview();
    });
    $('#open-layout-editor').addEventListener('click', () => {
      const t = currentTemplate();
      if (t) openLayoutEditor(t);
    });
    $$('[data-emit]').forEach((b) => b.addEventListener('click', () => emitSingle(b.dataset.emit, b)));
    $('#new-cert').addEventListener('click', () => {
      state.cert = blankCert(state.cert);
      state.emitted = false;
      fillForm();
      $('#f-recipientName').focus();
    });
  }

  function selectModel(model) {
    state.cert.model = model;
    resetModelFields(state.cert);
    fillForm();
  }

  /** Ao trocar de certificado, limpa o que era do anterior (etapa, especialidade, evento…). */
  const MODEL_FIELDS = ['progressionStage', 'nomeEspecialidade', 'itensCompletados', 'matilhaPatrulha', 'quantidadeAnos', 'quantidadeNovosMembros', 'eventName', 'workloadHours', 'startDate', 'endDate', 'customText'];
  function resetModelFields(c) {
    c.design = 'auto';
    for (const k of MODEL_FIELDS) c[k] = '';
    c.nivelConquistado = '1';
    c.ramo = GELB.ramoFromModel(c.model);
    if (c.model === 'Acolhida') c.progressionStage = 'Acolhida dos Filhotes';
  }

  // ------------------------------------------------------------ saída: imprimir, PDF, PNG

  const paper = () => ($('input[name=paper]:checked') || {}).value || 'a4';

  async function renderHighRes(cert, scale = 2.6) {
    const c = document.createElement('canvas');
    await GELBRender.draw(c, cert, renderEnv(cert, false), scale);
    return c;
  }

  function slug(s) {
    return (
      String(s || 'certificado')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'certificado'
    );
  }

  function certRecord(cert) {
    const t = currentTemplate(cert);
    return { ...cert, design: t ? t.id : 'padrao', templateName: t ? t.name : 'Layout padrão GELB' };
  }

  async function saveCertificates(list) {
    await api('/api/certificates', { method: 'POST', body: { certificates: list.map(certRecord) } });
  }

  async function printImages(urls, size) {
    const root = $('#print-root');
    const dims = size === 'a5' ? ['210mm', '148mm'] : ['297mm', '210mm'];
    $('#print-page-style').textContent = `@page { size: ${size === 'a5' ? 'A5' : 'A4'} landscape; margin: 0; } @media print { #print-root img { width: ${dims[0]}; height: ${dims[1]}; } html, body { margin: 0; } }`;
    root.innerHTML = urls.map((u) => `<img src="${u}" alt="">`).join('');
    await Promise.all($$('img', root).map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
    window.print();
    setTimeout(() => (root.innerHTML = ''), 1000);
  }

  function newPdf(size) {
    return new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: size, compress: true });
  }

  function addPage(pdf, canvas, first) {
    if (!first) pdf.addPage();
    const w = pdf.internal.pageSize.getWidth();
    const h = pdf.internal.pageSize.getHeight();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, w, h, undefined, 'FAST');
  }

  function download(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function emitSingle(kind, btn) {
    const cert = state.cert;
    const status = $('#emit-status');
    if (!cert.recipientName.trim()) {
      status.textContent = 'Digite o nome do jovem antes de imprimir ou baixar.';
      status.classList.add('error');
      $('#f-recipientName').focus();
      return;
    }
    const buttons = $$('[data-emit]');
    buttons.forEach((b) => (b.disabled = true));
    status.classList.remove('error');
    status.textContent = 'Preparando…';
    try {
      await saveCertificates([cert]);
      state.emitted = true;
      const canvas = await renderHighRes(cert);
      const name = `certificado-${slug(cert.recipientName)}`;
      if (kind === 'print') await printImages([canvas.toDataURL('image/png')], paper());
      else if (kind === 'pdf') {
        const pdf = newPdf(paper());
        addPage(pdf, canvas, true);
        pdf.save(`${name}-${paper().toUpperCase()}.pdf`);
      } else download(canvas.toDataURL('image/png'), `${name}.png`);
      updateEmitStatus();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // ------------------------------------------------------------ montar impressão (vários certificados, 4 por folha)

  const DRAFT_KEY = 'gelb_montagem';
  const PER_SHEET = 4;
  // Campos que valem para o bloco inteiro (o resto — nome, responsáveis, registro — é de cada jovem)
  const BLOCK_KEYS = ['category', 'model', 'design', 'borderStyle', 'showWatermark', 'showQr', 'city', 'date', 'signers',
    'progressionStage', 'nomeEspecialidade', 'nivelConquistado', 'itensCompletados', 'ramo', 'matilhaPatrulha', 'quantidadeAnos',
    'quantidadeNovosMembros', 'eventName', 'workloadHours', 'startDate', 'endDate'];

  let blocks = [];

  /** Lê uma lista colada: "Nome, responsáveis, registro" (colunas reconhecidas pelo conteúdo, em qualquer ordem). */
  function parseList(text) {
    const isRegistration = (p) => /\d/.test(p) && /^[\d.\-\/\s]+[A-Za-z]?$/.test(p);
    return String(text || '')
      .split('\n')
      .map((l) => l.split(/\t|;|,/).map((p) => p.trim()).filter(Boolean))
      .filter((parts) => parts.length)
      .map((parts) => {
        const rest = parts.slice(1);
        return newRow({ name: parts[0], registration: rest.find(isRegistration) || '', responsaveis: rest.filter((p) => !isRegistration(p)).join(', ') });
      });
  }

  function newRow(r = {}) {
    return { name: '', responsaveis: '', registration: '', ...r };
  }

  function blockFrom(src) {
    const b = { rows: [newRow()] };
    for (const k of BLOCK_KEYS) if (src[k] !== undefined) b[k] = Array.isArray(src[k]) ? [...src[k]] : src[k];
    return b;
  }

  const hasResponsaveis = (b) => (GELB.EXTRA_FIELDS[b.category] || []).includes('responsaveis');

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(blocks));
    } catch {
      /* sem armazenamento local: a montagem só não sobrevive a recarregar a página */
    }
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (Array.isArray(d) && d.length) return d;
    } catch {
      /* rascunho ilegível: começa do zero */
    }
    return null;
  }

  function ensureBlocks() {
    if (!blocks.length) blocks = loadDraft() || [blockFrom(state.cert)];
  }

  /** Certificado de um jovem: dados do bloco + os da linha. O código fica na linha (reimprimir não duplica). */
  function rowCert(b, r) {
    if (!r.code || (r.emittedName && r.emittedName !== r.name.trim())) {
      r.id = newId();
      r.code = newCode();
      r.emittedName = '';
    }
    const cert = { ...blankCert(), id: r.id, code: r.code };
    for (const k of BLOCK_KEYS) if (b[k] !== undefined) cert[k] = b[k];
    cert.recipientName = r.name.trim();
    cert.responsaveis = hasResponsaveis(b) ? r.responsaveis.trim() : '';
    cert.recipientRegistration = r.registration.trim();
    return cert;
  }

  function allCerts() {
    const out = [];
    blocks.forEach((b) => b.rows.forEach((r) => r.name.trim() && out.push({ b, r, cert: rowCert(b, r) })));
    return out;
  }

  const optionList = (list, value) => list.map((x) => `<option value="${esc(x)}" ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('');

  function renderBlocks() {
    ensureBlocks();
    $('#blocks').innerHTML = blocks
      .map((b, i) => {
        const t = currentTemplate(b);
        const designs = [['padrao', 'Layout padrão GELB'], ...templatesFor(b).map((x) => [x.id, x.name])];
        const extras = (GELB.EXTRA_FIELDS[b.category] || []).filter((k) => k !== 'responsaveis');
        const showResp = hasResponsaveis(b);
        return `<article class="block" data-b="${i}">
          <div class="block-head">
            <span class="num">${i + 1}</span>
            <strong>${esc(b.category)} › ${esc(b.model)}</strong>
            ${blocks.length > 1 ? '<button class="btn btn-ghost btn-sm" type="button" data-act="remove">Remover</button>' : ''}
          </div>
          <div class="form-grid">
            <label>Categoria<select data-k="category">${optionList(Object.keys(GELB.CATEGORIES), b.category)}</select></label>
            <label>Certificado<select data-k="model">${optionList(GELB.CATEGORIES[b.category] || [], b.model)}</select></label>
            <label class="${t ? 'span-2' : ''}">Aparência<select data-k="design">${designs.map(([v, l]) => `<option value="${esc(v)}" ${(t ? t.id : 'padrao') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            ${t ? '' : `<label>Moldura<select data-k="borderStyle">${GELB.BORDERS.map(([v, l]) => `<option value="${v}" ${b.borderStyle === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
            ${extras
              .map((k) => {
                const def = GELB.FIELD_LABELS[k];
                const val = b[k] ?? '';
                if (def.options) return `<label>${esc(def.label)}<select data-k="${k}">${def.options.map((o) => `<option value="${o}" ${String(val) === o ? 'selected' : ''}>Nível ${o}</option>`).join('')}</select></label>`;
                return `<label>${esc(def.label)}<input data-k="${k}" type="${def.type || 'text'}" value="${esc(val)}" placeholder="${esc(def.placeholder || '')}" autocomplete="off"></label>`;
              })
              .join('')}
            <label>Cidade<input data-k="city" value="${esc(b.city || '')}"></label>
            <label>Data<input data-k="date" type="date" value="${esc(b.date || '')}"></label>
          </div>
          <fieldset class="signers"><legend>Quem assina</legend>
            ${(state.settings.signatories || []).map((s) => `<label class="check"><input type="checkbox" data-signer="${esc(s.id)}" ${(b.signers || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)} <small>— ${esc(s.role)}</small></label>`).join('')}
          </fieldset>
          <label class="check"><input type="checkbox" data-k="showQr" ${b.showQr !== false ? 'checked' : ''}> QR Code de autenticidade</label>
          <table class="rows">
            <thead><tr><th>Nome do jovem</th>${showResp ? '<th>Responsáveis</th>' : ''}<th>Registro UEB (opcional)</th><th></th></tr></thead>
            <tbody>${b.rows
              .map(
                (r, j) => `<tr data-r="${j}">
                  <td><input data-rk="name" value="${esc(r.name)}" placeholder="Nome do jovem" aria-label="Nome do jovem" autocomplete="off"></td>
                  ${showResp ? `<td><input data-rk="responsaveis" value="${esc(r.responsaveis)}" placeholder="Ex.: José e Maria" aria-label="Responsáveis" autocomplete="off"></td>` : ''}
                  <td><input data-rk="registration" value="${esc(r.registration)}" placeholder="Registro UEB" aria-label="Registro UEB" autocomplete="off"></td>
                  <td class="del"><button type="button" data-act="row-del" title="Tirar esta linha" aria-label="Tirar esta linha">×</button></td>
                </tr>`,
              )
              .join('')}</tbody>
          </table>
          <div class="row-wrap">
            <button class="btn btn-ghost btn-sm" type="button" data-act="row-add">＋ Adicionar jovem</button>
            <button class="btn btn-ghost btn-sm" type="button" data-act="paste-open">Colar uma lista</button>
          </div>
          <div class="paste-area" hidden>
            <label>Cole um nome por linha${showResp ? ' — depois do nome, os responsáveis' : ''} e, se quiser, o registro UEB, separados por vírgula ou ponto e vírgula. Pode vir de uma planilha.
              <textarea rows="5" data-paste placeholder="João da Silva, José e Maria&#10;Joana da Silva, Juca e Rosa, 329182-1"></textarea>
            </label>
            <div><button class="btn btn-primary btn-sm" type="button" data-act="paste-add">Adicionar à lista</button></div>
          </div>
        </article>`;
      })
      .join('');
    updateMontarCount();
    scheduleSheetPreview();
  }

  function sheetsCount() {
    return Math.max(1, Math.ceil(allCerts().length / PER_SHEET));
  }

  function updateMontarCount() {
    const n = allCerts().length;
    const f = Math.ceil(n / PER_SHEET);
    $('#batch-count').textContent = n ? `${n} certificado${n > 1 ? 's' : ''} em ${f} folha${f > 1 ? 's' : ''} A4.` : 'Escreva o nome de pelo menos um jovem.';
    $('#batch-print').textContent = n ? `🖨️ Imprimir ${n}` : '🖨️ Imprimir';
  }

  // Folha A4 deitada com 2 × 2 certificados (proporção do certificado mantida) e margem para a impressora
  const SHEET = (() => {
    const pageW = 297;
    const pageH = 210;
    const gap = 6;
    const cellH = (pageH - 12 - gap) / 2;
    const cellW = (cellH * GELBRender.W) / GELBRender.H;
    return { pageW, pageH, gap, cellW, cellH, x0: (pageW - (cellW * 2 + gap)) / 2, y0: (pageH - (cellH * 2 + gap)) / 2 };
  })();

  async function composeSheet(certs, pxPerMm, preview) {
    const page = document.createElement('canvas');
    page.width = Math.round(SHEET.pageW * pxPerMm);
    page.height = Math.round(SHEET.pageH * pxPerMm);
    const ctx = page.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, page.width, page.height);
    const m = (v) => v * pxPerMm;
    const cell = (i) => [SHEET.x0 + (i % 2) * (SHEET.cellW + SHEET.gap), SHEET.y0 + Math.floor(i / 2) * (SHEET.cellH + SHEET.gap)];
    for (let i = 0; i < certs.length; i++) {
      const c = document.createElement('canvas');
      await GELBRender.draw(c, certs[i], renderEnv(certs[i], preview), m(SHEET.cellW) / GELBRender.W);
      const [x, y] = cell(i);
      ctx.drawImage(c, m(x), m(y), m(SHEET.cellW), m(SHEET.cellH));
    }
    // marcas de corte nos cantos de cada posição
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = Math.max(1, m(0.2));
    for (let i = 0; i < PER_SHEET; i++) {
      const [x, y] = cell(i);
      for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + SHEET.cellW, y, 1, -1], [x, y + SHEET.cellH, -1, 1], [x + SHEET.cellW, y + SHEET.cellH, 1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(m(cx + dx), m(cy));
        ctx.lineTo(m(cx + dx * 4), m(cy));
        ctx.moveTo(m(cx), m(cy + dy));
        ctx.lineTo(m(cx), m(cy + dy * 4));
        ctx.stroke();
      }
    }
    return page;
  }

  let sheetIndex = 0;
  let sheetSeq = 0;
  let sheetTimer = null;
  function scheduleSheetPreview() {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(drawSheetPreview, 250);
  }

  async function drawSheetPreview() {
    const seq = ++sheetSeq;
    const total = sheetsCount();
    sheetIndex = Math.min(sheetIndex, total - 1);
    $('#sheet-n').textContent = sheetIndex + 1;
    $('#sheet-total').textContent = total;
    $('#sheet-prev').disabled = sheetIndex === 0;
    $('#sheet-next').disabled = sheetIndex >= total - 1;
    const certs = allCerts().slice(sheetIndex * PER_SHEET, (sheetIndex + 1) * PER_SHEET).map((x) => x.cert);
    const page = await composeSheet(certs, 3.4, true);
    if (seq !== sheetSeq) return;
    const c = $('#sheet-canvas');
    c.width = page.width;
    c.height = page.height;
    c.getContext('2d').drawImage(page, 0, 0);
  }

  async function emitMontagem(kind) {
    const status = $('#batch-status');
    status.classList.remove('error');
    const items = allCerts();
    if (!items.length) {
      status.textContent = 'Escreva o nome de pelo menos um jovem.';
      status.classList.add('error');
      return;
    }
    const btns = [$('#batch-print'), $('#batch-pdf')];
    btns.forEach((b) => (b.disabled = true));
    const bar = $('#batch-progress');
    bar.hidden = false;
    try {
      status.textContent = 'Registrando os certificados…';
      const certs = items.map((x) => x.cert);
      await saveCertificates(certs);
      items.forEach((x) => (x.r.emittedName = x.r.name.trim()));
      saveDraft();
      const pdf = kind === 'pdf' ? newPdf('a4') : null;
      const urls = [];
      const sheets = Math.ceil(certs.length / PER_SHEET);
      for (let p = 0; p < sheets; p++) {
        status.textContent = `Montando a folha ${p + 1} de ${sheets}…`;
        bar.firstElementChild.style.width = `${((p + 1) / sheets) * 100}%`;
        const page = await composeSheet(certs.slice(p * PER_SHEET, (p + 1) * PER_SHEET), 11.81, false); // ~300 dpi
        if (pdf) addPage(pdf, page, p === 0);
        else urls.push(page.toDataURL('image/jpeg', 0.92));
      }
      if (pdf) pdf.save(`certificados-gelb-${todayIso()}.pdf`);
      else await printImages(urls, 'a4');
      status.textContent = `✓ ${certs.length} certificado(s) registrados em "Emitidos".`;
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    } finally {
      btns.forEach((b) => (b.disabled = false));
      setTimeout(() => (bar.hidden = true), 800);
    }
  }

  function bindMontar() {
    const box = $('#blocks');
    const changed = (structural) => {
      saveDraft();
      if (structural) renderBlocks();
      else {
        updateMontarCount();
        scheduleSheetPreview();
      }
    };
    box.addEventListener('input', (e) => {
      const el = e.target;
      const art = el.closest('.block');
      if (!art || el.matches('select, [type=checkbox], [data-paste]')) return;
      const b = blocks[art.dataset.b];
      if (el.dataset.rk) b.rows[el.closest('tr').dataset.r][el.dataset.rk] = el.value;
      else if (el.dataset.k) b[el.dataset.k] = el.value;
      changed(false);
    });
    box.addEventListener('change', (e) => {
      const el = e.target;
      const art = el.closest('.block');
      if (!art) return;
      const b = blocks[art.dataset.b];
      if (el.dataset.signer) {
        const order = (state.settings.signatories || []).map((s) => s.id);
        const set = new Set(b.signers || []);
        if (el.checked) set.add(el.dataset.signer);
        else set.delete(el.dataset.signer);
        b.signers = [...set].sort((x, y) => order.indexOf(x) - order.indexOf(y));
        return changed(false);
      }
      const k = el.dataset.k;
      if (k === 'showQr') {
        b.showQr = el.checked;
        return changed(false);
      }
      if (!k || el.tagName !== 'SELECT') return;
      b[k] = el.value;
      if (k === 'category') b.model = GELB.CATEGORIES[b.category][0];
        if (k === 'category' || k === 'model') resetModelFields(b);
      changed(['category', 'model', 'design'].includes(k));
    });
    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const art = btn.closest('.block');
      const i = Number(art.dataset.b);
      const b = blocks[i];
      const act = btn.dataset.act;
      if (act === 'remove') {
        if (b.rows.some((r) => r.name.trim()) && !(await confirmBox(`Remover o bloco "${b.model}" e os nomes dele?`, 'Sim, remover'))) return;
        blocks.splice(i, 1);
      } else if (act === 'row-add') b.rows.push(newRow());
      else if (act === 'row-del') {
        b.rows.splice(Number(btn.closest('tr').dataset.r), 1);
        if (!b.rows.length) b.rows.push(newRow());
      } else if (act === 'paste-open') {
        const area = $('.paste-area', art);
        area.hidden = !area.hidden;
        if (!area.hidden) $('textarea', area).focus();
        return;
      } else if (act === 'paste-add') {
        const rows = parseList($('[data-paste]', art).value);
        if (!rows.length) return;
        b.rows = b.rows.filter((r) => r.name.trim()).concat(rows);
      }
      changed(true);
      if (act === 'row-add') $(`.block[data-b="${i}"] tbody tr:last-child input`).focus();
    });
    $('#block-add').addEventListener('click', () => {
      const b = blockFrom(blocks[blocks.length - 1] || state.cert);
      resetModelFields(b);
      blocks.push(b);
      changed(true);
      $('#blocks .block:last-child select').focus();
    });
    $('#blocks-clear').addEventListener('click', async () => {
      if (!(await confirmBox('Apagar todos os blocos e nomes desta montagem? Os certificados já emitidos continuam em "Emitidos".', 'Sim, começar do zero'))) return;
      blocks = [blockFrom(state.cert)];
      sheetIndex = 0;
      changed(true);
    });
    $('#sheet-prev').addEventListener('click', () => {
      sheetIndex = Math.max(0, sheetIndex - 1);
      drawSheetPreview();
    });
    $('#sheet-next').addEventListener('click', () => {
      sheetIndex = Math.min(sheetsCount() - 1, sheetIndex + 1);
      drawSheetPreview();
    });
    $('#batch-pdf').addEventListener('click', () => emitMontagem('pdf'));
    $('#batch-print').addEventListener('click', () => emitMontagem('print'));
  }

  // ------------------------------------------------------------ emitidos (histórico)

  let historyTimer = null;
  async function loadHistory() {
    const q = $('#history-search').value.trim();
    const by = $('#history-by').value;
    const box = $('#history-list');
    try {
      const [list, issuers] = await Promise.all([api(`/api/certificates?q=${encodeURIComponent(q)}&by=${encodeURIComponent(by)}`), api('/api/certificates/issuers')]);
      state.history = list;
      $('#history-by').innerHTML =
        '<option value="">Emitidos por todos</option>' +
        issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === by ? 'selected' : ''}>Emitidos por ${esc(i.name)} (${i.n})</option>`).join('');
    } catch (err) {
      box.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
    if (!state.history.length) {
      box.innerHTML = `<p class="empty">${q || by ? 'Nada encontrado com essa busca.' : 'Nenhum certificado emitido ainda. Eles aparecem aqui assim que você imprime ou baixa.'}</p>`;
      return;
    }
    box.innerHTML = state.history
      .map(
        (h) => `<article class="hcard">
          <h3>${esc(h.recipient)}</h3>
          <div class="meta">${esc(h.category)} › <strong>${esc(h.model)}</strong></div>
          <div class="meta">${h.registration ? 'Registro UEB ' + esc(h.registration) + ' · ' : ''}${esc(GELB.formatDate(h.event_date) || '')}</div>
          <div class="meta"><span class="code">${esc(h.code)}</span></div>
          <div class="issuer">Emitido por <strong>${esc(h.issued_by_name || '—')}</strong> em ${esc(fmtDateTime(h.issued_at))}</div>
          <div class="actions">
            <button class="btn btn-primary btn-sm" data-h-open="${esc(h.id)}">Abrir / reimprimir</button>
            <button class="btn btn-ghost btn-sm" data-h-pdf="${esc(h.id)}">Baixar PDF</button>
            <button class="btn btn-ghost btn-sm" data-h-del="${esc(h.id)}">Excluir</button>
          </div>
        </article>`,
      )
      .join('');
  }

  function bindHistory() {
    $('#history-by').addEventListener('change', loadHistory);
    $('#history-search').addEventListener('input', () => {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(loadHistory, 250);
    });
    $('#history-list').addEventListener('click', async (e) => {
      const open = e.target.closest('[data-h-open]');
      const pdfBtn = e.target.closest('[data-h-pdf]');
      const del = e.target.closest('[data-h-del]');
      const id = (open || pdfBtn || del || {}).dataset;
      if (!id) return;
      const h = state.history.find((x) => x.id === (id.hOpen || id.hPdf || id.hDel));
      if (!h) return;
      if (open) {
        state.cert = { ...blankCert(), ...h.data };
        state.emitted = true;
        switchTab('emitir');
        fillForm();
      } else if (pdfBtn) {
        pdfBtn.disabled = true;
        try {
          const cert = { ...blankCert(), ...h.data };
          const pdf = newPdf(paper());
          addPage(pdf, await renderHighRes(cert), true);
          pdf.save(`certificado-${slug(cert.recipientName)}.pdf`);
        } finally {
          pdfBtn.disabled = false;
        }
      } else if (del) {
        if (!(await confirmBox(`Excluir o certificado de "${h.recipient}"? Ele deixará de ser válido na conferência pelo QR Code.`))) return;
        await api('/api/certificates/' + encodeURIComponent(h.id), { method: 'DELETE' });
        loadHistory();
      }
    });
  }

  // ------------------------------------------------------------ configurações

  async function downscaleImage(file, maxW, maxH) {
    const url = URL.createObjectURL(file);
    try {
      const img = await GELBRender.loadImage(url);
      if (!img) throw new Error('Não consegui abrir essa imagem.');
      const r = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * r);
      c.height = Math.round(img.naturalHeight * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let draftSettings = null;

  function renderSettings() {
    draftSettings = JSON.parse(JSON.stringify(state.settings));
    $('#s-groupName').value = draftSettings.groupName || '';
    $('#s-city').value = draftSettings.city || '';
    renderLogos();
    renderSigList();
    renderTypeRoles();
    renderFontList();
  }

  // ------------------------------------------------------------ letras (fontes, cor e transparência)

  /** Opções de letra: as do sistema + as enviadas pela diretoria. */
  function fontOptions() {
    return GELB.FONTS.concat(state.fonts.map((f) => [`'${f.name}', sans-serif`, `${f.name} (enviada)`]));
  }

  function fontSelectHtml(value) {
    const opts = fontOptions();
    if (value && !opts.some(([v]) => v === value)) opts.push([value, 'Fonte removida (usa a padrão)']);
    return opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }

  function typeOf(key) {
    const def = GELB.TEXT_ROLES.find((r) => r.key === key);
    const t = (draftSettings.typography || {})[key] || {};
    return { font: t.font || def.font, color: t.color || def.color, opacity: t.opacity ?? 100 };
  }

  function renderTypeRoles() {
    $('#type-roles').innerHTML = GELB.TEXT_ROLES.map((r) => {
      const t = typeOf(r.key);
      return `<div class="type-role" data-role="${r.key}">
        <strong>${esc(r.label)}</strong>
        <select data-type="font" aria-label="Letra">${fontSelectHtml(t.font)}</select>
        <input type="color" data-type="color" value="${esc(t.color)}" aria-label="Cor">
        <label class="opacity">Transparência <input type="range" data-type="opacity" min="0" max="95" step="5" value="${100 - t.opacity}"><span>${100 - t.opacity}%</span></label>
      </div>`;
    }).join('');
    drawTypePreview();
  }

  let typeSeq = 0;
  let typeTimer = null;
  function drawTypePreview() {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(async () => {
      const seq = ++typeSeq;
      const off = document.createElement('canvas');
      const sample = { ...state.cert, design: 'padrao', recipientName: state.cert.recipientName || 'Gabriel Schmidt Silva' };
      await GELBRender.draw(off, sample, { settings: draftSettings, template: null, preview: true, qrUrl: verifyUrl(sample.code) }, 1);
      if (seq !== typeSeq) return;
      const c = $('#type-canvas');
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d').drawImage(off, 0, 0);
    }, 120);
  }

  function renderFontList() {
    $('#font-list').innerHTML = state.fonts.length
      ? state.fonts
          .map(
            (f) => `<div class="font-item">
              <strong>${esc(f.name)}</strong>
              <span class="sample" style="font-family:'${esc(f.name)}', sans-serif">Gabriel Schmidt Silva</span>
              <div><button class="btn btn-ghost btn-sm" type="button" data-font-del="${esc(f.id)}">Excluir</button></div>
            </div>`,
          )
          .join('')
      : '<p class="hint">Nenhuma fonte enviada ainda.</p>';
  }

  async function loadFonts() {
    state.fonts = await api('/api/fonts');
    await GELBRender.setCustomFonts(state.fonts);
  }

  function bindTypography() {
    const update = (e) => {
      const row = e.target.closest('.type-role');
      const k = e.target.dataset.type;
      if (!row || !k) return;
      const key = row.dataset.role;
      draftSettings.typography = draftSettings.typography || {};
      const t = { ...typeOf(key), ...(draftSettings.typography[key] || {}) };
      // a barra mostra a transparência (0% = cor cheia); guardamos a opacidade
      t[k] = k === 'opacity' ? 100 - Number(e.target.value) : e.target.value;
      draftSettings.typography[key] = t;
      if (k === 'opacity') row.querySelector('.opacity span').textContent = `${100 - t.opacity}%`;
      drawTypePreview();
    };
    $('#type-roles').addEventListener('input', update);
    $('#type-roles').addEventListener('change', update);
    $('#type-reset').addEventListener('click', () => {
      draftSettings.typography = {};
      renderTypeRoles();
    });
    $('#font-file').addEventListener('change', () => {
      const f = $('#font-file').files[0];
      if (f && !$('#font-name').value.trim()) {
        $('#font-name').value = f.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
      }
      $('#font-status').textContent = f ? `Arquivo escolhido: ${f.name}` : '';
      $('#font-status').classList.remove('error');
    });
    $('#font-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const st = $('#font-status');
      st.classList.remove('error');
      const file = $('#font-file').files[0];
      if (!file) {
        st.textContent = 'Escolha primeiro o arquivo da fonte.';
        st.classList.add('error');
        return;
      }
      if (file.size > 1_400_000) {
        st.textContent = 'Essa fonte é grande demais (máximo de 1,4 MB). Prefira o arquivo .woff2.';
        st.classList.add('error');
        return;
      }
      const btn = $('#font-save');
      btn.disabled = true;
      try {
        const res = await api('/api/fonts', { method: 'POST', body: { name: $('#font-name').value, fileName: file.name, data: await readAsDataUrl(file) } });
        await loadFonts();
        $('#font-form').reset();
        st.textContent = `✓ Fonte "${res.name}" enviada. Ela já aparece nas listas de letras.`;
        renderTypeRoles();
        renderFontList();
      } catch (err) {
        st.textContent = err.message;
        st.classList.add('error');
      } finally {
        btn.disabled = false;
      }
    });
    $('#font-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-font-del]');
      if (!b) return;
      const f = state.fonts.find((x) => x.id === b.dataset.fontDel);
      if (!f || !(await confirmBox(`Excluir a fonte "${f.name}"? Onde ela estiver em uso, volta a letra padrão.`))) return;
      await api('/api/fonts/' + encodeURIComponent(f.id), { method: 'DELETE' });
      state.fonts = state.fonts.filter((x) => x.id !== f.id);
      renderTypeRoles();
      renderFontList();
    });
  }

  function renderLogos() {
    $('#s-logoLeft-img').src = draftSettings.logoLeft || '/img/logo-gelb.svg';
    const right = $('#s-logoRight-img');
    right.hidden = !draftSettings.logoRight;
    if (draftSettings.logoRight) right.src = draftSettings.logoRight;
  }

  function renderSigList() {
    $('#sig-list').innerHTML = draftSettings.signatories
      .map(
        (s, i) => `<div class="sig-row" data-i="${i}">
          <label>Nome<input data-sig="name" value="${esc(s.name)}"></label>
          <label>Cargo<input data-sig="role" value="${esc(s.role)}"></label>
          <div class="sig-img">Assinatura
            ${s.image ? `<img src="${esc(s.image)}" alt="">` : '<small>sem imagem</small>'}
            <div class="row-wrap">
              <label class="btn btn-ghost btn-sm file-btn">Imagem<input type="file" accept="image/*" data-sig-img></label>
              ${s.image ? '<button class="btn btn-ghost btn-sm" data-sig-noimg>Tirar</button>' : ''}
            </div>
          </div>
          <div class="row-wrap">
            <label class="check"><input type="checkbox" data-sig="enabled" ${s.enabled ? 'checked' : ''}> assina sempre</label>
            <button class="btn btn-ghost btn-sm" data-sig-del>Remover</button>
          </div>
        </div>`,
      )
      .join('');
  }

  function bindSettings() {
    $('#sig-list').addEventListener('input', (e) => {
      const row = e.target.closest('.sig-row');
      const k = e.target.dataset.sig;
      if (!row || !k) return;
      draftSettings.signatories[row.dataset.i][k] = k === 'enabled' ? e.target.checked : e.target.value;
    });
    $('#sig-list').addEventListener('change', async (e) => {
      const row = e.target.closest('.sig-row');
      if (!row) return;
      const s = draftSettings.signatories[row.dataset.i];
      if (e.target.dataset.sig === 'enabled') s.enabled = e.target.checked;
      if (e.target.matches('[data-sig-img]') && e.target.files[0]) {
        s.image = await downscaleImage(e.target.files[0], 600, 200);
        renderSigList();
      }
    });
    $('#sig-list').addEventListener('click', (e) => {
      const row = e.target.closest('.sig-row');
      if (!row) return;
      if (e.target.matches('[data-sig-del]')) {
        draftSettings.signatories.splice(Number(row.dataset.i), 1);
        renderSigList();
      } else if (e.target.matches('[data-sig-noimg]')) {
        draftSettings.signatories[row.dataset.i].image = null;
        renderSigList();
      }
    });
    $('#sig-add').addEventListener('click', () => {
      draftSettings.signatories.push({ id: 'sig-' + Date.now().toString(36), name: 'Nome de quem assina', role: 'Cargo', image: null, enabled: false });
      renderSigList();
    });
    $$('[data-logo]').forEach((input) =>
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        draftSettings[input.dataset.logo] = await downscaleImage(input.files[0], 500, 500);
        input.value = '';
        renderLogos();
      }),
    );
    $$('[data-logo-reset]').forEach((b) =>
      b.addEventListener('click', () => {
        draftSettings[b.dataset.logoReset] = null;
        renderLogos();
      }),
    );
    $('#save-settings').addEventListener('click', async () => {
      const st = $('#settings-status');
      st.classList.remove('error');
      draftSettings.groupName = $('#s-groupName').value.trim() || GELBRender.DEFAULT_SETTINGS.groupName;
      draftSettings.city = $('#s-city').value.trim();
      try {
        await api('/api/settings', { method: 'PUT', body: draftSettings });
        state.settings = JSON.parse(JSON.stringify(draftSettings));
        // assinaturas removidas saem do certificado atual
        const ids = state.settings.signatories.map((s) => s.id);
        state.cert.signers = state.cert.signers.filter((id) => ids.includes(id));
        st.textContent = '✓ Configurações salvas.';
        // a logo do topo e da tela de entrada acompanha a logo do grupo
        $$('.brand-logo').forEach((img) => (img.src = '/api/logo?v=' + Date.now()));
        fillForm();
      } catch (err) {
        st.textContent = err.message;
        st.classList.add('error');
      }
    });
  }

  // ------------------------------------------------------------ modelos com arte

  function renderTemplates() {
    const filter = $('#tpl-filter').value || 'Todas';
    const list = state.templates.filter((t) => filter === 'Todas' || t.category === filter);
    $('#tpl-list').innerHTML = list.length
      ? list
          .map(
            (t) => `<article class="tpl ${t.hidden ? 'hidden-tpl' : ''}">
          <canvas class="thumb" data-tpl-thumb="${esc(t.id)}" width="420" height="297"></canvas>
          <div class="body">
            <h3>${esc(t.name)}</h3>
            <div class="hint" style="margin:0">${esc(t.category)} › ${esc(t.model)}</div>
            <div>${t.hidden ? '<span class="badge gray">Excluído</span>' : t.isDefault ? '<span class="badge">Usado automaticamente</span>' : '<span class="badge gray">Opcional</span>'}</div>
            ${t.description ? `<div class="hint" style="margin:0">${esc(t.description)}</div>` : ''}
            <div class="actions">
              ${
                t.hidden
                  ? `<button class="btn btn-ghost btn-sm" data-tpl-restore="${esc(t.id)}">Restaurar</button>`
                  : `<button class="btn btn-primary btn-sm" data-tpl-use="${esc(t.id)}">Usar agora</button>
                     <button class="btn btn-ghost btn-sm" data-tpl-layout="${esc(t.id)}">Ajustar posições</button>
                     ${t.isDefault ? '' : `<button class="btn btn-ghost btn-sm" data-tpl-default="${esc(t.id)}">Usar sempre</button>`}
                     ${t.hasOriginal ? `<a class="btn btn-ghost btn-sm" href="/api/templates/${esc(t.id)}/original">Baixar original</a>` : ''}
                     <button class="btn btn-ghost btn-sm" data-tpl-del="${esc(t.id)}">Excluir</button>`
              }
            </div>
          </div>
        </article>`,
          )
          .join('')
      : '<p class="empty">Nenhum modelo nesta categoria.</p>';
    for (const t of list) {
      const c = $(`canvas[data-tpl-thumb="${CSS.escape(t.id)}"]`);
      GELBRender.draw(c, { ...blankCert(), category: t.category, model: t.model, showQr: false }, { settings: state.settings, template: t, preview: true }, 0.375);
    }
  }

  async function loadTemplates() {
    state.templates = await api('/api/templates');
  }

  function fillCategorySelect(sel, withAll) {
    sel.innerHTML = (withAll ? ['Todas'] : []).concat(Object.keys(GELB.CATEGORIES)).map((c) => `<option>${esc(c)}</option>`).join('');
  }

  function fillTplModels() {
    $('#tpl-model').innerHTML = (GELB.CATEGORIES[$('#tpl-category').value] || []).map((m) => `<option>${esc(m)}</option>`).join('');
  }

  /** Converte PDF (página 1) ou imagem em JPEG do tamanho da página, abaixo do limite do banco. */
  async function fileToPageImage(file) {
    let source;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const page = await pdf.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 2400 / Math.max(vp1.width, vp1.height) });
      source = document.createElement('canvas');
      source.width = vp.width;
      source.height = vp.height;
      await page.render({ canvasContext: source.getContext('2d'), viewport: vp }).promise;
    } else {
      const url = URL.createObjectURL(file);
      source = await GELBRender.loadImage(url);
      URL.revokeObjectURL(url);
      if (!source) throw new Error('Não consegui abrir essa imagem.');
    }
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const portrait = sh > sw;
    const out = document.createElement('canvas');
    out.width = 2244;
    out.height = 1586;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0, out.width, out.height);
    let q = 0.9;
    let data = out.toDataURL('image/jpeg', q);
    while (data.length > 1_700_000 && q > 0.4) {
      q -= 0.1;
      data = out.toDataURL('image/jpeg', q);
    }
    return { data, portrait };
  }

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  function bindTemplates() {
    fillCategorySelect($('#tpl-category'));
    fillCategorySelect($('#tpl-filter'), true);
    fillTplModels();
    $('#tpl-category').addEventListener('change', fillTplModels);
    $('#tpl-filter').addEventListener('change', renderTemplates);
    $('#tpl-new').addEventListener('click', () => {
      $('#tpl-form').hidden = false;
      $('#tpl-category').value = state.cert.category;
      fillTplModels();
      $('#tpl-model').value = state.cert.model;
      $('#tpl-file').focus();
    });
    $('#tpl-cancel').addEventListener('click', () => {
      $('#tpl-form').reset();
      $('#tpl-form').hidden = true;
    });
    $('#tpl-file').addEventListener('change', () => {
      const f = $('#tpl-file').files[0];
      if (f && !$('#tpl-name').value.trim()) {
        $('#tpl-name').value = f.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      }
    });
    $('#tpl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#tpl-error');
      err.hidden = true;
      const file = $('#tpl-file').files[0];
      if (!file) return;
      const btn = $('#tpl-save');
      btn.disabled = true;
      btn.textContent = 'Lendo o arquivo…';
      try {
        const { data, portrait } = await fileToPageImage(file);
        const original = file.size <= 1_400_000 ? await readAsDataUrl(file) : undefined;
        const preset = $('#tpl-preset').value;
        btn.textContent = 'Salvando…';
        const res = await api('/api/templates', {
          method: 'POST',
          body: {
            name: $('#tpl-name').value,
            category: $('#tpl-category').value,
            model: $('#tpl-model').value,
            description: $('#tpl-description').value,
            image: data,
            layout: preset === 'linhas' ? GELB.presetLinhas() : GELB.presetCentro(),
            fileName: file.name,
            fileSize: file.size,
            original,
          },
        });
        $('#tpl-form').reset();
        $('#tpl-form').hidden = true;
        await loadTemplates();
        renderTemplates();
        const t = state.templates.find((x) => x.id === res.id);
        if (portrait) alert('Atenção: a arte enviada está em pé (retrato). Os certificados são impressos deitados (paisagem), então ela foi esticada. Se possível, envie a arte deitada.');
        if (t) openLayoutEditor(t);
      } catch (ex) {
        err.textContent = ex.message || 'Não foi possível ler o arquivo.';
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar modelo';
      }
    });
    $('#tpl-list').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      const id = d.tplUse || d.tplLayout || d.tplDefault || d.tplDel || d.tplRestore;
      const t = state.templates.find((x) => x.id === id);
      if (!t) return;
      if (d.tplUse) {
        state.cert.category = t.category;
        state.cert.model = t.model;
        state.cert.design = t.id;
        switchTab('emitir');
        fillForm();
      } else if (d.tplLayout) openLayoutEditor(t);
      else if (d.tplDefault) {
        await api('/api/templates/' + t.id, { method: 'PUT', body: { isDefault: true } });
        await refreshTemplates();
      } else if (d.tplDel) {
        if (!(await confirmBox(`Excluir o modelo "${t.name}"? Ele deixará de aparecer na emissão.`))) return;
        await api('/api/templates/' + t.id, { method: 'DELETE' });
        await refreshTemplates();
      } else if (d.tplRestore) {
        await api('/api/templates/' + t.id, { method: 'PUT', body: { hidden: false } });
        await refreshTemplates();
      }
    });
  }

  async function refreshTemplates() {
    await loadTemplates();
    renderTemplates();
    fillForm();
  }

  // ------------------------------------------------------------ editor de posições

  const editor = { tpl: null, layout: null, sel: null };

  function openLayoutEditor(tpl) {
    editor.tpl = tpl;
    editor.layout = GELB.normalizeLayout(JSON.parse(JSON.stringify(tpl.layout || {})));
    editor.sel = 'nome';
    $('#le-font').innerHTML = fontSelectHtml(editor.layout.font);
    $('#layout-editor').showModal();
    renderEditor();
  }

  let editorSeq = 0;
  async function drawEditorCanvas() {
    const seq = ++editorSeq;
    const off = document.createElement('canvas');
    // usa o certificado atual (ou exemplos) para enxergar o resultado real
    const sample = { ...state.cert, category: editor.tpl.category, model: editor.tpl.model, recipientName: state.cert.recipientName || 'Gabriel Schmidt Silva' };
    await GELBRender.draw(off, sample, { settings: state.settings, template: { ...editor.tpl, layout: editor.layout }, preview: true, qrUrl: verifyUrl(sample.code) }, 1.2);
    if (seq !== editorSeq) return;
    const c = $('#le-canvas');
    c.width = off.width;
    c.height = off.height;
    c.getContext('2d').drawImage(off, 0, 0);
  }

  function renderEditorBoxes() {
    const html = Object.entries(editor.layout.fields)
      .filter(([, f]) => f.on)
      .map(([k, f]) => {
        const b = GELBRender.fieldBox(k, f);
        const st = `left:${(b.x / GELBRender.W) * 100}%;top:${(b.y / GELBRender.H) * 100}%;width:${(b.w / GELBRender.W) * 100}%;height:${(b.h / GELBRender.H) * 100}%`;
        return `<div class="le-box ${editor.sel === k ? 'sel' : ''}" data-k="${k}" style="${st}"><span>${esc(GELB.TEMPLATE_FIELDS[k])}</span></div>`;
      })
      .join('');
    $('#le-overlay').innerHTML = html;
  }

  function renderEditorSide() {
    $('#le-font').value = editor.layout.font;
    const op = editor.layout.opacity ?? 100;
    $('#le-opacity').value = 100 - op;
    $('#le-opacity-val').textContent = `${100 - op}%`;
    $('#le-colors').innerHTML =
      GELB.COLORS.map(([c, n]) => `<button type="button" title="${esc(n)}" data-color="${c}" style="background:${c}" class="${editor.layout.color === c ? 'active' : ''}"></button>`).join('') +
      `<input type="color" id="le-color-custom" value="${esc(editor.layout.color)}" title="Outra cor">`;
    $('#le-fields').innerHTML = Object.entries(editor.layout.fields)
      .map(
        ([k, f]) => `<div class="le-field ${editor.sel === k ? 'sel' : ''}" data-k="${k}">
          <div class="top"><label class="check"><input type="checkbox" data-on ${f.on ? 'checked' : ''}> ${esc(GELB.TEMPLATE_FIELDS[k])}</label></div>
          ${
            f.on
              ? `<div class="ctrls">
                  Tamanho <button type="button" data-size="-1" aria-label="Diminuir">−</button><strong>${Math.round(f.size)}</strong><button type="button" data-size="1" aria-label="Aumentar">+</button>
                  ${['qr', 'assinatura1', 'assinatura2', 'assinaturas', 'texto'].includes(k) ? '' : `<select data-align><option value="left" ${f.align === 'left' ? 'selected' : ''}>Começa no ponto</option><option value="center" ${f.align === 'center' ? 'selected' : ''}>Centralizado</option></select>`}
                  ${k === 'qr' ? '' : `Largura <button type="button" data-w="-2" aria-label="Mais estreito">−</button><button type="button" data-w="2" aria-label="Mais largo">+</button>`}
                </div>`
              : ''
          }
        </div>`,
      )
      .join('');
  }

  function renderEditor() {
    renderEditorSide();
    renderEditorBoxes();
    drawEditorCanvas();
  }

  function bindEditor() {
    const overlay = $('#le-overlay');
    let drag = null;
    overlay.addEventListener('pointerdown', (e) => {
      const box = e.target.closest('.le-box');
      if (!box) return;
      e.preventDefault();
      const k = box.dataset.k;
      editor.sel = k;
      const f = editor.layout.fields[k];
      drag = { k, sx: e.clientX, sy: e.clientY, x: f.x, y: f.y, rect: overlay.getBoundingClientRect() };
      overlay.setPointerCapture(e.pointerId);
      renderEditorSide();
      renderEditorBoxes();
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const f = editor.layout.fields[drag.k];
      f.x = Math.round(Math.min(100, Math.max(0, drag.x + ((e.clientX - drag.sx) / drag.rect.width) * 100)) * 10) / 10;
      f.y = Math.round(Math.min(100, Math.max(0, drag.y + ((e.clientY - drag.sy) / drag.rect.height) * 100)) * 10) / 10;
      renderEditorBoxes();
      drawEditorCanvas();
    });
    const end = () => (drag = null);
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);

    $('#le-fields').addEventListener('click', (e) => {
      const row = e.target.closest('.le-field');
      if (!row) return;
      const k = row.dataset.k;
      const f = editor.layout.fields[k];
      if (e.target.dataset.size) f.size = Math.max(6, f.size + Number(e.target.dataset.size) * (k === 'qr' ? 4 : 1));
      else if (e.target.dataset.w) f.w = Math.min(100, Math.max(3, f.w + Number(e.target.dataset.w)));
      else if (e.target.matches('[data-on], select, label')) return;
      editor.sel = k;
      renderEditor();
    });
    $('#le-fields').addEventListener('change', (e) => {
      const row = e.target.closest('.le-field');
      if (!row) return;
      const f = editor.layout.fields[row.dataset.k];
      if (e.target.matches('[data-on]')) f.on = e.target.checked;
      if (e.target.matches('[data-align]')) f.align = e.target.value;
      editor.sel = row.dataset.k;
      renderEditor();
    });
    $('#le-opacity').addEventListener('input', (e) => {
      editor.layout.opacity = 100 - Number(e.target.value);
      $('#le-opacity-val').textContent = `${e.target.value}%`;
      drawEditorCanvas();
    });
    $('#le-font').addEventListener('change', (e) => {
      editor.layout.font = e.target.value;
      drawEditorCanvas();
    });
    $('#le-colors').addEventListener('click', (e) => {
      if (!e.target.dataset.color) return;
      editor.layout.color = e.target.dataset.color;
      renderEditorSide();
      drawEditorCanvas();
    });
    $('#le-colors').addEventListener('input', (e) => {
      if (e.target.id !== 'le-color-custom') return;
      editor.layout.color = e.target.value;
      drawEditorCanvas();
    });
    $$('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        editor.layout = b.dataset.preset === 'linhas' ? GELB.presetLinhas() : GELB.presetCentro();
        renderEditor();
      }),
    );
    $('#le-cancel').addEventListener('click', () => $('#layout-editor').close());
    $('#le-save').addEventListener('click', async () => {
      const btn = $('#le-save');
      btn.disabled = true;
      try {
        await api('/api/templates/' + editor.tpl.id, { method: 'PUT', body: { layout: editor.layout } });
        $('#layout-editor').close();
        await refreshTemplates();
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------ usuários (só administradores)

  const fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  let users = [];

  async function loadUsers() {
    users = await api('/api/users');
    renderUsers();
    const sel = $('#audit-user');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todas as pessoas</option>' + users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    sel.value = cur;
    loadAudit();
  }

  function renderUsers() {
    $('#user-list').innerHTML = users
      .map((u) => {
        const me = u.id === state.user.id;
        const badges = [
          u.role === 'admin' ? '<span class="badge admin">Administrador</span>' : '<span class="badge gray">Usuário</span>',
          u.active ? '' : '<span class="badge off">Desativado</span>',
          u.active && u.must_change ? '<span class="badge temp">Ainda não criou a senha</span>' : '',
          me ? '<span class="badge">Você</span>' : '',
        ].join(' ');
        return `<div class="user-row ${u.active ? '' : 'off'}" data-u="${esc(u.id)}">
          <div>
            <h3>${esc(u.name)} ${badges}</h3>
            <div class="meta">${esc(u.email)}</div>
            <div class="meta">Último acesso: ${u.last_seen_at ? esc(fmtDateTime(u.last_seen_at)) : 'nunca entrou'} · ${u.issued} certificado(s) emitido(s)${u.created_by_name ? ` · criado por ${esc(u.created_by_name)}` : ''}</div>
          </div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" type="button" data-u-act="edit">Editar</button>
            ${u.active ? `<button class="btn btn-ghost btn-sm" type="button" data-u-act="reset">Gerar senha nova</button>` : ''}
            ${me ? '' : u.active ? '<button class="btn btn-ghost btn-sm" type="button" data-u-act="off">Desativar</button>' : '<button class="btn btn-primary btn-sm" type="button" data-u-act="on">Reativar</button>'}
          </div>
        </div>`;
      })
      .join('');
  }

  /** Mostra a senha provisória e a mensagem pronta para enviar (WhatsApp, e-mail ou copiar). */
  function showAccess(user, temp, isNew) {
    const msg =
      `Olá, ${user.name}! ${isNew ? 'Seu acesso ao Gerador de Certificados do GELB 32/SC está pronto.' : 'Geramos uma senha nova para você entrar no Gerador de Certificados do GELB 32/SC.'}\n\n` +
      `Endereço: ${location.origin}\nE-mail: ${user.email}\nSenha provisória: ${temp}\n\n` +
      'No primeiro acesso, o sistema vai pedir para você criar a sua própria senha.';
    const box = $('#user-access');
    box.innerHTML = `<h3>${isNew ? 'Acesso criado' : 'Senha nova gerada'} para ${esc(user.name)}</h3>
      <div>Senha provisória: <span class="temp-pass">${esc(temp)}</span></div>
      <p class="hint" style="margin:0">Anote ou envie agora: por segurança, ela não aparece de novo. A pessoa cria a própria senha no primeiro acesso.</p>
      <label>Mensagem pronta para enviar<textarea rows="7" readonly>${esc(msg)}</textarea></label>
      <div class="actions" style="margin:0">
        <button class="btn btn-primary btn-sm" type="button" data-copy>Copiar mensagem</button>
        <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Enviar pelo WhatsApp</a>
        <a class="btn btn-ghost btn-sm" href="mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent('Seu acesso ao Gerador de Certificados GELB')}&body=${encodeURIComponent(msg)}">Enviar por e-mail</a>
        <button class="btn btn-ghost btn-sm" type="button" data-close>Fechar</button>
      </div>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function loadAudit() {
    const who = $('#audit-user').value;
    const list = await api('/api/audit' + (who ? '?user=' + encodeURIComponent(who) : ''));
    $('#audit-list').innerHTML = list.length
      ? list
          .map(
            (a) => `<div class="audit-item"><time datetime="${esc(a.at)}">${esc(fmtDateTime(a.at))}</time>
              <div><strong>${esc(a.user_name || '—')}</strong> · ${esc(a.action)}${a.details ? ` <span class="det">— ${esc(a.details)}</span>` : ''}</div></div>`,
          )
          .join('')
      : '<p class="empty">Nenhuma alteração registrada ainda.</p>';
  }

  function bindUsers() {
    $('#user-new').addEventListener('click', () => {
      $('#user-form').hidden = false;
      $('#user-name').focus();
    });
    $('#user-cancel').addEventListener('click', () => {
      $('#user-form').reset();
      $('#user-form').hidden = true;
    });
    $('#user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#user-error');
      err.hidden = true;
      const body = { name: $('#user-name').value, email: $('#user-email').value, role: $('#user-admin').checked ? 'admin' : 'user' };
      try {
        const res = await api('/api/users', { method: 'POST', body });
        $('#user-form').reset();
        $('#user-form').hidden = true;
        await loadUsers();
        showAccess(users.find((u) => u.id === res.id) || body, res.tempPassword, true);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
    $('#user-access').addEventListener('click', async (e) => {
      const box = $('#user-access');
      if (e.target.matches('[data-close]')) {
        box.hidden = true;
        box.innerHTML = '';
      } else if (e.target.matches('[data-copy]')) {
        const text = $('textarea', box).value;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          $('textarea', box).select();
          document.execCommand('copy');
        }
        e.target.textContent = '✓ Copiada';
      }
    });
    $('#user-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-u-act]');
      if (!btn) return;
      const u = users.find((x) => x.id === btn.closest('.user-row').dataset.u);
      const act = btn.dataset.uAct;
      try {
        if (act === 'edit') {
          $('#ue-name').value = u.name;
          $('#ue-email').value = u.email;
          $('#ue-admin').checked = u.role === 'admin';
          $('#ue-error').hidden = true;
          $('#user-edit').dataset.u = u.id;
          $('#user-edit').showModal();
        } else if (act === 'reset') {
          if (!(await confirmBox(`Gerar uma senha provisória nova para ${u.name}? A senha atual dele(a) deixa de funcionar.`, 'Sim, gerar senha nova'))) return;
          const res = await api(`/api/users/${encodeURIComponent(u.id)}/reset`, { method: 'POST' });
          await loadUsers();
          showAccess(u, res.tempPassword, false);
        } else if (act === 'off') {
          if (!(await confirmBox(`Desativar o acesso de ${u.name}? A pessoa sai do sistema na hora, mas o nome continua nos certificados que emitiu.`, 'Sim, desativar'))) return;
          await api(`/api/users/${encodeURIComponent(u.id)}`, { method: 'PUT', body: { active: false } });
          await loadUsers();
        } else if (act === 'on') {
          await api(`/api/users/${encodeURIComponent(u.id)}`, { method: 'PUT', body: { active: true } });
          await loadUsers();
        }
      } catch (ex) {
        alert(ex.message);
      }
    });
    $('#ue-cancel').addEventListener('click', () => $('#user-edit').close());
    $('#user-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#user-edit').dataset.u;
      try {
        await api(`/api/users/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: { name: $('#ue-name').value, email: $('#ue-email').value, role: $('#ue-admin').checked ? 'admin' : 'user' },
        });
        $('#user-edit').close();
        if (id === state.user.id) await refreshMe();
        await loadUsers();
      } catch (ex) {
        $('#ue-error').textContent = ex.message;
        $('#ue-error').hidden = false;
      }
    });
    $('#audit-user').addEventListener('change', loadAudit);
  }

  // ------------------------------------------------------------ minha senha

  function bindMyPassword() {
    const dlg = $('#my-password');
    $('#my-password-open').addEventListener('click', () => {
      $('#my-password-form').reset();
      $('#mp-error').hidden = true;
      $('#mp-status').textContent = '';
      dlg.showModal();
    });
    $('#mp-cancel').addEventListener('click', () => dlg.close());
    $('#my-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#mp-error');
      err.hidden = true;
      if ($('#mp-new').value !== $('#mp-new2').value) {
        err.textContent = 'As duas senhas novas não são iguais.';
        err.hidden = false;
        return;
      }
      try {
        await api('/api/password', { method: 'POST', body: { current: $('#mp-current').value, password: $('#mp-new').value } });
        $('#my-password-form').reset();
        $('#mp-status').textContent = '✓ Senha trocada. Use a nova senha no próximo acesso.';
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  // ------------------------------------------------------------ geral

  function confirmBox(text, yesLabel = 'Sim, excluir') {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yesLabel;
    dlg.showModal();
    return new Promise((resolve) => {
      const done = (v) => {
        dlg.close();
        $('#confirm-yes').onclick = $('#confirm-no').onclick = null;
        resolve(v);
      };
      $('#confirm-yes').onclick = () => done(true);
      $('#confirm-no').onclick = () => done(false);
    });
  }

  function switchTab(tab) {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + tab));
    if (tab === 'emitidos') loadHistory();
    if (tab === 'config') {
      renderSettings();
      renderTemplates();
    }
    if (tab === 'lote') {
      renderBlocks();
    }
    if (tab === 'usuarios') loadUsers().catch((err) => alert(err.message));
    window.scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------ entrada: login, primeiro acesso e senha provisória

  function showEntry(form, message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    for (const id of ['login-form', 'setup-form', 'change-form']) $('#' + id).hidden = id !== form;
    const err = $('#login-error');
    err.hidden = !message;
    err.textContent = message || '';
    const first = $(`#${form} input`);
    if (first) first.focus();
  }

  const showLogin = (message) => showEntry('login-form', message);

  function showChange(user) {
    $('#change-name').textContent = (user || state.user || {}).name || '';
    $('#change-form').reset();
    showEntry('change-form');
  }

  async function refreshMe() {
    const me = await api('/api/me');
    state.user = me.user;
    $('#who-name').textContent = me.user.name;
    $('#tab-btn-usuarios').hidden = me.user.role !== 'admin';
    return me.user;
  }

  /** Depois de entrar: senha provisória pede a troca; senão abre o sistema. */
  async function afterLogin() {
    const user = await refreshMe();
    if (user.mustChange) return showChange(user);
    bindAll();
    await start();
  }

  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    const [settings] = await Promise.all([api('/api/settings'), loadTemplates(), loadFonts().catch(() => null)]);
    state.settings = { ...GELBRender.DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(state.settings.signatories)) state.settings.signatories = GELBRender.DEFAULT_SETTINGS.signatories;
    state.cert = blankCert();
    state.cert.progressionStage = 'Acolhida dos Filhotes';
    state.emitted = false;
    switchTab('emitir');
    fillForm();
  }

  let bound = false;
  function bindAll() {
    if (bound) return;
    bound = true;
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) switchTab(g.dataset.goto);
    });
    bindMontar();
    bindEmit();
    bindHistory();
    bindSettings();
    bindTypography();
    bindTemplates();
    bindEditor();
    bindUsers();
    bindMyPassword();
  }

  // cada nova tentativa limpa o aviso anterior
  for (const id of ['login-form', 'setup-form', 'change-form']) $('#' + id).addEventListener('submit', () => ($('#login-error').hidden = true), true);

  const entryError = (err) => {
    const box = $('#login-error');
    box.textContent = err.message;
    box.hidden = false;
  };

  $$('[data-logout]').forEach((b) =>
    b.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      state.user = null;
      showLogin();
    }),
  );

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { email: $('#login-email').value, password: $('#login-pass').value } });
      $('#login-pass').value = '';
      await afterLogin();
    } catch (err) {
      entryError(err);
    }
  });

  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#setup-pass').value !== $('#setup-pass2').value) return entryError(new Error('As duas senhas não são iguais.'));
    try {
      await api('/api/setup', {
        method: 'POST',
        body: { key: $('#setup-key').value, name: $('#setup-name').value, email: $('#setup-email').value, password: $('#setup-pass').value },
      });
      $('#setup-form').reset();
      await afterLogin();
    } catch (err) {
      entryError(err);
    }
  });

  $('#change-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#change-pass').value !== $('#change-pass2').value) return entryError(new Error('As duas senhas não são iguais.'));
    try {
      await api('/api/password', { method: 'POST', body: { password: $('#change-pass').value } });
      $('#change-form').reset();
      await afterLogin();
    } catch (err) {
      entryError(err);
    }
  });

  (async function boot() {
    const res = await fetch('/api/me', { credentials: 'same-origin' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      try {
        await afterLogin();
      } catch (err) {
        showLogin(err.message);
      }
    } else if (data.setup) showEntry('setup-form');
    else showLogin(data.configured === false ? 'O sistema ainda não foi configurado (veja o README).' : '');
  })();
})();
