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
    if (res.status === 401 && path !== '/api/me' && path !== '/api/login') {
      showLogin();
      throw new Error('Faça login novamente.');
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
    renderBatchUsing();
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
    state.cert.design = 'auto';
    const ramo = GELB.ramoFromModel(model);
    if (ramo) state.cert.ramo = ramo;
    if (model === 'Acolhida' && !state.cert.progressionStage) state.cert.progressionStage = 'Acolhida dos Filhotes';
    fillForm();
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

  // ------------------------------------------------------------ lote

  function parseBatch() {
    return $('#batch-text')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/\t|;|,/).map((p) => p.trim());
        return { name: parts[0], registration: parts[1] || '', responsaveis: parts.slice(2).filter(Boolean).join(', ') };
      })
      .filter((r) => r.name);
  }

  function renderBatchUsing() {
    if (!state.cert) return;
    const t = currentTemplate();
    const d = GELB.formatDate(state.cert.date);
    $('#batch-using').textContent = `${state.cert.category} › ${state.cert.model} · ${t ? t.name : 'Layout padrão GELB'} · ${state.cert.city || ''}${d ? ', ' + d : ''}`;
  }

  function updateBatchCount() {
    const n = parseBatch().length;
    $('#batch-count').textContent = n ? `${n} certificado${n > 1 ? 's' : ''} ${n > 1 ? 'serão gerados' : 'será gerado'}.` : 'Nenhum nome ainda.';
  }

  async function emitBatch(kind) {
    const rows = parseBatch();
    const status = $('#batch-status');
    status.classList.remove('error');
    if (!rows.length) {
      status.textContent = 'Escreva pelo menos um nome.';
      status.classList.add('error');
      return;
    }
    const certs = rows.map((r) => ({
      ...blankCert(state.cert),
      recipientName: r.name,
      recipientRegistration: r.registration,
      responsaveis: r.responsaveis || state.cert.responsaveis || '',
      customText: state.cert.customText || '',
      quantidadeAnos: state.cert.quantidadeAnos,
      quantidadeNovosMembros: state.cert.quantidadeNovosMembros,
      itensCompletados: state.cert.itensCompletados,
      matilhaPatrulha: state.cert.matilhaPatrulha,
    }));
    const btns = [$('#batch-print'), $('#batch-pdf')];
    btns.forEach((b) => (b.disabled = true));
    const bar = $('#batch-progress');
    bar.hidden = false;
    try {
      status.textContent = 'Registrando os certificados…';
      await saveCertificates(certs);
      const size = paper();
      const pdf = kind === 'pdf' ? newPdf(size) : null;
      const urls = [];
      for (let i = 0; i < certs.length; i++) {
        status.textContent = `Desenhando ${i + 1} de ${certs.length}: ${certs[i].recipientName}`;
        bar.firstElementChild.style.width = `${((i + 1) / certs.length) * 100}%`;
        const canvas = await renderHighRes(certs[i], 2.2);
        if (pdf) addPage(pdf, canvas, i === 0);
        else urls.push(canvas.toDataURL('image/jpeg', 0.93));
      }
      if (pdf) pdf.save(`certificados-${slug(state.cert.model)}-${size.toUpperCase()}.pdf`);
      else await printImages(urls, size);
      status.textContent = `✓ ${certs.length} certificado(s) registrados em "Emitidos".`;
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    } finally {
      btns.forEach((b) => (b.disabled = false));
      setTimeout(() => (bar.hidden = true), 800);
    }
  }

  // ------------------------------------------------------------ emitidos (histórico)

  let historyTimer = null;
  async function loadHistory() {
    const q = $('#history-search').value.trim();
    const box = $('#history-list');
    try {
      state.history = await api('/api/certificates?q=' + encodeURIComponent(q));
    } catch (err) {
      box.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
    if (!state.history.length) {
      box.innerHTML = `<p class="empty">${q ? 'Nada encontrado com essa busca.' : 'Nenhum certificado emitido ainda. Eles aparecem aqui assim que você imprime ou baixa.'}</p>`;
      return;
    }
    box.innerHTML = state.history
      .map(
        (h) => `<article class="hcard">
          <h3>${esc(h.recipient)}</h3>
          <div class="meta">${esc(h.category)} › <strong>${esc(h.model)}</strong></div>
          <div class="meta">${h.registration ? 'Registro UEB ' + esc(h.registration) + ' · ' : ''}${esc(GELB.formatDate(h.event_date) || '')}</div>
          <div class="meta"><span class="code">${esc(h.code)}</span></div>
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
    $('#le-font').innerHTML = GELB.FONTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
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

  // ------------------------------------------------------------ geral

  function confirmBox(text) {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
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
      renderBatchUsing();
      updateBatchCount();
    }
    window.scrollTo({ top: 0 });
  }

  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    const err = $('#login-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('#login-pass').focus();
  }

  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    const [settings] = await Promise.all([api('/api/settings'), loadTemplates()]);
    state.settings = { ...GELBRender.DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(state.settings.signatories)) state.settings.signatories = GELBRender.DEFAULT_SETTINGS.signatories;
    state.cert = blankCert();
    state.cert.progressionStage = 'Acolhida dos Filhotes';
    state.emitted = false;
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
    $('#logout').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      showLogin();
    });
    $('#batch-text').addEventListener('input', updateBatchCount);
    $('#batch-pdf').addEventListener('click', () => emitBatch('pdf'));
    $('#batch-print').addEventListener('click', () => emitBatch('print'));
    bindEmit();
    bindHistory();
    bindSettings();
    bindTemplates();
    bindEditor();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: $('#login-pass').value } });
      $('#login-pass').value = '';
      bindAll();
      await start();
    } catch (err) {
      showLogin(err.message);
    }
  });

  (async function boot() {
    const res = await fetch('/api/me', { credentials: 'same-origin' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      bindAll();
      try {
        await start();
      } catch (err) {
        showLogin(err.message);
      }
    } else showLogin(data.configured === false ? 'O sistema ainda não tem senha configurada (veja o README).' : '');
  })();
})();
