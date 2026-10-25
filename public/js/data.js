/* Dados fixos do gerador: categorias, modelos, textos automáticos e campos dos modelos com arte. */
(function () {
  const CATEGORIES = {
    'Progressão': ['Acolhida', 'Progressão Filhotes', 'Progressão Lobinho', 'Progressão Escoteiro', 'Progressão Sênior', 'Progressão Pioneiro'],
    'Especialidades': ['Especialidade Lobinho', 'Especialidade Escoteiro', 'Especialidade Sênior', 'Especialidade Pioneiro'],
    'Promessas': ['Promessa (Lobinho)', 'Promessa (Geral)'],
    'Insígnias de Modalidade': ['Insígnia do Aviador', 'Insígnia do Aeronauta', 'Insígnia do Grumete', 'Insígnia Naval'],
    'Interesse Especial': ['Insígnia Cone Sul', 'Insígnia da Lusofonia', 'Insígnia Reduzir, Reciclar, Reutilizar', 'Escoteiros pela Energia Solar', 'Campeões da Natureza'],
    'Monitoria': ['Monitor (Sênior)', 'Sub-monitor (Sênior)', 'Monitor (Escoteiro)', 'Sub-monitor (Escoteiro)', 'Primo', 'Segundo'],
    'Atividade': ['Estrela de Atividade'],
    'Expansão': ['Recrutador', 'Semeador'],
    'Eventos e Cursos': ['Participação', 'Conclusão de Curso', 'Honra ao Mérito'],
  };

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /** Campos extras que aparecem no formulário conforme a categoria. */
  const EXTRA_FIELDS = {
    'Progressão': ['responsaveis', 'progressionStage'],
    'Especialidades': ['nomeEspecialidade', 'nivelConquistado', 'itensCompletados'],
    'Interesse Especial': ['ramo'],
    'Monitoria': ['matilhaPatrulha'],
    'Atividade': ['quantidadeAnos'],
    'Expansão': ['quantidadeNovosMembros'],
    'Eventos e Cursos': ['eventName', 'workloadHours', 'startDate', 'endDate'],
  };

  const FIELD_LABELS = {
    responsaveis: { label: 'Nome dos responsáveis (pais)', placeholder: 'Ex.: Carlos Silva e Maria Schmidt' },
    progressionStage: { label: 'Etapa de progressão', placeholder: 'Ex.: Acolhida dos Filhotes, Lobo Saltador, Pista, Rumo' },
    nomeEspecialidade: { label: 'Nome da especialidade', placeholder: 'Ex.: Radioamadorismo' },
    nivelConquistado: { label: 'Nível conquistado', options: ['1', '2', '3'] },
    itensCompletados: { label: 'Itens completados (opcional)', placeholder: 'Ex.: 1, 3, 5 e 8' },
    ramo: { label: 'Ramo (opcional)', placeholder: 'Ex.: Lobinho, Escoteiro' },
    matilhaPatrulha: { label: 'Matilha / Patrulha (opcional)', placeholder: 'Ex.: Preta, Xavante' },
    quantidadeAnos: { label: 'Quantos anos de atividade?', placeholder: 'Ex.: 2', type: 'number' },
    quantidadeNovosMembros: { label: 'Quantos novos membros trouxe? (opcional)', placeholder: 'Ex.: 3', type: 'number' },
    eventName: { label: 'Nome do evento ou curso', placeholder: 'Ex.: Acampamento de Grupo 2026' },
    workloadHours: { label: 'Carga horária em horas (opcional)', placeholder: 'Ex.: 16', type: 'number' },
    startDate: { label: 'Início (opcional)', type: 'date' },
    endDate: { label: 'Fim (opcional)', type: 'date' },
  };

  function formatDate(iso, withCity) {
    const p = splitDate(iso);
    if (!p) return '';
    return `${p.dia} de ${p.mes} de ${p.ano}`;
  }

  function splitDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return { dia: String(Number(m[3])), mes: MONTHS[Number(m[2]) - 1] || '', ano: m[1] };
  }

  function ramoFromModel(model) {
    for (const r of ['Lobinho', 'Escoteiro', 'Sênior', 'Pioneiro']) if ((model || '').includes(r)) return r;
    return '';
  }

  /** Título grande do certificado. */
  function titleFor(c) {
    if (c.category === 'Eventos e Cursos') {
      return { 'Participação': 'Certificado de Participação', 'Conclusão de Curso': 'Certificado de Conclusão', 'Honra ao Mérito': 'Certificado de Honra ao Mérito' }[c.model] || 'Certificado';
    }
    return c.model || 'Certificado';
  }

  /** Texto automático do certificado (o mesmo do app original, por categoria). */
  function autoText(c, groupName) {
    const g = groupName || 'Grupo Escoteiro Leões de Blumenau - GELB 32/SC';
    switch (c.category) {
      case 'Progressão': {
        let t = `${g} confere o certificado de ${c.model || 'Progressão Escoteira'}`;
        if (c.progressionStage) t += ` (etapa de ${c.progressionStage})`;
        t += ', em reconhecimento à sua evolução, aprendizado e participação exemplar no Movimento Escoteiro.';
        if (c.responsaveis) t += ` Agradecemos aos responsáveis (${c.responsaveis}) pelo apoio contínuo.`;
        return t;
      }
      case 'Especialidades': {
        const itens = c.itensCompletados ? ` (itens completados: ${c.itensCompletados})` : '';
        return `${g} certifica a conquista da especialidade de ${c.nomeEspecialidade || 'Especialidade Escoteira'} - Nível ${c.nivelConquistado || '1'}${itens}, em reconhecimento ao cumprimento de todos os requisitos exigidos.`;
      }
      case 'Promessas':
        return `${g} certifica a realização solene da Promessa Escoteira, em compromisso de cumprir os deveres para com Deus e a Pátria, ajudar o próximo e obedecer à Lei Escoteira.`;
      case 'Insígnias de Modalidade':
        return `${g} confere a ${c.model}, celebrando a dedicação e conhecimento técnico nas atividades escoteiras especializadas.`;
      case 'Interesse Especial': {
        const r = c.ramo ? ` do ramo ${c.ramo}` : '';
        return `${g} certifica a conquista da ${c.model}${r}, demonstrando engajamento socioambiental e espírito cidadão.`;
      }
      case 'Monitoria': {
        const mp = c.matilhaPatrulha ? ` na Matilha/Patrulha ${c.matilhaPatrulha}` : '';
        return `${g} certifica o desempenho com responsabilidade e liderança na função de ${c.model}${mp}.`;
      }
      case 'Atividade':
        return `${g} confere a Estrela de Atividade correspondente a ${c.quantidadeAnos || '1'} ano(s) de dedicação, assiduidade e espírito de servir.`;
      case 'Expansão': {
        const m = c.quantidadeNovosMembros ? ` por trazer ${c.quantidadeNovosMembros} novo(s) membro(s) para o escotismo` : '';
        return `${g} certifica a conquista do distintivo de ${c.model}${m}, contribuindo para o crescimento do Movimento Escoteiro.`;
      }
      case 'Eventos e Cursos': {
        const ev = c.eventName || 'atividade oficial do GELB';
        const local = c.city || 'Blumenau - SC';
        const horas = c.workloadHours ? `, com carga horária total de ${c.workloadHours} horas` : '';
        const periodo = c.startDate && c.endDate ? ` no período de ${formatDate(c.startDate)} a ${formatDate(c.endDate)}` : '';
        if (c.model === 'Conclusão de Curso') {
          return `Certificamos a conclusão com êxito de ${ev}, promovido pelo ${g}${periodo}${horas}, cumprindo integralmente as diretrizes do plano de formação.`;
        }
        if (c.model === 'Honra ao Mérito') {
          return `${g} outorga este Certificado de Honra ao Mérito em reconhecimento aos relevantes serviços prestados, liderança exemplar e inestimável dedicação ao fortalecimento do GELB 32/SC e da juventude blumenauense.`;
        }
        return `Certificamos a participação em ${ev}, realizado(a) em ${local}${periodo}${horas}, demonstrando espírito escoteiro, dedicação e compromisso com a Promessa e a Lei Escoteira.`;
      }
      default:
        return `${g} certifica a participação ativa na atividade ${c.model || 'oficial GELB'}, realizada em ${c.city || 'Blumenau - SC'}.`;
    }
  }

  /**
   * Campos que podem ser colocados sobre a arte de um modelo.
   * x, y e w em % da página; size em pontos da página (1122 x 793).
   */
  const TEMPLATE_FIELDS = {
    nome: 'Nome do jovem',
    registro: 'Registro UEB',
    responsaveis: 'Responsáveis',
    etapa: 'Etapa de progressão',
    grupo: 'Grupo Escoteiro',
    cidade: 'Cidade',
    dia: 'Dia',
    mes: 'Mês',
    ano: 'Ano',
    data: 'Cidade e data completas',
    titulo: 'Título',
    texto: 'Texto do certificado',
    assinatura1: 'Assinatura 1',
    assinatura2: 'Assinatura 2',
    assinaturas: 'Todas as assinaturas (lado a lado)',
    qr: 'QR Code de autenticidade',
  };

  const f = (on, x, y, size, align, w) => ({ on, x, y, size, align, w });

  /** "Preencher linhas": nome, pais, etapa, grupo e data sobre as linhas pré-impressas (Acolhida). */
  function presetLinhas() {
    return {
      preset: 'linhas',
      font: "'Montserrat', sans-serif",
      color: '#0F2C59',
      fields: {
        nome: f(true, 43, 31.8, 22, 'left', 40),
        registro: f(false, 43, 28.5, 12, 'left', 30),
        responsaveis: f(true, 46.5, 36.2, 17, 'left', 32),
        etapa: f(false, 44, 40.5, 17, 'left', 34),
        grupo: f(true, 41.5, 44.8, 17, 'left', 36),
        cidade: f(true, 34.2, 54.8, 15, 'center', 14),
        dia: f(true, 44.8, 54.8, 15, 'center', 5),
        mes: f(true, 55.5, 54.8, 15, 'center', 13),
        ano: f(true, 67.5, 54.8, 15, 'center', 8),
        data: f(false, 50, 68, 15, 'center', 60),
        titulo: f(false, 50, 20, 30, 'center', 80),
        texto: f(false, 50, 45, 16, 'center', 70),
        assinatura1: f(true, 35.5, 66, 10, 'center', 24),
        assinatura2: f(true, 62.5, 66, 10, 'center', 24),
        assinaturas: f(false, 50, 82, 11, 'center', 80),
        qr: f(false, 91, 85, 60, 'center', 8),
      },
    };
  }

  /** "Nome centralizado": estilo diploma, nome grande no meio da arte. */
  function presetCentro() {
    return {
      preset: 'centro',
      font: "'Playfair Display', serif",
      color: '#0F2C59',
      fields: {
        nome: f(true, 50, 52, 36, 'center', 76),
        registro: f(true, 50, 57, 12, 'center', 50),
        responsaveis: f(false, 50, 61, 16, 'center', 60),
        etapa: f(false, 50, 64, 16, 'center', 60),
        grupo: f(false, 50, 47, 16, 'center', 60),
        cidade: f(false, 34.2, 70, 15, 'center', 14),
        dia: f(false, 44.8, 70, 15, 'center', 5),
        mes: f(false, 55.5, 70, 15, 'center', 13),
        ano: f(false, 67.5, 70, 15, 'center', 8),
        data: f(true, 50, 68, 15, 'center', 60),
        titulo: f(false, 50, 20, 30, 'center', 80),
        texto: f(false, 50, 40, 16, 'center', 70),
        assinatura1: f(false, 35.5, 86, 10, 'center', 24),
        assinatura2: f(false, 62.5, 86, 10, 'center', 24),
        assinaturas: f(false, 50, 82, 11, 'center', 80),
        qr: f(false, 91, 85, 60, 'center', 8),
      },
    };
  }

  /** Completa um layout salvo com o preset de origem (para campos novos/ausentes). */
  function normalizeLayout(layout) {
    const base = layout && layout.preset === 'centro' ? presetCentro() : presetLinhas();
    const out = { ...base, ...(layout || {}), fields: { ...base.fields } };
    for (const k of Object.keys(base.fields)) {
      if (layout && layout.fields && layout.fields[k]) out.fields[k] = { ...base.fields[k], ...layout.fields[k] };
    }
    return out;
  }

  const FONTS = [
    ["'Montserrat', sans-serif", 'Montserrat (moderna)'],
    ["'Playfair Display', serif", 'Playfair Display (elegante)'],
    ["'Nunito', sans-serif", 'Nunito (arredondada)'],
    ["'Cinzel', serif", 'Cinzel (clássica)'],
    ["'Merriweather', serif", 'Merriweather (serifada)'],
    ["'Great Vibes', cursive", 'Great Vibes (caligrafia)'],
    ["'Dancing Script', cursive", 'Dancing Script (manuscrita)'],
  ];

  const COLORS = [
    ['#0F2C59', 'Azul-marinho GELB'],
    ['#1E293B', 'Grafite'],
    ['#000000', 'Preto'],
    ['#1D4ED8', 'Azul caneta'],
    ['#92400E', 'Dourado escuro'],
  ];

  const BORDERS = [
    ['classic-gelb', 'Clássica GELB (azul e dourado)'],
    ['gold-honor', 'Dourada (honra)'],
    ['scout-green', 'Verde escoteiro'],
    ['minimalist', 'Simples (azul)'],
  ];

  window.GELB = { CATEGORIES, MONTHS, EXTRA_FIELDS, FIELD_LABELS, TEMPLATE_FIELDS, FONTS, COLORS, BORDERS, formatDate, splitDate, ramoFromModel, titleFor, autoText, presetLinhas, presetCentro, normalizeLayout };
})();
