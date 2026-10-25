/*
 * Desenho do certificado em <canvas>.
 * A mesma função gera a pré-visualização, o PDF, o PNG e a impressão — o que aparece na tela é o que sai no papel.
 * Página base: 1122 x 793 (A4 paisagem a 96 dpi); a escala só aumenta a resolução.
 */
(function () {
  const W = 1122;
  const H = 793;
  const NAVY = '#0F2C59';
  const GOLD = '#FBBF24';

  const DEFAULT_SETTINGS = {
    groupName: 'Grupo Escoteiro Leões de Blumenau - GELB 32/SC',
    city: 'Blumenau - SC',
    logoLeft: null,
    logoRight: null,
    signatories: [
      { id: 'sig-1', name: 'Leidiana Vargas', role: 'Presidente - GELB 32/SC', image: '/img/assinatura-presidente.svg', enabled: true },
      { id: 'sig-2', name: 'Diretoria de Métodos Educativos', role: 'Grupo Escoteiro Leões de Blumenau', image: '/img/assinatura-diretoria.svg', enabled: true },
    ],
  };

  // ------------------------------------------------------------ carregamento

  const imageCache = new Map();
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (!imageCache.has(src)) {
      imageCache.set(
        src,
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => resolve(img);
          img.onerror = () => {
            imageCache.delete(src);
            resolve(null);
          };
          img.src = src;
        }),
      );
    }
    return imageCache.get(src);
  }

  let fontsPromise = null;
  function ensureFonts() {
    if (!fontsPromise) {
      const specs = [
        '400 16px Montserrat', '500 16px Montserrat', '600 16px Montserrat', '700 16px Montserrat',
        '700 18px Cinzel', '900 30px "Cinzel Decorative"', '700 36px "Playfair Display"',
        '400 20px "Great Vibes"', '600 16px Nunito', '700 16px Nunito', '900 16px Nunito',
        '600 16px Fredoka', '700 16px Merriweather', '600 16px "Dancing Script"',
      ];
      fontsPromise = document.fonts
        ? Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null))).then(() => document.fonts.ready)
        : Promise.resolve();
    }
    return fontsPromise;
  }

  // ------------------------------------------------------------ utilidades de texto

  function setFont(ctx, weight, size, family) {
    ctx.font = `${weight} ${size}px ${family}`;
  }

  /** Reduz a fonte até o texto caber na largura. Retorna o tamanho usado. */
  function fitFont(ctx, text, weight, size, family, maxW, minSize = 8) {
    let s = size;
    setFont(ctx, weight, s, family);
    while (s > minSize && ctx.measureText(text).width > maxW) {
      s -= 0.5;
      setFont(ctx, weight, s, family);
    }
    return s;
  }

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawContain(ctx, img, x, y, w, h, alignX = 'center') {
    if (!img) return 0;
    const iw = img.naturalWidth || img.width || w;
    const ih = img.naturalHeight || img.height || h;
    const r = Math.min(w / iw, h / ih);
    const dw = iw * r;
    const dh = ih * r;
    const dx = alignX === 'left' ? x : alignX === 'right' ? x + w - dw : x + (w - dw) / 2;
    ctx.drawImage(img, dx, y + (h - dh) / 2, dw, dh);
    return dw;
  }

  function letterSpacing(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
  }

  function star(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawQr(ctx, url, code, cx, cy, size) {
    if (typeof qrcode !== 'function' || !url) return;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const cell = size / n;
    const x0 = cx - size / 2;
    const y0 = cy - size / 2;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x0 - 3, y0 - 3, size + 6, size + 6);
    ctx.fillStyle = NAVY;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell + 0.3, cell + 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 8px "Courier New", monospace';
    ctx.fillText(code || '', cx, y0 + size + 4);
    ctx.restore();
  }

  function dateParts(cert, settings) {
    const p = GELB.splitDate(cert.date) || { dia: '', mes: '', ano: '' };
    const city = cert.city || settings.city || '';
    return { ...p, city, cityShort: city.split('-')[0].trim() };
  }

  function dateLine(cert, settings) {
    const d = dateParts(cert, settings);
    if (!d.dia) return d.city;
    return `${d.city ? d.city + ', ' : ''}${d.dia} de ${d.mes} de ${d.ano}.`;
  }

  function bodyText(cert, settings) {
    return (cert.customText || '').trim() || GELB.autoText({ ...cert, city: cert.city || settings.city }, settings.groupName);
  }

  function activeSigners(cert, settings) {
    const all = settings.signatories || [];
    if (!Array.isArray(cert.signers)) return all.filter((s) => s.enabled);
    return all.filter((s) => cert.signers.includes(s.id));
  }

  /** Bloco de assinatura: imagem (ou nome cursivo), linha, nome e cargo. y = topo do bloco. */
  function drawSignature(ctx, sig, img, cx, y, colW, opts = {}) {
    const imgH = opts.imgH || 44;
    const nameSize = opts.nameSize || 12;
    if (img) drawContain(ctx, img, cx - colW / 2, y, colW, imgH);
    else {
      ctx.fillStyle = NAVY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      fitFont(ctx, sig.name, 400, imgH * 0.6, "'Great Vibes', cursive", colW);
      ctx.fillText(sig.name, cx, y + imgH * 0.8);
    }
    let yy = y + imgH + 4;
    if (opts.line !== false) {
      ctx.fillStyle = 'rgba(51,65,85,0.85)';
      ctx.fillRect(cx - colW / 2, yy, colW, 1);
      yy += 4;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = NAVY;
    fitFont(ctx, sig.name.toUpperCase(), 700, nameSize, 'Montserrat, sans-serif', colW);
    ctx.fillText(sig.name.toUpperCase(), cx, yy);
    if (opts.role !== false && sig.role) {
      ctx.fillStyle = '#475569';
      fitFont(ctx, sig.role, 500, nameSize * 0.83, 'Montserrat, sans-serif', colW);
      ctx.fillText(sig.role, cx, yy + nameSize + 3);
    }
  }

  // ------------------------------------------------------------ layout padrão GELB

  const BORDER_STYLES = {
    'classic-gelb': { border: 14, color: NAVY, inner: GOLD, innerAt: 20, bg: ['#F8FAFC', '#FFFFFF', '#FFFBEB'] },
    'gold-honor': { border: 12, color: '#D97706', inner: '#FBBF24', innerAt: 18, bg: ['#FFFBEB', '#FFFFFF', '#FFFBEB'] },
    'scout-green': { border: 12, color: '#065F46', inner: '#F59E0B', innerAt: 18, bg: ['#ECFDF5', '#FFFFFF', '#FFFBEB'] },
    minimalist: { border: 8, color: '#1E3A8A', inner: null, bg: ['#FFFFFF', '#FFFFFF', '#FFFFFF'] },
  };

  async function drawStandard(ctx, cert, settings, env) {
    const st = BORDER_STYLES[cert.borderStyle] || BORDER_STYLES['classic-gelb'];
    const [logoL, logoR, flor] = await Promise.all([
      loadImage(settings.logoLeft || '/img/logo-gelb.svg'),
      loadImage(settings.logoRight),
      cert.showWatermark !== false ? loadImage('/img/flor-de-lis.svg') : null,
    ]);
    const signers = activeSigners(cert, settings);
    const sigImgs = await Promise.all(signers.map((s) => loadImage(s.image)));

    // Fundo e moldura
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, st.bg[0]);
    g.addColorStop(0.5, st.bg[1]);
    g.addColorStop(1, st.bg[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = st.border;
    ctx.strokeStyle = st.color;
    ctx.strokeRect(st.border / 2, st.border / 2, W - st.border, H - st.border);
    if (st.inner) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = st.inner;
      ctx.strokeRect(st.innerAt, st.innerAt, W - st.innerAt * 2, H - st.innerAt * 2);
      // cantoneiras
      ctx.lineWidth = 2;
      const c = 34;
      const L = 48;
      for (const [x, y, dx, dy] of [[c, c, 1, 1], [W - c, c, -1, 1], [c, H - c, 1, -1], [W - c, H - c, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * L, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * L);
        ctx.stroke();
      }
    }

    if (flor) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      drawContain(ctx, flor, W / 2 - 260, H / 2 - 260, 520, 520);
      ctx.restore();
    }

    const left = 62;
    const right = W - 62;

    // Cabeçalho
    drawContain(ctx, logoL, left, 62, 80, 80, 'left');
    let rightLogoW = 0;
    if (logoR) rightLogoW = drawContain(ctx, logoR, right - 140, 70, 140, 64, 'right');
    const tx = left + 96;
    const tMax = right - rightLogoW - 16 - tx;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = NAVY;
    letterSpacing(ctx, 1);
    const group = (settings.groupName || '').toUpperCase();
    fitFont(ctx, group, 700, 18, "Cinzel, serif", tMax);
    ctx.fillText(group, tx, 92);
    letterSpacing(ctx, 1.5);
    ctx.fillStyle = '#B45309';
    fitFont(ctx, 'GELB 32/SC • FUNDADO EM 1958 • BLUMENAU / SC', 600, 12, 'Montserrat, sans-serif', tMax);
    ctx.fillText('GELB 32/SC • FUNDADO EM 1958 • BLUMENAU / SC', tx, 112);
    letterSpacing(ctx, 0);
    ctx.fillStyle = '#64748B';
    fitFont(ctx, 'Reconhecido de Utilidade Pública • União dos Escoteiros do Brasil', 500, 11, 'Montserrat, sans-serif', tMax);
    ctx.fillText('Reconhecido de Utilidade Pública • União dos Escoteiros do Brasil', tx, 130);
    ctx.fillStyle = 'rgba(251,191,36,0.6)';
    ctx.fillRect(left, 158, right - left, 2);

    // Título
    ctx.textAlign = 'center';
    ctx.fillStyle = NAVY;
    letterSpacing(ctx, 2);
    const title = GELB.titleFor(cert).toUpperCase();
    fitFont(ctx, title, 900, 30, "'Cinzel Decorative', 'Playfair Display', serif", right - left - 40, 16);
    ctx.fillText(title, W / 2, 210);
    letterSpacing(ctx, 0);
    ctx.fillStyle = GOLD;
    ctx.fillRect(W / 2 - 96, 224, 192, 4);

    // Nome
    ctx.fillStyle = '#64748B';
    letterSpacing(ctx, 3);
    setFont(ctx, 600, 12, 'Montserrat, sans-serif');
    ctx.fillText('CONFERIDO A:', W / 2, 260);
    letterSpacing(ctx, 0);
    const name = cert.recipientName || (env.preview ? 'Nome do jovem' : '');
    ctx.fillStyle = cert.recipientName ? '#78350F' : '#CBD5E1';
    fitFont(ctx, name, 700, 36, "'Playfair Display', serif", 800, 18);
    ctx.fillText(name, W / 2, 304);
    const nw = Math.max(240, ctx.measureText(name).width + 64);
    ctx.fillStyle = '#FCD34D';
    ctx.fillRect(W / 2 - nw / 2, 316, nw, 2);
    if (cert.recipientRegistration) {
      setFont(ctx, 600, 12, 'Montserrat, sans-serif');
      ctx.fillStyle = NAVY;
      ctx.fillText(`Registro UEB nº: ${cert.recipientRegistration}`, W / 2, 338);
    }

    // Texto
    let size = 16;
    let lines;
    do {
      setFont(ctx, 500, size, 'Montserrat, sans-serif');
      lines = wrap(ctx, bodyText(cert, settings), 860);
      if (lines.length <= 5) break;
      size -= 1;
    } while (size > 11);
    const lh = size * 1.6;
    let y = 384;
    ctx.fillStyle = '#334155';
    for (const l of lines) {
      ctx.fillText(l, W / 2, y);
      y += lh;
    }
    setFont(ctx, 600, 14, 'Montserrat, sans-serif');
    ctx.fillStyle = NAVY;
    ctx.fillText(dateLine(cert, settings), W / 2, y + 12);
    y += 12;

    // Emblemas
    const emblemY = Math.max(y + 40, 560);
    if (cert.category === 'Promessas') {
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(W / 2, emblemY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      if (flor) {
        ctx.save();
        ctx.filter = 'brightness(0) invert(1)';
        drawContain(ctx, flor, W / 2 - 13, emblemY - 15, 26, 30);
        ctx.restore();
      }
    }
    if (cert.category === 'Atividade') {
      const n = Math.max(1, Math.min(parseInt(cert.quantidadeAnos, 10) || 1, 6));
      for (let i = 0; i < n; i++) star(ctx, W / 2 + (i - (n - 1) / 2) * 30, emblemY, 12, '#F59E0B');
    }

    // Assinaturas (deixam espaço para o QR Code no canto)
    const showQr = cert.showQr !== false && env.qrUrl;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(left, 600, right - left, 1);
    if (signers.length) {
      const avail = right - left - (showQr ? 200 : 40);
      const gap = 48;
      const colW = Math.min(208, (avail - gap * (signers.length - 1)) / signers.length);
      const total = colW * signers.length + gap * (signers.length - 1);
      signers.forEach((s, i) => drawSignature(ctx, s, sigImgs[i], W / 2 - total / 2 + colW / 2 + i * (colW + gap), 614, colW));
    }
    if (showQr) drawQr(ctx, env.qrUrl, cert.code, right - 36, 664, 66);
  }

  // ------------------------------------------------------------ modelo com arte (PDF/imagem enviada)

  const PLACEHOLDERS = {
    nome: 'Nome do jovem',
    registro: 'Registro UEB nº 000000-0',
    responsaveis: 'Nome dos responsáveis',
    etapa: 'Etapa de progressão',
    grupo: 'Grupo Escoteiro',
    cidade: 'Cidade',
    dia: 'Dia',
    mes: 'Mês',
    ano: 'Ano',
    data: 'Cidade, dia de mês de ano.',
  };

  function fieldText(key, cert, settings) {
    const d = dateParts(cert, settings);
    switch (key) {
      case 'nome': return cert.recipientName || '';
      case 'registro': return cert.recipientRegistration ? `Registro UEB nº ${cert.recipientRegistration}` : '';
      case 'responsaveis': return cert.responsaveis || '';
      case 'etapa': return cert.progressionStage || '';
      case 'grupo': return settings.groupName || '';
      case 'cidade': return d.cityShort;
      case 'dia': return d.dia;
      case 'mes': return d.mes;
      case 'ano': return d.ano;
      case 'data': return d.dia ? dateLine(cert, settings) : '';
      case 'titulo': return GELB.titleFor(cert).toUpperCase();
      default: return '';
    }
  }

  /** Retângulo ocupado por cada campo (em unidades da página) — usado pelo editor de posições. */
  function fieldBox(key, f) {
    const x = (f.x / 100) * W;
    const y = (f.y / 100) * H;
    const w = (f.w / 100) * W;
    if (key === 'qr') return { x: x - f.size / 2, y: y - f.size / 2, w: f.size, h: f.size + 12 };
    if (key === 'assinatura1' || key === 'assinatura2') return { x: x - w / 2, y: y - f.size * 4 - f.size - 6, w, h: f.size * 5 + 8 };
    if (key === 'assinaturas') return { x: x - w / 2, y: y - f.size * 3, w, h: f.size * 6 + 10 };
    if (key === 'texto') return { x: x - w / 2, y: y - f.size * 2.4, w, h: f.size * 4.8 };
    const bx = f.align === 'center' ? x - w / 2 : x;
    return { x: bx, y: y - f.size * 0.9, w, h: f.size * 1.3 };
  }

  async function drawTemplate(ctx, cert, settings, env) {
    const tpl = env.template;
    const layout = GELB.normalizeLayout(tpl.layout);
    if (tpl.builtin && tpl.id === 'acolhida-padrao') drawAcolhidaArt(ctx);
    else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      const bg = await loadImage(`/api/templates/${tpl.id}/image?v=${encodeURIComponent(tpl.version || '')}`);
      if (bg) ctx.drawImage(bg, 0, 0, W, H);
    }

    const signers = activeSigners(cert, settings);
    const sigImgs = await Promise.all(signers.map((s) => loadImage(s.image)));
    const font = layout.font || "'Montserrat', sans-serif";
    const color = layout.color || NAVY;

    for (const [key, f] of Object.entries(layout.fields)) {
      if (!f.on) continue;
      const x = (f.x / 100) * W;
      const y = (f.y / 100) * H;
      const w = (f.w / 100) * W;
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 1;

      if (key === 'qr') {
        ctx.shadowColor = 'transparent';
        if (cert.showQr !== false) drawQr(ctx, env.qrUrl, cert.code, x, y, f.size);
      } else if (key === 'assinatura1' || key === 'assinatura2') {
        const i = key === 'assinatura1' ? 0 : 1;
        if (signers[i]) drawSignature(ctx, signers[i], sigImgs[i], x, y - f.size * 4 - f.size - 6, w, { imgH: f.size * 4, nameSize: f.size, line: false, role: false });
      } else if (key === 'assinaturas') {
        if (signers.length) {
          const gap = 40;
          const colW = Math.min(200, (w - gap * (signers.length - 1)) / signers.length);
          const total = colW * signers.length + gap * (signers.length - 1);
          signers.forEach((s, j) => drawSignature(ctx, s, sigImgs[j], x - total / 2 + colW / 2 + j * (colW + gap), y - f.size * 3, colW, { imgH: f.size * 3.6, nameSize: f.size }));
        }
      } else if (key === 'texto') {
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        setFont(ctx, 500, f.size, font);
        const lines = wrap(ctx, bodyText(cert, settings), w);
        const lh = f.size * 1.5;
        lines.forEach((l, j) => ctx.fillText(l, x, y + (j - (lines.length - 1) / 2) * lh));
      } else {
        let text = fieldText(key, cert, settings);
        if (!text && env.preview && PLACEHOLDERS[key]) {
          text = PLACEHOLDERS[key];
          ctx.globalAlpha = 0.35;
        }
        if (text) {
          ctx.fillStyle = color;
          ctx.textAlign = f.align === 'center' ? 'center' : 'left';
          ctx.textBaseline = 'alphabetic';
          fitFont(ctx, text, key === 'nome' || key === 'titulo' ? 700 : 600, f.size, font, w);
          ctx.fillText(text, x, y + f.size * 0.19);
        }
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ arte do modelo padrão "Acolhida dos Filhotes"

  function drawAcolhidaArt(ctx) {
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    const shape = (color, fn) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      fn();
      ctx.closePath();
      ctx.fill();
    };
    shape('#E65100', () => { ctx.moveTo(0, 0); ctx.lineTo(340, 0); ctx.bezierCurveTo(310, 45, 260, 70, 180, 65); ctx.bezierCurveTo(110, 60, 50, 95, 0, 115); });
    shape('#2E7D32', () => { ctx.moveTo(290, 0); ctx.lineTo(650, 0); ctx.bezierCurveTo(620, 55, 540, 75, 460, 60); ctx.bezierCurveTo(390, 48, 330, 65, 290, 0); });
    shape('#5D4037', () => { ctx.moveTo(610, 0); ctx.lineTo(880, 0); ctx.bezierCurveTo(860, 45, 800, 70, 740, 65); ctx.bezierCurveTo(680, 60, 635, 35, 610, 0); });
    shape('#C62828', () => { ctx.moveTo(850, 0); ctx.lineTo(1122, 0); ctx.lineTo(1122, 130); ctx.bezierCurveTo(1060, 110, 1010, 70, 960, 65); ctx.bezierCurveTo(900, 60, 870, 30, 850, 0); });
    shape('#2E7D32', () => { ctx.moveTo(1122, 190); ctx.bezierCurveTo(1080, 230, 1080, 310, 1122, 350); });
    shape('#E65100', () => { ctx.moveTo(1122, 330); ctx.bezierCurveTo(1090, 370, 1090, 440, 1122, 470); });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 52px Fredoka, Nunito, "Arial Rounded MT Bold", sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillText('CERTIFICADO DE ACOLHIDA', 563, 172);
    const tg = ctx.createLinearGradient(320, 170, 800, 170);
    tg.addColorStop(0, '#E65100');
    tg.addColorStop(0.35, '#2E7D32');
    tg.addColorStop(0.7, '#5D4037');
    tg.addColorStop(1, '#C62828');
    ctx.fillStyle = tg;
    ctx.fillText('CERTIFICADO DE ACOLHIDA', 561, 170);

    const line = (x1, y, x2) => { ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); };
    ctx.textAlign = 'left';
    ctx.fillStyle = '#263238';
    ctx.font = '600 20px Nunito, "Segoe UI", sans-serif';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.6;
    ctx.fillText('Certificamos que o (a) filhote,', 220, 252);
    line(476, 255, 890);
    ctx.fillText('acompanhado (a) dos responsáveis', 220, 290);
    line(520, 293, 890);
    ctx.fillText('realizaram sua Cerimônia de Acolhida, passando a fazer parte da nossa', 220, 328);
    ctx.fillText('Ninhada do Grupo Escoteiro', 220, 366);
    line(465, 369, 875);
    ctx.fillText('.', 880, 366);

    ctx.textAlign = 'center';
    ctx.font = '600 19px Nunito, "Segoe UI", sans-serif';
    ctx.fillStyle = '#334155';
    line(310, 445, 460);
    ctx.fillText(',', 475, 442);
    line(490, 445, 540);
    ctx.fillText('de', 565, 442);
    line(585, 445, 725);
    ctx.fillText('de', 745, 442);
    line(765, 445, 845);

    line(310, 535, 500);
    line(610, 535, 800);
    ctx.font = 'bold 13px Nunito, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Diretoria Executiva / GELB', 405, 555);
    ctx.fillText('Chefe da Seção / Filhotes', 705, 555);

    // esquilos
    const ell = (c, x, y, rx, ry, rot) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill(); };
    const dot = (c, x, y, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    ell('#81C784', 140, 760, 160, 75, 0);
    ell('#A0522D', 135, 690, 32, 45, -0.2);
    ell('#F5DEB3', 145, 695, 18, 30, -0.1);
    dot('#A0522D', 155, 640, 24);
    shape('#A0522D', () => { ctx.moveTo(145, 622); ctx.lineTo(152, 605); ctx.lineTo(158, 622); });
    shape('#A0522D', () => { ctx.moveTo(160, 622); ctx.lineTo(168, 608); ctx.lineTo(172, 625); });
    dot('#212121', 162, 638, 3.5);
    dot('#3E2723', 172, 644, 3);
    shape('#8D4018', () => { ctx.moveTo(110, 720); ctx.bezierCurveTo(70, 700, 60, 610, 105, 595); ctx.bezierCurveTo(125, 590, 130, 625, 120, 655); ctx.bezierCurveTo(115, 675, 120, 705, 125, 715); });
    ell('#B86834', 195, 712, 18, 26, 0.15);
    ell('#F5DEB3', 190, 715, 10, 16, 0.1);
    dot('#B86834', 190, 680, 15);
    dot('#212121', 186, 679, 2.5);
    shape('#A0522D', () => { ctx.moveTo(210, 725); ctx.bezierCurveTo(230, 715, 235, 680, 218, 670); ctx.bezierCurveTo(210, 680, 210, 710, 205, 725); });

    // selos
    const badge = (x, w) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#E0E0E0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, 655, w, 80, 12);
      else ctx.rect(x, 655, w, 80);
      ctx.fill();
      ctx.stroke();
    };
    badge(895, 95);
    ctx.font = '900 17px Nunito, sans-serif';
    ctx.fillStyle = '#E65100';
    ctx.fillText('FILHOTES', 942, 695);
    ctx.font = 'bold 9px Nunito, sans-serif';
    ctx.fillStyle = '#2E7D32';
    ctx.fillText('RAMO ESCOTEIRO', 942, 712);
    badge(1005, 85);
    ctx.fillStyle = '#1B5E20';
    ctx.font = 'bold 22px serif';
    ctx.fillText('⚜', 1047, 690);
    ctx.font = 'bold 8px Nunito, sans-serif';
    ctx.fillText('ESCOTEIROS', 1047, 710);
    ctx.fillText('DO BRASIL', 1047, 720);
    ctx.restore();
  }

  // ------------------------------------------------------------ entrada principal

  /**
   * Desenha o certificado no canvas.
   * env: { settings, template (ou null para o layout padrão), preview, qrUrl }
   */
  async function draw(canvas, cert, env, scale = 1) {
    await ensureFonts();
    const settings = { ...DEFAULT_SETTINGS, ...(env.settings || {}) };
    if (!Array.isArray(settings.signatories)) settings.signatories = DEFAULT_SETTINGS.signatories;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    if (env.template) await drawTemplate(ctx, cert, settings, env);
    else await drawStandard(ctx, cert, settings, env);
    return canvas;
  }

  window.GELBRender = { W, H, draw, loadImage, ensureFonts, fieldBox, DEFAULT_SETTINGS };
})();
