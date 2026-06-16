// =====================================================
// VITALE — Core (lógica principal) — v4.2 BLOCO D (grafico IMC)
// Inclui: Bloco A (health_profile + onboarding 5 telas)
//       + Bloco A.1: tela 6 Objetivos, urgência, metas auto
//       + Bloco A.2: filtro de data (dashboard + histórico),
//                    seleção múltipla + exclusão em lote,
//                    fix onboarding (reabrir), selo de versão
//       + Fix: múltiplos pesos/dia (média diária via view)
//       + Fix: cache 5min Coach IA
//       + Fix: compressão de imagem antes do OCR
// =====================================================

const VITALE_VERSION = 'v4.4 · Bloco Cerebro-IA · 2026-06-16';

const VITALE_CORE = {
  VERSION: VITALE_VERSION,
  state: {
    profile: null,
    healthProfile: null,
    weights: [],          // média diária (1 ponto/dia) — vista
    weightsRaw: [],       // todos os registros individuais (histórico)
    medicacoes: [],
    submetas: [],
    horarios: [],
    diaSemana: null,
    diasEsp: [],
    tempImportacao: null,
    chartInstance: null,
    imcChartInstance: null,
    moodChartInstance: null,
    medidasChartInstance: null,
    composicaoChartInstance: null,
    coachCache: null,     // {message, when} — cache de 5min do Coach IA
    objetivoEscolhido: null,  // estado temporário do wizard
    moodHoje: null,       // registro de hoje (Bloco B)
    moodDraft: { humor: 0, energia: 0, sono: 0, nota: '' }, // seleção em edição
    conquistas: [],       // badges desbloqueados (Bloco Gamificação)
    exercicios: [],       // atividades físicas registradas (Bloco Exercícios)
    medidas: [],          // medidas corporais de fita (Bloco Medidas)
    composicao: [],       // composição corporal / bioimpedância (Bloco Composição)
    refeicoes: []         // refeições do dia (Fase A — Alimentação)
  },

  // =====================================================
  // INIT
  // =====================================================
  async init() {
    try {
      const user = await window.VitaleAuth.requireAuth();
      if (!user) return;

      // Carrega tudo em paralelo MAS de forma resiliente: cada loader que
      // falhar cai no seu próprio fallback em vez de derrubar o app inteiro.
      // allSettled nunca rejeita — então um erro de RLS/view num recurso
      // não impede os demais de carregar.
      const results = await Promise.allSettled([
        window.VitaleAuth.getProfile(),
        this.loadWeights(),
        this.loadWeightsRaw(),
        this.loadMedicacoes(),
        this.loadSubmetas(),
        this.loadHealthProfile(),
        this.loadMoodHoje(),
        this.loadConquistas(),
        this.loadExercicios(),
        this.loadMedidas(),
        this.loadComposicao(),
        this.loadRefeicoesHoje(),
        this.loadDoses(),
        this.loadEfeitos(),
        this.loadMemoria()
      ]);

      const nomes = ['profile', 'weights', 'weightsRaw', 'medicacoes', 'submetas', 'healthProfile', 'moodHoje', 'conquistas', 'exercicios', 'medidas', 'composicao', 'refeicoes', 'doses', 'efeitos', 'memoria'];
      const fallbacks = [null, [], [], [], [], null, null, [], [], [], [], [], [], [], []];
      const falhas = [];
      const val = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        falhas.push(`${nomes[i]}: ${r.reason?.message || r.reason}`);
        console.error(`[VITALE] loader "${nomes[i]}" falhou:`, r.reason);
        if (window.VitaleErr) window.VitaleErr.log('loader_' + nomes[i], r.reason);
        return fallbacks[i];
      });

      this.state.profile = val[0];
      this.state.weights = val[1] || [];
      this.state.weightsRaw = val[2] || [];
      this.state.medicacoes = val[3] || [];
      this.state.submetas = val[4] || [];
      this.state.healthProfile = val[5];
      this.state.moodHoje = val[6];
      this.state.conquistas = val[7] || [];
      this.state.exercicios = val[8] || [];
      this.state.medidas = val[9] || [];
      this.state.composicao = val[10] || [];
      this.state.refeicoes = val[11] || [];
      this.state.doses = val[12] || [];
      this.state.efeitos = val[13] || [];
      this.state.memoria = val[14] || [];

      // Feature flags — também isolado
      try { await window.VitaleFlags.applyToUI(); } catch (e) { console.warn('[VITALE] flags falharam:', e); }

      // Render UI (cada um protegido para não cascatear)
      try { this.renderHeader(); } catch (e) { console.warn('renderHeader', e); }
      try { this.updateDashboard(); } catch (e) { console.warn('updateDashboard', e); }
      try { this.updateAgendamentos(); } catch (e) { console.warn('updateAgendamentos', e); }
      try { this.fillHealthProfileForm(); } catch (e) { console.warn('fillHealthProfileForm', e); }
      try { this.renderMoodCard(); } catch (e) { console.warn('renderMoodCard', e); }
      try { this.renderMoodHistorico(); } catch (e) { console.warn('renderMoodHistorico', e); }
      try { this.renderConquistas(); } catch (e) { console.warn('renderConquistas', e); }
      // Checa conquistas no load (sem celebrar as antigas — só registra novas em silêncio na 1ª vez)
      try { this.checkConquistas(true); } catch (e) { console.warn('checkConquistas', e); }
      try { this.renderExercicios(); } catch (e) { console.warn('renderExercicios', e); }
      try { this.renderMedidas(); } catch (e) { console.warn('renderMedidas', e); }
      try { this.buildMedidasChart(); } catch (e) { console.warn('buildMedidasChart', e); }
      try { this.renderComposicao(); } catch (e) { console.warn('renderComposicao', e); }
      try { this.renderHistoricoCompleto(); } catch (e) { console.warn('renderHistoricoCompleto', e); }
      try { this.renderRefeicoes(); } catch (e) { console.warn('renderRefeicoes', e); }
      try { this.renderBalancoCalorico(); } catch (e) { console.warn('renderBalancoCalorico', e); }
      try { this.buildComposicaoChart(); } catch (e) { console.warn('buildComposicaoChart', e); }
      try { this.renderBadgeResumo(); } catch (e) { console.warn('renderBadgeResumo', e); }

      try { window.VitaleAnalytics.track('app_open'); } catch (e) {}

      // Esconde loader
      const loader = document.getElementById('initLoader');
      if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 500); }

      // Se houve falhas parciais, mostra QUAIS na tela (no celular não há console)
      if (falhas.length) {
        this.showAlert('error', '⚠️ Alguns dados não carregaram (' + falhas.length + '). Detalhe: ' + falhas[0]);
      }

      // Primeiro acesso → onboarding
      if ((!val[0]?.altura || val[0].altura === 1.70) && this.state.weights.length === 0) {
        this.showOnboarding();
      }

      // Coach IA via API (com fallback determinístico)
      setTimeout(() => this.generateCoachMessageAI(), 1000);

      // Walkthrough: mostra o tour no primeiro acesso (se ainda não viu e não está no onboarding)
      const jaViuTour = this.state.healthProfile?.tour_visto;
      const emOnboarding = document.getElementById('modalOnboarding')?.classList.contains('active');
      if (!jaViuTour && !emOnboarding) {
        setTimeout(() => this.iniciarTour(), 1800);
      }
      // Dica diária da IA
      setTimeout(() => this.renderDicaDiaria(), 2500);
    } catch (e) {
      console.error('[VITALE] init error:', e);
      if (window.VitaleErr) window.VitaleErr.log('app_init', e);
      // Mostra a mensagem REAL do erro (no celular é a única forma de diagnosticar)
      this.showAlert('error', 'Erro ao carregar: ' + (e?.message || e) + ' — recarregue a página.');
      const loader = document.getElementById('initLoader');
      if (loader) loader.remove();
    }
  },

  // =====================================================
  // DATABASE LOADERS
  // =====================================================
  // weights = MÉDIA DIÁRIA por data (vinda da view weight_daily).
  // O state guarda 1 ponto por dia (média), pra gráfico/IMC limpos.
  // Cada ponto vem com .registros_dia indicando quantas pesagens
  // existem naquele dia. Os registros individuais ficam em
  // state.weightsRaw, carregados sob demanda no Histórico.
  async loadWeights() {
    const { data, error } = await window.sb
      .from('weight_daily')
      .select('data, peso, registros_dia')
      .order('data', { ascending: true });
    if (error) throw error;
    return (data || []).map(w => ({
      date: w.data,
      peso: parseFloat(w.peso),
      registros_dia: w.registros_dia
    }));
  },

  // Carrega registros individuais (todas as pesagens, mesmo do mesmo dia)
  async loadWeightsRaw() {
    const { data, error } = await window.sb
      .from('weights')
      .select('id, data, hora, peso, origem, created_at')
      .order('data', { ascending: false })
      .order('hora', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(w => ({
      id: w.id,
      date: w.data,
      hora: w.hora,
      peso: parseFloat(w.peso),
      origem: w.origem,
      createdAt: w.created_at
    }));
  },

  async loadMedicacoes() {
    const { data, error } = await window.sb
      .from('medicacoes')
      .select('*')
      .eq('ativo', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async loadSubmetas() {
    const { data, error } = await window.sb
      .from('submetas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(s => ({
      id: s.id,
      nome: s.nome,
      pesoAlvo: parseFloat(s.peso_alvo),
      dataAlvo: s.data_alvo,
      icone: s.icone,
      atingida: s.atingida
    }));
  },

  async loadHealthProfile() {
    try {
      const user = await window.VitaleAuth.getUser();
      if (!user) return null;
      const { data, error } = await window.sb
        .from('health_profile')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('Health profile error:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('Health profile load failed:', e);
      return null;
    }
  },

  // =====================================================
  // UTILS
  // =====================================================
  calcIMC(kg, h) { return (kg / (h * h)).toFixed(1); },

  getObesidadeInfo(imc) {
    const v = parseFloat(imc);
    if (v < 18.5) return { grau: 'Baixo Peso', color: '#4a9de8' };
    if (v < 25) return { grau: 'Peso Normal', color: '#27c47d' };
    if (v < 30) return { grau: 'Sobrepeso', color: '#d4a843' };
    if (v < 35) return { grau: 'Obesidade Grau I', color: '#e8924a' };
    if (v < 40) return { grau: 'Obesidade Grau II', color: '#e8504a' };
    return { grau: 'Obesidade Grau III', color: '#c040c0' };
  },

  fmt(s) { return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); },
  fmtLong(d) { return d instanceof Date ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; },
  fmtStr(s) { return s ? this.fmtLong(new Date(s + 'T12:00:00')) : '—'; },
  getSorted() { return [...this.state.weights].sort((a, b) => new Date(a.date) - new Date(b.date)); },

  get altura() { return this.state.profile?.altura || 1.70; },
  get metaKg() { return 30 * this.altura * this.altura; },

  // =====================================================
  // HEADER
  // =====================================================
  renderHeader() {
    const profile = this.state.profile;
    if (!profile) return;
    const nameEl = document.getElementById('headerUserName');
    const avatarEl = document.getElementById('headerUserAvatar');
    if (nameEl) nameEl.textContent = profile.nome || profile.email?.split('@')[0] || 'Usuário';
    if (avatarEl) {
      const initial = (profile.nome || profile.email || 'U').charAt(0).toUpperCase();
      avatarEl.textContent = initial;
    }
    this.renderStreak();
  },

  // =====================================================
  // BLOCO C — STREAK DE PESAGEM
  // =====================================================
  // Calcula a sequência de dias consecutivos com pesagem, a partir do
  // weightsRaw (fonte única da verdade). Não toca banco nem API — puro
  // cálculo local, custo zero de request/token.
  //
  // Regra: conta dias consecutivos terminando HOJE ou ONTEM (tolera não
  // ter pesado ainda hoje, sem zerar o streak injustamente). Se o último
  // registro é anterior a ontem, o streak está quebrado (= 0).
  calcStreak() {
    const raw = this.state.weightsRaw;
    if (!raw || !raw.length) return { atual: 0, recorde: 0, pesouHoje: false };

    // Conjunto de dias únicos com pesagem (normalizado YYYY-MM-DD)
    const dias = [...new Set(raw.map(w => this._normData(w.date)))].sort(); // asc

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const fmtDia = d => d.toISOString().slice(0, 10);
    const hojeStr = fmtDia(hoje);
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    const ontemStr = fmtDia(ontem);

    const pesouHoje = dias.includes(hojeStr);

    // Streak atual: caminha pra trás a partir de hoje (ou ontem)
    let atual = 0;
    const diaSet = new Set(dias);
    let cursor = new Date(hoje);
    if (!pesouHoje) {
      // Se não pesou hoje, o streak só continua válido se pesou ontem
      if (!diaSet.has(ontemStr)) return { atual: 0, recorde: this._calcRecordeStreak(dias), pesouHoje: false };
      cursor = new Date(ontem);
    }
    while (diaSet.has(fmtDia(cursor))) {
      atual++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return { atual, recorde: Math.max(atual, this._calcRecordeStreak(dias)), pesouHoje };
  },

  // Maior sequência consecutiva já registrada (histórico completo)
  _calcRecordeStreak(diasOrdenados) {
    if (!diasOrdenados.length) return 0;
    let recorde = 1, atual = 1;
    for (let i = 1; i < diasOrdenados.length; i++) {
      const prev = new Date(diasOrdenados[i - 1]);
      const cur = new Date(diasOrdenados[i]);
      const diffDias = Math.round((cur - prev) / 86400000);
      if (diffDias === 1) { atual++; recorde = Math.max(recorde, atual); }
      else if (diffDias > 1) { atual = 1; }
    }
    return recorde;
  },

  renderStreak() {
    const el = document.getElementById('streakBadge');
    if (!el) return;
    const { atual, recorde, pesouHoje } = this.calcStreak();
    if (atual === 0) {
      el.innerHTML = `<span style="opacity:0.7">🔥 Comece sua sequência hoje!</span>`;
      el.title = recorde > 0 ? `Seu recorde: ${recorde} dias` : '';
      return;
    }
    const plural = atual === 1 ? 'dia' : 'dias';
    const recordeTxt = (atual >= recorde && atual > 1) ? ' 🏆' : '';
    const aviso = pesouHoje ? '' : ' <span style="font-size:10px;opacity:0.7">(pese hoje p/ manter)</span>';
    el.innerHTML = `<strong style="color:var(--gold)">🔥 ${atual} ${plural}${recordeTxt}</strong>${aviso}`;
    el.title = `Sequência atual: ${atual} dias · Recorde: ${recorde} dias`;
  },

  // =====================================================
  // BLOCO GAMIFICAÇÃO — Conquistas (badges) + Celebração
  // =====================================================
  async loadConquistas() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('conquistas')
      .select('badge_id, desbloqueada_em, detalhes')
      .eq('user_id', user.id);
    if (error) throw error;
    return data || [];
  },

  // Catálogo de badges. cond(ctx) → retorna true se merece o badge.
  // ctx traz dados já calculados pra não repetir contas.
  _badges: [
    { id: 'primeira_pesagem', icone: '⚖️', nome: 'Primeiro Passo', desc: 'Primeira pesagem registrada', cond: c => c.totalPesagens >= 1 },
    { id: 'streak_7', icone: '🔥', nome: 'Semana de Fogo', desc: '7 dias seguidos pesando', cond: c => c.streakRecorde >= 7 },
    { id: 'streak_30', icone: '🌟', nome: 'Mês Imbatível', desc: '30 dias seguidos pesando', cond: c => c.streakRecorde >= 30 },
    { id: 'streak_100', icone: '💎', nome: 'Centurião', desc: '100 dias seguidos', cond: c => c.streakRecorde >= 100 },
    { id: 'peso_5kg', icone: '🎯', nome: '5 kg Eliminados', desc: 'Perdeu 5 kg desde o início', cond: c => c.perdaTotal >= 5 },
    { id: 'peso_10kg', icone: '🏅', nome: '10 kg Eliminados', desc: 'Perdeu 10 kg desde o início', cond: c => c.perdaTotal >= 10 },
    { id: 'peso_20kg', icone: '🏆', nome: '20 kg Eliminados', desc: 'Perdeu 20 kg — feito enorme!', cond: c => c.perdaTotal >= 20 },
    { id: 'imc_saiu_ob3', icone: '📉', nome: 'Saiu da Obesidade III', desc: 'IMC abaixo de 40', cond: c => c.imcAtual && c.imcAtual < 40 && c.imcInicial >= 40 },
    { id: 'imc_saiu_ob2', icone: '📊', nome: 'Saiu da Obesidade II', desc: 'IMC abaixo de 35', cond: c => c.imcAtual && c.imcAtual < 35 && c.imcInicial >= 35 },
    { id: 'imc_saiu_ob1', icone: '📈', nome: 'Saiu da Obesidade I', desc: 'IMC abaixo de 30 — sobrepeso!', cond: c => c.imcAtual && c.imcAtual < 30 && c.imcInicial >= 30 },
    { id: 'imc_normal', icone: '✅', nome: 'Peso Normal', desc: 'IMC abaixo de 25 — parabéns!', cond: c => c.imcAtual && c.imcAtual < 25 && c.imcInicial >= 25 },
    { id: 'meta_batida', icone: '👑', nome: 'Meta Alcançada', desc: 'Atingiu seu peso-meta', cond: c => c.pesoAtual && c.pesoAtual <= c.metaKg },
    { id: 'diario_1', icone: '📔', nome: 'Querido Diário', desc: 'Primeiro registro de humor', cond: c => c.temMood },
    { id: 'submeta_1', icone: '🚩', nome: 'Primeira Submeta', desc: 'Atingiu uma submeta', cond: c => c.submetaAtingida },
    { id: 'exerc_1', icone: '💪', nome: 'Bora Treinar', desc: 'Primeiro exercício registrado', cond: c => c.temExercicio },
    { id: 'exerc_semana', icone: '🔥', nome: 'Semana Ativa', desc: '5 treinos numa semana', cond: c => c.treinosSemana >= 5 },
    { id: 'medidas_1', icone: '📏', nome: 'Conhece o Corpo', desc: 'Primeira medida corporal registrada', cond: c => c.temMedida },
    { id: 'refeicao_1', icone: '🍽️', nome: 'Prato Cheio', desc: 'Primeira refeição registrada', cond: c => c.temRefeicao }
  ],

  // Monta o contexto e desbloqueia badges novos. silencioso=true não celebra
  // (usado no load inicial pra não disparar fogos das conquistas antigas).
  async checkConquistas(silencioso = false) {
    const sorted = this.getSorted();
    const ctx = {
      totalPesagens: this.state.weightsRaw.length,
      streakRecorde: this.calcStreak().recorde,
      perdaTotal: sorted.length >= 2 ? (sorted[0].peso - sorted[sorted.length - 1].peso) : 0,
      pesoAtual: sorted.length ? sorted[sorted.length - 1].peso : null,
      metaKg: this.metaKg,
      imcInicial: sorted.length ? parseFloat(this.calcIMC(sorted[0].peso, this.altura)) : 0,
      imcAtual: sorted.length ? parseFloat(this.calcIMC(sorted[sorted.length - 1].peso, this.altura)) : null,
      temMood: !!this.state.moodHoje,
      submetaAtingida: this.state.submetas.some(s => sorted.length && sorted[sorted.length - 1].peso <= s.pesoAlvo),
      temExercicio: this.state.exercicios.length > 0,
      treinosSemana: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return this.state.exercicios.filter(e => new Date(e.data) >= d).length; })(),
      temMedida: this.state.medidas.length > 0,
      temRefeicao: (this.state.refeicoes || []).length > 0
    };

    const jaTem = new Set(this.state.conquistas.map(c => c.badge_id));
    const novos = this._badges.filter(b => !jaTem.has(b.id) && b.cond(ctx));
    if (!novos.length) return;

    // Persiste no banco (insert em lote, ignora duplicatas via unique index)
    try {
      const user = await window.VitaleAuth.getUser();
      if (!user) return;
      const rows = novos.map(b => ({ user_id: user.id, badge_id: b.id, detalhes: {} }));
      const { error } = await window.sb.from('conquistas').upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
      if (error) throw error;
      novos.forEach(b => this.state.conquistas.push({ badge_id: b.id, desbloqueada_em: new Date().toISOString() }));
      this.renderConquistas();
      // Celebra (a menos que seja o load silencioso inicial)
      if (!silencioso) {
        // Celebra um por vez, com pequeno intervalo se vários
        novos.forEach((b, i) => setTimeout(() => this.celebrarConquista(b), i * 1200));
      }
    } catch (e) {
      if (window.VitaleErr) window.VitaleErr.log('check_conquistas', e);
    }
  },

  // Animação de celebração: confete CSS puro + modal (zero dependência externa)
  celebrarConquista(badge) {
    // Confete
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    const cores = ['#d4a843', '#27c47d', '#4a9de8', '#e8924a', '#e8504a', '#c040c0'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      const size = 6 + Math.random() * 8;
      const left = Math.random() * 100;
      const dur = 2 + Math.random() * 2;
      const delay = Math.random() * 0.5;
      c.style.cssText = `position:absolute;top:-20px;left:${left}%;width:${size}px;height:${size}px;background:${cores[i % cores.length]};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};opacity:0.9;animation:vitaleConfete ${dur}s ${delay}s ease-in forwards;transform:rotate(${Math.random() * 360}deg)`;
      layer.appendChild(c);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 4500);

    // Modal de parabéns
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);animation:vitaleFadeIn .3s';
    modal.onclick = () => modal.remove();
    modal.innerHTML = `
      <div style="background:linear-gradient(135deg,#1a1f3a,#0d1223);border:1px solid var(--gold);border-radius:20px;padding:36px 40px;text-align:center;max-width:340px;box-shadow:0 20px 60px rgba(212,168,67,0.3);animation:vitalePop .4s cubic-bezier(.2,1.4,.4,1)">
        <div style="font-size:64px;line-height:1;margin-bottom:14px;animation:vitaleBounce 1s ease-in-out infinite">${badge.icone}</div>
        <div style="font-size:13px;color:var(--gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Conquista Desbloqueada!</div>
        <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:6px">${badge.nome}</div>
        <div style="font-size:14px;color:var(--textm);margin-bottom:20px">${badge.desc}</div>
        <button onclick="this.closest('div').parentElement.remove()" style="background:var(--gold);color:#0d1223;border:none;border-radius:10px;padding:10px 28px;font-weight:600;cursor:pointer;font-size:14px">Continuar 🎉</button>
      </div>`;
    document.body.appendChild(modal);
    if (window.VitaleAnalytics) window.VitaleAnalytics.track('conquista', { badge: badge.id });
  },

  renderConquistas() {
    const el = document.getElementById('conquistasGrid');
    if (!el) return;
    const desbloqueados = new Set(this.state.conquistas.map(c => c.badge_id));
    const total = this._badges.length;
    const ganhos = this._badges.filter(b => desbloqueados.has(b.id)).length;

    const hdr = document.getElementById('conquistasHeader');
    if (hdr) hdr.innerHTML = `<strong style="color:var(--gold)">🏆 Conquistas</strong> <span style="color:var(--textm);font-size:13px">${ganhos}/${total}</span>`;

    el.innerHTML = this._badges.map(b => {
      const got = desbloqueados.has(b.id);
      return `<div title="${b.desc}" style="text-align:center;padding:12px 8px;border-radius:12px;background:${got ? 'rgba(212,168,67,0.1)' : 'rgba(255,255,255,0.02)'};border:1px solid ${got ? 'rgba(212,168,67,0.3)' : 'var(--border)'};${got ? '' : 'opacity:0.4;filter:grayscale(1)'}">
        <div style="font-size:32px;line-height:1;margin-bottom:6px">${b.icone}</div>
        <div style="font-size:11px;color:${got ? 'var(--text)' : 'var(--textm)'};font-weight:${got ? '600' : '400'}">${b.nome}</div>
      </div>`;
    }).join('');
    this.renderBadgeResumo();
  },

  // Resumo compacto de conquistas no topo do Dashboard
  renderBadgeResumo() {
    const el = document.getElementById('badgeResumo');
    if (!el) return;
    const ganhos = this.state.conquistas.length;
    const total = this._badges.length;
    const { atual } = this.calcStreak();
    // Mostra os 3 badges mais recentes desbloqueados
    const recentes = [...this.state.conquistas]
      .sort((a, b) => new Date(b.desbloqueada_em) - new Date(a.desbloqueada_em))
      .slice(0, 3)
      .map(c => this._badges.find(b => b.id === c.badge_id)?.icone)
      .filter(Boolean).join(' ');
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap">
        ${atual > 0 ? `<span style="font-size:14px"><strong style="color:var(--gold)">🔥 ${atual}</strong> <span style="color:var(--textm);font-size:12px">dias</span></span>` : ''}
        <span style="font-size:14px"><strong style="color:var(--gold)">🏆 ${ganhos}/${total}</strong> <span style="color:var(--textm);font-size:12px">conquistas</span></span>
        ${recentes ? `<span style="font-size:18px">${recentes}</span>` : ''}
      </div>`;
  },

  // =====================================================
  // BLOCO EXERCÍCIOS — Registro de atividade física
  // =====================================================
  // Catálogo de exercícios com valores MET (Metabolic Equivalent of Task).
  // Caloria = MET × peso(kg) × duração(h). MET varia por intensidade.
  _exercicios: [
    { id: 'caminhada', nome: 'Caminhada', icone: '🚶', met: { leve: 2.8, moderada: 3.5, intensa: 4.3 } },
    { id: 'corrida', nome: 'Corrida', icone: '🏃', met: { leve: 7.0, moderada: 9.8, intensa: 12.3 } },
    { id: 'bicicleta', nome: 'Bicicleta', icone: '🚴', met: { leve: 4.0, moderada: 6.8, intensa: 10.0 } },
    { id: 'musculacao', nome: 'Musculação', icone: '🏋️', met: { leve: 3.5, moderada: 5.0, intensa: 6.0 } },
    { id: 'natacao', nome: 'Natação', icone: '🏊', met: { leve: 5.3, moderada: 7.0, intensa: 9.5 } },
    { id: 'funcional', nome: 'Funcional', icone: '🤸', met: { leve: 4.0, moderada: 6.0, intensa: 8.0 } },
    { id: 'yoga', nome: 'Yoga / Alongamento', icone: '🧘', met: { leve: 2.0, moderada: 3.0, intensa: 4.0 } },
    { id: 'esporte', nome: 'Esporte', icone: '⚽', met: { leve: 4.5, moderada: 7.0, intensa: 10.0 } },
    { id: 'outro', nome: 'Outro', icone: '💪', met: { leve: 3.0, moderada: 5.0, intensa: 7.0 } }
  ],

  // Estado do formulário
  exercDraft: { tipo: 'caminhada', intensidade: 'moderada' },

  selectExercTipo(tipo) {
    this.exercDraft.tipo = tipo;
    this._renderExercForm();
  },

  selectExercIntensidade(nivel) {
    this.exercDraft.intensidade = nivel;
    this._renderExercForm();
  },

  // Estima calorias a partir de MET × peso atual × horas
  _estimaCalorias(tipoId, intensidade, duracaoMin) {
    const ex = this._exercicios.find(e => e.id === tipoId);
    if (!ex) return 0;
    const met = ex.met[intensidade] || ex.met.moderada;
    const sorted = this.getSorted();
    const peso = sorted.length ? sorted[sorted.length - 1].peso : 80; // fallback 80kg
    return Math.round(met * peso * (duracaoMin / 60));
  },

  async loadExercicios() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const ini = new Date(); ini.setDate(ini.getDate() - 30);
    const { data, error } = await window.sb
      .from('exercicios')
      .select('id, data, tipo, duracao_min, intensidade, calorias, nota')
      .eq('user_id', user.id)
      .gte('data', ini.toISOString().slice(0, 10))
      .order('data', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async salvarExercicio() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return this.showAlert('error', 'Sessão expirada. Recarregue a página.');
    const dur = parseInt(document.getElementById('exercDuracao')?.value);
    if (!dur || dur <= 0) return this.showAlert('error', 'Informe a duração em minutos!');
    if (dur > 600) return this.showAlert('error', 'Duração máxima é 600 min (10h).');

    const tipo = this.exercDraft.tipo;
    const intensidade = this.exercDraft.intensidade;
    const nota = document.getElementById('exercNota')?.value.trim() || null;
    const dataExerc = document.getElementById('exercData')?.value || this._hojeSP();
    const calorias = this._estimaCalorias(tipo, intensidade, dur);

    try {
      const { data, error } = await window.sb.from('exercicios').insert({
        user_id: user.id, tipo, duracao_min: dur, intensidade, calorias, nota, data: dataExerc
      }).select().single();
      if (error) throw error;
      this.state.exercicios.unshift(data);
      this.renderExercicios();
      this.renderBalancoCalorico();
      this._invalidateCoachCache();
      const efr = document.getElementById('exercFotoResult'); if (efr) efr.innerHTML = '';
      const efp = document.getElementById('exercFotoPreview'); if (efp) efp.innerHTML = '';
      const befp = document.getElementById('btnProcessarExercFoto'); if (befp) befp.style.display = 'none';
      document.getElementById('exercDuracao').value = '';
      const edEl = document.getElementById('exercData'); if (edEl) edEl.value = '';
      if (document.getElementById('exercNota')) document.getElementById('exercNota').value = '';
      const ex = this._exercicios.find(e => e.id === tipo);
      this.showAlert('success', `✅ ${ex.icone} ${ex.nome} registrado — ${calorias} kcal!`);
      this.checkConquistas();
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('exercicio_salvo', { tipo });
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('salvar_exercicio', e);
    }
  },

  async removerExercicio(id) {
    if (!confirm('Remover este exercício?')) return;
    const { error } = await window.sb.from('exercicios').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.exercicios = this.state.exercicios.filter(e => e.id !== id);
    this.renderExercicios();
    this.renderBalancoCalorico();
    this.renderHistoricoCompleto();
  },

  _renderExercForm() {
    const grid = document.getElementById('exercTipoGrid');
    if (grid) {
      grid.innerHTML = this._exercicios.map(e => {
        const sel = this.exercDraft.tipo === e.id;
        return `<button onclick="VITALE_CORE.selectExercTipo('${e.id}')"
          style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:12px;cursor:pointer;background:${sel ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.02)'};border:1px solid ${sel ? 'var(--gold)' : 'var(--border)'};transition:all .15s">
          <span style="font-size:24px">${e.icone}</span>
          <span style="font-size:10px;color:${sel ? 'var(--text)' : 'var(--textm)'}">${e.nome}</span>
        </button>`;
      }).join('');
    }
    const intEl = document.getElementById('exercIntensidade');
    if (intEl) {
      const niveis = [['leve', 'Leve'], ['moderada', 'Moderada'], ['intensa', 'Intensa']];
      intEl.innerHTML = niveis.map(([k, label]) => {
        const sel = this.exercDraft.intensidade === k;
        return `<button onclick="VITALE_CORE.selectExercIntensidade('${k}')"
          style="flex:1;padding:8px;border-radius:10px;cursor:pointer;background:${sel ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.02)'};border:1px solid ${sel ? 'var(--gold)' : 'var(--border)'};color:${sel ? 'var(--text)' : 'var(--textm)'};font-size:13px">${label}</button>`;
      }).join('');
    }
    // Preview de calorias em tempo real
    const dur = parseInt(document.getElementById('exercDuracao')?.value) || 0;
    const prev = document.getElementById('exercCalPreview');
    if (prev && dur > 0) {
      const cal = this._estimaCalorias(this.exercDraft.tipo, this.exercDraft.intensidade, dur);
      prev.innerHTML = `≈ <strong style="color:var(--gold)">${cal} kcal</strong> estimadas`;
      prev.style.display = 'block';
    } else if (prev) {
      prev.style.display = 'none';
    }
  },

  renderExercicios() {
    this._renderExercForm();
    const el = document.getElementById('exercLista');
    if (!el) return;

    const exs = this.state.exercicios;
    if (!exs.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:16px 0">Nenhum exercício registrado ainda 💪</p>';
      const resumo = document.getElementById('exercResumo');
      if (resumo) resumo.style.display = 'none';
      return;
    }

    // Resumo da semana (últimos 7 dias)
    const seteDias = new Date(); seteDias.setDate(seteDias.getDate() - 7);
    const semana = exs.filter(e => new Date(e.data) >= seteDias);
    const totalMin = semana.reduce((s, e) => s + e.duracao_min, 0);
    const totalCal = semana.reduce((s, e) => s + (e.calorias || 0), 0);
    const resumo = document.getElementById('exercResumo');
    if (resumo) {
      resumo.style.display = '';
      resumo.innerHTML = `
        <div style="display:flex;gap:20px;justify-content:center;text-align:center">
          <div><div style="font-size:22px;font-weight:700;color:var(--gold)">${semana.length}</div><div style="font-size:11px;color:var(--textm)">treinos/semana</div></div>
          <div><div style="font-size:22px;font-weight:700;color:var(--cyan)">${totalMin}</div><div style="font-size:11px;color:var(--textm)">minutos</div></div>
          <div><div style="font-size:22px;font-weight:700;color:var(--em)">${totalCal}</div><div style="font-size:11px;color:var(--textm)">kcal queimadas</div></div>
        </div>`;
    }

    el.innerHTML = exs.map(e => {
      const ex = this._exercicios.find(t => t.id === e.tipo) || { icone: '💪', nome: e.tipo };
      const intLabel = { leve: 'Leve', moderada: 'Moderada', intensa: 'Intensa' }[e.intensidade] || '';
      const notaTxt = e.nota ? ` · ${this._escapeHtml(e.nota)}` : '';
      return `<div class="med-item">
        <div class="med-info">
          <h4>${ex.icone} ${ex.nome}</h4>
          <p>⏱ ${e.duracao_min} min · ${intLabel}${e.calorias ? ` · 🔥 ${e.calorias} kcal` : ''}</p>
          <p style="font-size:11px;color:var(--textm)">${this.fmt(e.data)}${notaTxt}</p>
        </div>
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerExercicio(${e.id})">🗑️</button>
      </div>`;
    }).join('');
  },

  // =====================================================
  // BLOCO MEDIDAS CORPORAIS (body_measurements)
  // =====================================================
  _medidasCampos: [
    { id: 'cintura', nome: 'Cintura', icone: '📏' },
    { id: 'quadril', nome: 'Quadril', icone: '📐' },
    { id: 'abdomen', nome: 'Abdômen', icone: '🎯' },
    { id: 'peito', nome: 'Peito', icone: '💚' },
    { id: 'braco', nome: 'Braço', icone: '💪' },
    { id: 'coxa', nome: 'Coxa', icone: '🦵' },
    { id: 'pescoco', nome: 'Pescoço', icone: '🔵' }
  ],

  async loadMedidas() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('body_measurements')
      .select('id, data, cintura, quadril, abdomen, peito, braco, coxa, pescoco, gordura_pct, nota')
      .eq('user_id', user.id)
      .order('data', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Relação Cintura/Quadril — indicador de risco cardiovascular
  _calcRCQ(cintura, quadril) {
    if (!cintura || !quadril) return null;
    return (cintura / quadril).toFixed(2);
  },
  // Classificação de risco da RCQ (homens; ajustável)
  _rcqRisco(rcq) {
    if (rcq == null) return null;
    const v = parseFloat(rcq);
    if (v < 0.90) return { txt: 'Baixo risco', cor: 'var(--em)' };
    if (v < 1.0) return { txt: 'Risco moderado', cor: 'var(--gold)' };
    return { txt: 'Risco alto', cor: 'var(--red)' };
  },

  async salvarMedidas() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return this.showAlert('error', 'Sessão expirada. Recarregue a página.');
    const dataInput = document.getElementById('med_data')?.value;
    const reg = { user_id: user.id, data: dataInput || this._hojeSP() };
    let algum = false;
    this._medidasCampos.forEach(c => {
      const v = parseFloat(document.getElementById('med_' + c.id)?.value);
      if (!isNaN(v) && v > 0) { reg[c.id] = v; algum = true; }
    });
    const nota = document.getElementById('med_nota')?.value.trim();
    if (nota) reg.nota = nota;
    if (!algum) return this.showAlert('error', 'Preencha ao menos uma medida!');

    try {
      const { data, error } = await window.sb.from('body_measurements').insert(reg).select().single();
      if (error) throw error;
      // Mantém ordenado por data desc após inserir (pode ser data passada)
      this.state.medidas.push(data);
      this.state.medidas.sort((a, b) => (b.data > a.data ? 1 : -1));
      this.renderMedidas();
      this.buildMedidasChart();
      this._invalidateCoachCache();
      // limpa form
      this._medidasCampos.forEach(c => { const el = document.getElementById('med_' + c.id); if (el) el.value = ''; });
      const notaEl = document.getElementById('med_nota'); if (notaEl) notaEl.value = '';
      const dEl = document.getElementById('med_data'); if (dEl) dEl.value = '';
      this.showAlert('success', '✅ Medidas registradas!');
      this.checkConquistas();
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('medidas_salvas');
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('salvar_medidas', e);
    }
  },

  async removerMedida(id) {
    if (!confirm('Remover este registro de medidas?')) return;
    const { error } = await window.sb.from('body_measurements').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.medidas = this.state.medidas.filter(m => m.id !== id);
    this.renderMedidas();
    this.buildMedidasChart();
    this.renderHistoricoCompleto();
  },

  renderMedidas() {
    const el = document.getElementById('medidasLista');
    if (!el) return;
    const ms = this.state.medidas;
    if (!ms.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:16px 0">Nenhuma medida registrada ainda 📏</p>';
      return;
    }

    // Card de destaque: medida mais recente + RCQ
    const ultima = ms[0];
    const rcq = this._calcRCQ(ultima.cintura, ultima.quadril);
    const risco = this._rcqRisco(rcq);
    const destaque = document.getElementById('medidasDestaque');
    if (destaque) {
      if (rcq) {
        destaque.style.display = '';
        destaque.innerHTML = `
          <div style="text-align:center">
            <div style="font-size:11px;color:var(--textm);text-transform:uppercase;letter-spacing:1px">Relação Cintura/Quadril</div>
            <div style="font-size:32px;font-weight:700;color:${risco.cor};line-height:1.2">${rcq}</div>
            <div style="font-size:13px;color:${risco.cor}">${risco.txt}</div>
          </div>`;
      } else {
        destaque.style.display = 'none';
      }
    }

    el.innerHTML = ms.map(m => {
      const vals = this._medidasCampos
        .filter(c => m[c.id] != null)
        .map(c => `<span style="margin-right:12px;font-size:13px">${c.icone} ${c.nome}: <strong>${m[c.id]}${c.id === 'gordura_pct' ? '%' : ' cm'}</strong></span>`)
        .join('');
      const notaTxt = m.nota ? `<div style="font-size:12px;color:var(--textm);font-style:italic;margin-top:4px">"${this._escapeHtml(m.nota)}"</div>` : '';
      return `<div class="med-item">
        <div class="med-info">
          <h4 style="font-size:13px;color:var(--textm)">${this.fmt(m.data)}</h4>
          <div style="margin-top:6px;line-height:1.8">${vals}</div>
          ${notaTxt}
        </div>
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerMedida(${m.id})">🗑️</button>
      </div>`;
    }).join('');
  },

  buildMedidasChart() {
    const canvas = document.getElementById('medidasChart');
    if (!canvas) return;
    const card = document.getElementById('medidasChartCard');
    // Ordena cronológico e pega registros com pelo menos cintura ou abdômen
    const ms = [...this.state.medidas].reverse().filter(m => (m.cintura || m.abdomen) && this._dentroDoFiltro(m.data));
    if (ms.length < 2) { if (card) card.style.display = 'none'; return; }
    if (card) card.style.display = '';

    const labels = ms.map(m => this.fmt(m.data));
    const ctx = canvas.getContext('2d');
    if (this.state.medidasChartInstance) this.state.medidasChartInstance.destroy();

    const series = [
      { key: 'cintura', label: 'Cintura', cor: '#d4a843' },
      { key: 'abdomen', label: 'Abdômen', cor: '#e8924a' },
      { key: 'quadril', label: 'Quadril', cor: '#4a9de8' }
    ].filter(s => ms.some(m => m[s.key] != null));

    this.state.medidasChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: ms.map(m => m[s.key]), borderColor: s.cor,
          backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2,
          pointBackgroundColor: s.cor, tension: 0.4, spanGaps: true
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, labels: { color: '#a8accc', font: { size: 11 }, boxWidth: 12, padding: 12 } },
          tooltip: { backgroundColor: '#0d1223', titleColor: '#d4a843', bodyColor: '#ede8e0', padding: 10,
            callbacks: { label: (c) => c.raw == null ? null : ` ${c.dataset.label}: ${c.raw} cm` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#545870', font: { size: 10 }, maxTicksLimit: 7 } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#545870', font: { size: 10 }, callback: v => v + ' cm' } }
        }
      }
    });
  },

  // =====================================================
  // BLOCO COMPOSIÇÃO CORPORAL (bioimpedância / InBody / balança)
  // =====================================================
  _composicaoCampos: [
    { id: 'peso', nome: 'Peso', un: 'kg', icone: '⚖️' },
    { id: 'gordura_pct', nome: '% Gordura', un: '%', icone: '📊' },
    { id: 'massa_gordura', nome: 'Massa de Gordura', un: 'kg', icone: '🔻' },
    { id: 'massa_muscular', nome: 'Massa Muscular', un: 'kg', icone: '💪' },
    { id: 'agua_corporal', nome: 'Água Corporal', un: 'L', icone: '💧' },
    { id: 'gordura_visceral', nome: 'Gordura Visceral', un: 'nível', icone: '🎯' },
    { id: 'tmb', nome: 'TMB (metabolismo)', un: 'kcal', icone: '🔥' },
    { id: 'imc', nome: 'IMC', un: '', icone: '📈' }
  ],

  async loadComposicao() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('composicao_corporal')
      .select('id, data, peso, gordura_pct, massa_gordura, massa_muscular, agua_corporal, gordura_visceral, tmb, imc, nota, fonte')
      .eq('user_id', user.id)
      .order('data', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async loadDoses() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('doses_medicacao')
      .select('id, data, medicamento, dose, nota')
      .eq('user_id', user.id)
      .order('data', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async loadEfeitos() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('efeitos_colaterais')
      .select('id, data, tipo, intensidade, nota')
      .eq('user_id', user.id)
      .order('data', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async loadMemoria() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const { data, error } = await window.sb
      .from('user_memory')
      .select('id, tipo, conteudo, relevancia, created_at')
      .eq('user_id', user.id)
      .order('relevancia', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async salvarComposicao() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return this.showAlert('error', 'Sessão expirada. Recarregue a página.');
    const dataInput = document.getElementById('comp_data')?.value;
    const fonteInput = document.getElementById('comp_fonte')?.value || 'manual';
    const reg = { user_id: user.id, data: dataInput || this._hojeSP(), fonte: fonteInput };
    let algum = false;
    this._composicaoCampos.forEach(c => {
      const v = parseFloat(document.getElementById('comp_' + c.id)?.value);
      if (!isNaN(v) && v > 0) { reg[c.id] = c.id === 'tmb' ? Math.round(v) : v; algum = true; }
    });
    const nota = document.getElementById('comp_nota')?.value.trim();
    if (nota) reg.nota = nota;
    if (!algum) return this.showAlert('error', 'Preencha ao menos um campo!');

    try {
      const { data, error } = await window.sb.from('composicao_corporal').insert(reg).select().single();
      if (error) throw error;
      this.state.composicao.push(data);
      this.state.composicao.sort((a, b) => (b.data > a.data ? 1 : -1));
      this.renderComposicao();
      this.buildComposicaoChart();
      this._invalidateCoachCache();
      this._composicaoCampos.forEach(c => { const el = document.getElementById('comp_' + c.id); if (el) el.value = ''; });
      const n = document.getElementById('comp_nota'); if (n) n.value = '';
      const d = document.getElementById('comp_data'); if (d) d.value = '';
      const f = document.getElementById('comp_fonte'); if (f) f.value = 'manual';
      const ocrR = document.getElementById('ocrResult'); if (ocrR) ocrR.innerHTML = '';
      this.showAlert('success', '✅ Composição salva! Veja na lista abaixo ou no Histórico.');
      this.checkConquistas();
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('composicao_salva');
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('salvar_composicao', e);
    }
  },

  async removerComposicao(id) {
    if (!confirm('Remover este registro de composição?')) return;
    const { error } = await window.sb.from('composicao_corporal').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.composicao = this.state.composicao.filter(c => c.id !== id);
    this.renderComposicao();
    this.buildComposicaoChart();
    this.renderHistoricoCompleto();
  },

  renderComposicao() {
    const el = document.getElementById('composicaoLista');
    if (!el) return;
    const cs = this.state.composicao;
    if (!cs.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:16px 0">Nenhuma composição registrada ainda 📊</p>';
      const dest = document.getElementById('composicaoDestaque');
      if (dest) dest.style.display = 'none';
      return;
    }

    // Destaque: massa muscular vs gordura (a métrica-rainha pro GLP-1)
    const u = cs[0];
    const dest = document.getElementById('composicaoDestaque');
    if (dest && (u.massa_muscular || u.massa_gordura)) {
      dest.style.display = '';
      dest.innerHTML = `
        <div style="display:flex;gap:16px;justify-content:center;text-align:center">
          ${u.massa_muscular ? `<div><div style="font-size:24px;font-weight:700;color:var(--em)">${u.massa_muscular}</div><div style="font-size:10px;color:var(--textm)">💪 Músculo (kg)</div></div>` : ''}
          ${u.massa_gordura ? `<div><div style="font-size:24px;font-weight:700;color:var(--orange)">${u.massa_gordura}</div><div style="font-size:10px;color:var(--textm)">🔻 Gordura (kg)</div></div>` : ''}
          ${u.gordura_pct ? `<div><div style="font-size:24px;font-weight:700;color:var(--gold)">${u.gordura_pct}%</div><div style="font-size:10px;color:var(--textm)">📊 % Gordura</div></div>` : ''}
        </div>`;
    } else if (dest) {
      dest.style.display = 'none';
    }

    el.innerHTML = cs.map(c => {
      const vals = this._composicaoCampos
        .filter(f => c[f.id] != null)
        .map(f => `<span style="margin-right:12px;font-size:13px">${f.icone} ${f.nome}: <strong>${c[f.id]}${f.un ? ' ' + f.un : ''}</strong></span>`)
        .join('');
      const notaTxt = c.nota ? `<div style="font-size:12px;color:var(--textm);font-style:italic;margin-top:4px">"${this._escapeHtml(c.nota)}"</div>` : '';
      return `<div class="med-item">
        <div class="med-info">
          <h4 style="font-size:13px;color:var(--textm)">${this.fmt(c.data)} ${this._fonteBadge(c.fonte)}</h4>
          <div style="margin-top:6px;line-height:1.8">${vals}</div>
          ${notaTxt}
        </div>
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerComposicao(${c.id})">🗑️</button>
      </div>`;
    }).join('');
  },

  buildComposicaoChart() {
    const canvas = document.getElementById('composicaoChart');
    if (!canvas) return;
    const card = document.getElementById('composicaoChartCard');
    // Gráfico de músculo vs gordura ao longo do tempo (a história que importa)
    const cs = [...this.state.composicao].reverse().filter(c => (c.massa_muscular || c.massa_gordura) && this._dentroDoFiltro(c.data));
    if (cs.length < 2) { if (card) card.style.display = 'none'; return; }
    if (card) card.style.display = '';

    const labels = cs.map(c => this.fmt(c.data));
    const ctx = canvas.getContext('2d');
    if (this.state.composicaoChartInstance) this.state.composicaoChartInstance.destroy();

    this.state.composicaoChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '💪 Músculo (kg)', data: cs.map(c => c.massa_muscular), borderColor: '#27c47d', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#27c47d', tension: 0.4, spanGaps: true },
          { label: '🔻 Gordura (kg)', data: cs.map(c => c.massa_gordura), borderColor: '#e8924a', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#e8924a', tension: 0.4, spanGaps: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, labels: { color: '#a8accc', font: { size: 11 }, boxWidth: 12, padding: 12 } },
          tooltip: { backgroundColor: '#0d1223', titleColor: '#d4a843', bodyColor: '#ede8e0', padding: 10,
            callbacks: { label: (c) => c.raw == null ? null : ` ${c.dataset.label}: ${c.raw} kg` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#545870', font: { size: 10 }, maxTicksLimit: 7 } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#545870', font: { size: 10 }, callback: v => v + ' kg' } }
        }
      }
    });
  },

  // =====================================================
  // FASE A — ALIMENTAÇÃO (refeições)
  // =====================================================
  _tiposRefeicao: [
    { id: 'cafe', nome: 'Café', icone: '☕' },
    { id: 'almoco', nome: 'Almoço', icone: '🍽️' },
    { id: 'jantar', nome: 'Jantar', icone: '🌙' },
    { id: 'lanche', nome: 'Lanche', icone: '🍎' }
  ],
  refeicaoTipo: 'almoco',

  selectRefeicaoTipo(tipo) {
    this.refeicaoTipo = tipo;
    this._renderRefeicaoForm();
  },

  async loadRefeicoesHoje() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    // Carrega os últimos 30 dias (para o histórico); telas "de hoje" filtram pela data
    const d = new Date(); d.setDate(d.getDate() - 30);
    const corte = d.toISOString().slice(0, 10);
    const { data, error } = await window.sb
      .from('refeicoes')
      .select('id, data, tipo, descricao, calorias, peso_g, origem')
      .eq('user_id', user.id)
      .gte('data', corte)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async salvarRefeicao() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return this.showAlert('error', 'Sessão expirada. Recarregue a página.');
    const desc = document.getElementById('ref_desc')?.value.trim();
    const cal = parseInt(document.getElementById('ref_cal')?.value);
    const peso = parseInt(document.getElementById('ref_peso')?.value) || null;
    if (!desc && !cal) return this.showAlert('error', 'Informe a descrição ou as calorias.');

    try {
      const reg = {
        user_id: user.id, data: this._hojeSP(), tipo: this.refeicaoTipo,
        descricao: desc || null, calorias: isNaN(cal) ? null : cal, peso_g: peso,
        origem: this._refeicaoOrigem || 'manual'
      };
      const { data, error } = await window.sb.from('refeicoes').insert(reg).select().single();
      if (error) throw error;
      this.state.refeicoes.push(data);
      this._refeicaoOrigem = null;
      this.renderRefeicoes();
      this.renderBalancoCalorico();
      this._invalidateCoachCache();
      ['ref_desc', 'ref_cal', 'ref_peso'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      // Limpa as áreas de estimativa (foto/texto) e a prévia da foto
      ['foodResult', 'foodTextoResult', 'foodPreview'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
      const ft = document.getElementById('foodTexto'); if (ft) ft.value = '';
      const bf = document.getElementById('btnProcessarFood'); if (bf) bf.style.display = 'none';
      this.renderRefeicoes();
      this.showAlert('success', '✅ Refeição salva! Veja em "Refeições de Hoje" abaixo.');
      this.checkConquistas();
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('refeicao_salva', { tipo: this.refeicaoTipo });
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('salvar_refeicao', e);
    }
  },

  async removerRefeicao(id) {
    if (!confirm('Remover esta refeição?')) return;
    const { error } = await window.sb.from('refeicoes').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.refeicoes = this.state.refeicoes.filter(r => r.id !== id);
    this.renderRefeicoes();
    this.renderBalancoCalorico();
    this.renderHistoricoCompleto();
    this._invalidateCoachCache();
    this.renderBalancoCalorico();
    this._invalidateCoachCache();
  },

  _renderRefeicaoForm() {
    const grid = document.getElementById('refTipoGrid');
    if (!grid) return;
    grid.innerHTML = this._tiposRefeicao.map(t => {
      const sel = this.refeicaoTipo === t.id;
      return `<button onclick="VITALE_CORE.selectRefeicaoTipo('${t.id}')"
        style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 4px;border-radius:12px;cursor:pointer;background:${sel ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.02)'};border:1px solid ${sel ? 'var(--gold)' : 'var(--border)'}">
        <span style="font-size:22px">${t.icone}</span><span style="font-size:10px;color:${sel ? 'var(--text)' : 'var(--textm)'}">${t.nome}</span>
      </button>`;
    }).join('');
  },

  renderRefeicoes() {
    this._renderRefeicaoForm();
    const el = document.getElementById('refLista');
    if (!el) return;
    const hoje = this._hojeSP();
    const rs = (this.state.refeicoes || []).filter(r => r.data === hoje);
    const totalCal = rs.reduce((s, r) => s + (r.calorias || 0), 0);
    const tot = document.getElementById('refTotalDia');
    if (tot) tot.innerHTML = `Total de hoje: <strong style="color:var(--gold)">${totalCal} kcal</strong>`;

    if (!rs.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhuma refeição hoje 🍽️</p>';
      return;
    }
    el.innerHTML = rs.map(r => {
      const t = this._tiposRefeicao.find(x => x.id === r.tipo) || { icone: '🍽️', nome: r.tipo };
      const og = r.origem === 'foto' ? ' 📷' : '';
      return `<div class="med-item">
        <div class="med-info"><h4 style="font-size:13px">${t.icone} ${t.nome}${og}</h4>
        <p style="margin-top:3px;color:var(--textm)">${r.descricao ? this._escapeHtml(r.descricao) + ' · ' : ''}${r.calorias || 0} kcal${r.peso_g ? ' · ' + r.peso_g + 'g' : ''}</p></div>
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerRefeicao(${r.id})">🗑️</button>
      </div>`;
    }).join('');
  },

  // =====================================================
  // FASE A — BALANÇO CALÓRICO (consumido vs gasto)
  // =====================================================
  // TMB: prioriza bioimpedância mais recente; senão Mifflin-St Jeor com peso atual.
  // Gasto = TMB × fator de atividade + exercícios extras do dia.
  _getTMB() {
    // 1) Bioimpedância mais recente com TMB
    const compComTmb = (this.state.composicao || []).filter(c => c.tmb).sort((a, b) => (b.data > a.data ? 1 : -1));
    if (compComTmb.length) return { valor: compComTmb[0].tmb, fonte: 'bioimpedância de ' + this.fmt(compComTmb[0].data) };
    // 2) TMB manual no perfil
    const hp = this.state.healthProfile || {};
    if (hp.tmb_manual) return { valor: hp.tmb_manual, fonte: 'informada por você' };
    // 3) Mifflin-St Jeor com peso atual (assume masculino; idade do perfil ou 40)
    const sorted = this.getSorted();
    const peso = sorted.length ? sorted[sorted.length - 1].peso : null;
    if (!peso) return null;
    const alturaCm = this.altura * 100;
    const idade = hp.idade || 40;
    // Mifflin-St Jeor (homem): 10*peso + 6.25*altura_cm - 5*idade + 5
    const tmb = Math.round(10 * peso + 6.25 * alturaCm - 5 * idade + 5);
    return { valor: tmb, fonte: 'estimada por fórmula (Mifflin-St Jeor)' };
  },

  renderBalancoCalorico() {
    const el = document.getElementById('balancoCard');
    if (!el) return;
    const tmbInfo = this._getTMB();
    if (!tmbInfo) { el.style.display = 'none'; return; }
    el.style.display = '';

    const hp = this.state.healthProfile || {};
    const fator = hp.fator_atividade || 1.4; // sedentário-leve por padrão
    const hoje = this._hojeSP();

    // Consumido = refeições de hoje
    const consumido = (this.state.refeicoes || []).filter(r => r.data === hoje).reduce((s, r) => s + (r.calorias || 0), 0);
    // Exercícios de hoje
    const exHoje = (this.state.exercicios || []).filter(e => e.data === hoje).reduce((s, e) => s + (e.calorias || 0), 0);
    // Gasto = TMB × fator + exercícios extras
    const gasto = Math.round(tmbInfo.valor * fator + exHoje);
    const saldo = consumido - gasto;
    const emDeficit = saldo < 0;

    const corSaldo = emDeficit ? 'var(--em)' : 'var(--orange)';
    const rotuloSaldo = emDeficit ? 'Déficit' : 'Superávit';
    // Barras proporcionais: a maior das duas vira 100%
    const maxVal = Math.max(consumido, gasto, 1);
    const pctConsumido = (consumido / maxVal) * 100;
    const pctGasto = (gasto / maxVal) * 100;

    el.innerHTML = `
      <h3 style="margin-bottom:14px">⚖️ Balanço Calórico de Hoje</h3>
      <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:16px">
        <div><div style="font-size:22px;font-weight:700;color:var(--cyan)">${consumido}</div><div style="font-size:10px;color:var(--textm)">CONSUMIDO</div></div>
        <div style="align-self:center;font-size:18px;color:var(--textm)">−</div>
        <div><div style="font-size:22px;font-weight:700;color:var(--gold)">${gasto}</div><div style="font-size:10px;color:var(--textm)">GASTO</div></div>
        <div style="align-self:center;font-size:18px;color:var(--textm)">=</div>
        <div><div style="font-size:22px;font-weight:700;color:${corSaldo}">${saldo > 0 ? '+' : ''}${saldo}</div><div style="font-size:10px;color:${corSaldo}">${rotuloSaldo.toUpperCase()}</div></div>
      </div>
      <!-- Barras comparativas -->
      <div style="margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:10px;color:var(--cyan);width:70px;text-align:right">Consumido</span>
          <div style="flex:1;height:14px;background:rgba(255,255,255,0.04);border-radius:7px;overflow:hidden"><div style="height:100%;width:${pctConsumido}%;background:var(--cyan);border-radius:7px;transition:width .5s"></div></div>
          <span style="font-size:11px;color:var(--cyan);width:46px">${consumido}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:var(--gold);width:70px;text-align:right">Gasto</span>
          <div style="flex:1;height:14px;background:rgba(255,255,255,0.04);border-radius:7px;overflow:hidden"><div style="height:100%;width:${pctGasto}%;background:var(--gold);border-radius:7px;transition:width .5s"></div></div>
          <span style="font-size:11px;color:var(--gold);width:46px">${gasto}</span>
        </div>
      </div>
      <div style="text-align:center;margin-top:12px;padding:8px;border-radius:8px;background:${emDeficit ? 'rgba(39,196,125,0.08)' : 'rgba(232,146,74,0.08)'}">
        <span style="font-size:12px;color:${corSaldo};font-weight:600">${emDeficit ? '🎯 Em déficit de ' + Math.abs(saldo) + ' kcal — favorável à perda de peso' : '⚠️ Superávit de ' + saldo + ' kcal — acima do gasto hoje'}</span>
      </div>
      <p style="font-size:10px;color:var(--textm);text-align:center;margin-top:10px">
        Gasto = TMB (${tmbInfo.valor} kcal, ${tmbInfo.fonte}) × ${fator} atividade${exHoje ? ` + ${exHoje} kcal exercício` : ''}
      </p>`;
  },

  // Hoje no fuso de São Paulo (evita salvar no dia errado perto da meia-noite)
  _hojeSP() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      .toISOString().slice(0, 10);
  },

  async loadMoodHoje() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return null;
    const hoje = this._hojeSP();
    const { data, error } = await window.sb
      .from('mood_logs')
      .select('id, data, humor, energia, sono, nota')
      .eq('user_id', user.id)
      .eq('data', hoje)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // BLOCO F — Histórico do Diário (últimos 30 dias)
  async loadMoodHistorico() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return [];
    const ini = new Date(); ini.setDate(ini.getDate() - 30);
    const { data, error } = await window.sb
      .from('mood_logs')
      .select('data, humor, energia, sono')
      .eq('user_id', user.id)
      .gte('data', ini.toISOString().slice(0, 10))
      .order('data', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async renderMoodHistorico() {
    const card = document.getElementById('moodHistCard');
    if (!card) return;
    let dados;
    try { dados = await this.loadMoodHistorico(); }
    catch (e) { card.style.display = 'none'; return; }

    if (!dados || dados.length < 2) { card.style.display = 'none'; return; }
    card.style.display = '';

    const labels = dados.map(d => this.fmt(d.data));
    const canvas = document.getElementById('moodHistChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (this.state.moodChartInstance) this.state.moodChartInstance.destroy();

    const mk = (label, key, cor) => ({
      label, data: dados.map(d => d[key]), borderColor: cor,
      backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2,
      pointBackgroundColor: cor, tension: 0.4, spanGaps: true
    });

    this.state.moodChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [
        mk('Humor', 'humor', '#d4a843'),
        mk('Energia', 'energia', '#27c47d'),
        mk('Sono', 'sono', '#4a9de8')
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, labels: { color: '#a8accc', font: { size: 11 }, boxWidth: 12, padding: 12 } },
          tooltip: {
            backgroundColor: '#0d1223', titleColor: '#d4a843', bodyColor: '#ede8e0', padding: 10,
            callbacks: { label: (c) => c.raw == null ? null : ` ${c.dataset.label}: ${c.raw}/5` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#545870', font: { size: 10 }, maxTicksLimit: 7 } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#545870', font: { size: 10 }, stepSize: 1 }, min: 0, max: 5 }
        }
      }
    });
  },

  // Escalas de emoji para cada dimensão (índice 1-5)
  _moodEmojis: {
    humor:   ['', '😞', '😕', '😐', '🙂', '😄'],
    energia: ['', '🪫', '😴', '😌', '⚡', '🚀'],
    sono:    ['', '😩', '😪', '😐', '😊', '😴']
  },
  _moodLabels: { humor: 'Humor', energia: 'Energia', sono: 'Sono' },

  // Usuário toca num emoji → atualiza o rascunho e re-renderiza
  setMood(dim, valor) {
    if (!['humor', 'energia', 'sono'].includes(dim)) return;
    // Toggle: tocar no mesmo valor desmarca
    this.state.moodDraft[dim] = this.state.moodDraft[dim] === valor ? 0 : valor;
    this.renderMoodCard();
  },

  setMoodNota(texto) {
    this.state.moodDraft.nota = texto;
  },

  async salvarMood() {
    const user = await window.VitaleAuth.getUser();
    if (!user) return this.showAlert('error', 'Sessão expirada. Recarregue a página.');
    const d = this.state.moodDraft;
    if (!d.humor && !d.energia && !d.sono && !d.nota?.trim()) {
      return this.showAlert('error', 'Marque ao menos um item antes de salvar.');
    }
    try {
      const registro = {
        user_id: user.id,
        data: this._hojeSP(),
        humor: d.humor || null,
        energia: d.energia || null,
        sono: d.sono || null,
        nota: d.nota?.trim() || null
      };
      // Upsert por (user_id, data): edita o de hoje se já existir
      const { data, error } = await window.sb
        .from('mood_logs')
        .upsert(registro, { onConflict: 'user_id,data' })
        .select()
        .single();
      if (error) throw error;
      this.state.moodHoje = data;
      this.renderMoodCard();
      this.renderMoodHistorico();
      this.showAlert('success', '✅ Diário de hoje salvo!');
      // Gamificação: checa conquista de diário
      this.checkConquistas();
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('mood_salvo');
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('salvar_mood', e);
    }
  },

  renderMoodCard() {
    const el = document.getElementById('moodCard');
    if (!el) return;

    // Se já registrou hoje, mostra resumo + botão editar
    const hoje = this.state.moodHoje;
    const draft = this.state.moodDraft;
    const editando = el.dataset.editando === '1';

    if (hoje && !editando) {
      const linha = (dim) => {
        const v = hoje[dim];
        if (!v) return '';
        return `<span style="margin-right:14px">${this._moodEmojis[dim][v]} <span style="color:var(--textm);font-size:12px">${this._moodLabels[dim]}</span></span>`;
      };
      const notaTxt = hoje.nota ? `<div style="margin-top:10px;color:var(--textm);font-size:13px;font-style:italic">"${this._escapeHtml(hoje.nota)}"</div>` : '';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <strong style="color:var(--text)">📔 Diário de Hoje</strong>
          <button class="btn btn-secondary btn-small" onclick="VITALE_CORE.editarMood()" style="padding:6px 14px">✏️ Editar</button>
        </div>
        <div style="font-size:20px">${linha('humor')}${linha('energia')}${linha('sono')}</div>
        ${notaTxt}`;
      return;
    }

    // Modo edição/registro: carrega rascunho do registro existente se editando
    if (editando && hoje && draft.humor === 0 && draft.energia === 0 && draft.sono === 0 && !draft.nota) {
      this.state.moodDraft = { humor: hoje.humor || 0, energia: hoje.energia || 0, sono: hoje.sono || 0, nota: hoje.nota || '' };
    }
    const dr = this.state.moodDraft;

    const escala = (dim) => {
      const emojis = this._moodEmojis[dim];
      const botoes = [1, 2, 3, 4, 5].map(n => {
        const sel = dr[dim] === n;
        return `<button onclick="VITALE_CORE.setMood('${dim}',${n})" title="${n}/5"
          style="font-size:26px;background:${sel ? 'rgba(212,168,67,0.18)' : 'transparent'};border:1px solid ${sel ? 'var(--gold)' : 'transparent'};border-radius:10px;padding:4px 8px;cursor:pointer;transition:all .15s;${sel ? '' : 'opacity:0.5'}">${emojis[n]}</button>`;
      }).join('');
      return `<div style="margin-bottom:14px">
        <div style="font-size:12px;color:var(--textm);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${this._moodLabels[dim]}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${botoes}</div>
      </div>`;
    };

    el.innerHTML = `
      <div style="margin-bottom:14px"><strong style="color:var(--text)">📔 Como você está hoje?</strong>
        <span style="color:var(--textm);font-size:12px;margin-left:8px">toque nos emojis</span></div>
      ${escala('humor')}
      ${escala('energia')}
      ${escala('sono')}
      <textarea id="moodNota" oninput="VITALE_CORE.setMoodNota(this.value)" placeholder="Nota livre (opcional): algo que queira lembrar sobre hoje…"
        style="width:100%;min-height:60px;background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:10px;color:var(--text);font-family:inherit;font-size:14px;resize:vertical;margin-bottom:12px">${this._escapeHtml(dr.nota || '')}</textarea>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary btn-small" onclick="VITALE_CORE.salvarMood()" style="padding:9px 20px">💾 Salvar</button>
        ${hoje ? `<button class="btn btn-secondary btn-small" onclick="VITALE_CORE.cancelarEdicaoMood()" style="padding:9px 16px">Cancelar</button>` : ''}
      </div>`;
  },

  editarMood() {
    const el = document.getElementById('moodCard');
    if (el) el.dataset.editando = '1';
    this.state.moodDraft = { humor: 0, energia: 0, sono: 0, nota: '' };
    this.renderMoodCard();
  },

  cancelarEdicaoMood() {
    const el = document.getElementById('moodCard');
    if (el) el.dataset.editando = '0';
    this.state.moodDraft = { humor: 0, energia: 0, sono: 0, nota: '' };
    this.renderMoodCard();
  },

  _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // =====================================================
  // DASHBOARD

  // =====================================================
  updateDashboard() {
    if (!this.state.weights.length) {
      this.renderEmptyDashboard();
      return;
    }
    const sorted = this.getSorted();
    const first = sorted[0], last = sorted[sorted.length - 1];
    const imc = this.calcIMC(last.peso, this.altura);
    const info = this.getObesidadeInfo(imc);

    document.getElementById('hdrPeso').textContent = last.peso.toFixed(1);
    document.getElementById('hdrIMC').textContent = imc;
    const imcVal = document.getElementById('imcValue');
    const imcStat = document.getElementById('imcStatus');
    if (imcVal) imcVal.textContent = imc;
    if (imcStat) { imcStat.textContent = info.grau; imcStat.style.color = info.color; }

    const pesoAtual = document.getElementById('pesoAtual');
    const pesoInicial = document.getElementById('pesoInicial');
    if (pesoAtual) pesoAtual.textContent = last.peso.toFixed(1);
    if (pesoInicial) pesoInicial.textContent = first.peso.toFixed(1);

    if (sorted.length >= 2) {
      const perda = (first.peso - last.peso).toFixed(1);
      const pct = ((first.peso - last.peso) / first.peso * 100).toFixed(1);
      const dias = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
      const progress = Math.min(Math.max(((first.peso - last.peso) / (first.peso - this.metaKg)) * 100, 0), 100);

      document.getElementById('hdrPerda').textContent = perda + ' kg';
      const pTotal = document.getElementById('perdaTotal');
      const dRastro = document.getElementById('diasRastro');
      const mInicio = document.getElementById('metaInicio');
      const mLabel = document.getElementById('metaLabel');
      const mProg = document.getElementById('metaProgress');
      const mTxt = document.getElementById('metaText');
      if (pTotal) pTotal.textContent = pct + '%';
      if (dRastro) dRastro.textContent = dias;
      if (mInicio) mInicio.textContent = first.peso.toFixed(1);
      if (mLabel) mLabel.textContent = this.metaKg.toFixed(1);
      if (mProg) mProg.style.width = progress.toFixed(1) + '%';
      if (mTxt) mTxt.textContent = `Faltam ${Math.max(last.peso - this.metaKg, 0).toFixed(1)} kg para IMC < 30 — ${progress.toFixed(0)}% concluído`;

      this.buildWeightChart();
      this.buildIMCChart();
      this.generateCoachMessage();
      this.updateProjecoes();
    }

    this.renderHistorico();
    this.renderStreak();
  },

  renderEmptyDashboard() {
    const hdr = ['hdrPeso', 'hdrIMC', 'hdrPerda'];
    hdr.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  },

  // =====================================================
  // COACH IA — fallback determinístico
  // =====================================================
  generateCoachMessage() {
    const el = document.getElementById('coachMessage');
    const ft = document.getElementById('coachFooter');
    if (!el) return;
    if (this.state.weights.length < 2) {
      el.innerHTML = 'Adicione pelo menos 2 registros de peso para análise personalizada.';
      if (ft) ft.innerHTML = '';
      return;
    }
    const sorted = this.getSorted();
    const first = sorted[0], last = sorted[sorted.length - 1];
    const totalPerdido = first.peso - last.peso;
    const pctPerdido = (totalPerdido / first.peso * 100).toFixed(1);
    const diasTotal = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
    const velDiaria = diasTotal > 0 ? totalPerdido / diasTotal : 0;
    const velSemanal = (velDiaria * 7).toFixed(2);
    const kgFalta = Math.max(last.peso - this.metaKg, 0).toFixed(1);
    const diasParaMeta = velDiaria > 0 ? Math.ceil((last.peso - this.metaKg) / velDiaria) : null;
    const dataMeta = diasParaMeta ? (() => { const d = new Date(); d.setDate(d.getDate() + diasParaMeta); return d; })() : null;

    let tendencia4w = '';
    const last4wDate = new Date(); last4wDate.setDate(last4wDate.getDate() - 28);
    const recent4w = sorted.filter(w => new Date(w.date) >= last4wDate);
    if (recent4w.length >= 2) {
      const r0 = recent4w[0], rN = recent4w[recent4w.length - 1];
      const rDias = Math.max(Math.floor((new Date(rN.date) - new Date(r0.date)) / 86400000), 1);
      const velRecente = ((r0.peso - rN.peso) / rDias * 7);
      if (velRecente > 0) {
        const sinal = velRecente > velDiaria * 7 * 1.1 ? '📈 acelerando'
                    : velRecente < velDiaria * 7 * 0.7 ? '📉 desacelerando'
                    : '→ estável';
        tendencia4w = `<br><br>Últimas 4 semanas: <strong>${velRecente.toFixed(2)} kg/sem</strong> ${sinal}.`;
      }
    }

    const nome = this.state.profile?.nome;
    let msg = '';
    if (velDiaria > 0 && diasParaMeta) {
      msg = `${nome ? 'Olá, ' + nome + '! ' : 'Olá! '}Sua jornada está impressionante 💪 Desde <strong>${this.fmt(first.date)}</strong>, você eliminou <strong class="hl">${totalPerdido.toFixed(1)} kg (${pctPerdido}%)</strong>.<br><br>No ritmo de <strong>${velSemanal} kg/semana</strong>, você atingirá <strong>${this.metaKg.toFixed(1)} kg</strong> em <strong style="color:var(--em2)">${this.fmtLong(dataMeta)}</strong> — só ${diasParaMeta} dias! Faltam <strong>${kgFalta} kg</strong>.${tendencia4w}`;
    } else {
      msg = `Progresso: <strong>${totalPerdido.toFixed(1)} kg eliminados</strong> desde ${this.fmt(first.date)} 🔥<br>Peso atual: <strong>${last.peso.toFixed(1)} kg</strong> → Meta: <strong>${this.metaKg.toFixed(1)} kg</strong>. Faltam <strong>${kgFalta} kg</strong>.${tendencia4w}<br>Adicione mais registros recentes para calcular velocidade e projeção.`;
    }
    el.innerHTML = msg;

    if (ft) {
      ft.innerHTML = `
        <div class="coach-stat"><div class="coach-stat-val">${totalPerdido.toFixed(1)} kg</div><div class="coach-stat-lbl">Total Perdido</div></div>
        <div class="coach-stat"><div class="coach-stat-val">${velSemanal}</div><div class="coach-stat-lbl">kg/semana</div></div>
        ${dataMeta ? `<div class="coach-stat"><div class="coach-stat-val" style="color:var(--gold);font-size:13px">${diasParaMeta}d</div><div class="coach-stat-lbl">Para Meta</div></div>` : ''}
      `;
    }
  },

  // Invalida cache do Coach IA (chamar quando dados mudam)
  _invalidateCoachCache() {
    this.state.coachCache = null;
  },

  // Coach IA via API com cache de 5min e objetivo no contexto
  // =====================================================
  // CÉREBRO INTEGRADO — monta a visão COMPLETA da pessoa pra IA.
  // Usado pelo Coach do dia (profundo:false) e pela Análise Completa (profundo:true).
  // Aqui é onde todos os dados isolados viram uma pessoa só.
  // =====================================================
  _buildContextoIA({ profundo = false } = {}) {
    const hp = this.state.healthProfile || {};
    const sorted = this.getSorted();
    const hoje = this._hojeSP();
    const seteDias = new Date(); seteDias.setDate(seteDias.getDate() - 7);

    // Peso e tendência
    const pesoAtual = sorted.length ? sorted[sorted.length - 1].peso : null;
    const pesoInicial = sorted.length ? sorted[0].peso : null;

    // Exercício da semana
    const exSemana = (this.state.exercicios || []).filter(e => new Date(e.data) >= seteDias);
    const exResumo = exSemana.length ? {
      treinos: exSemana.length,
      minutos: exSemana.reduce((s, e) => s + (e.duracao_min || 0), 0),
      kcal: exSemana.reduce((s, e) => s + (e.calorias || 0), 0),
      tipos: [...new Set(exSemana.map(e => e.tipo))]
    } : null;

    // Medidas + composição (a métrica-rainha do GLP-1)
    const ultMedida = (this.state.medidas || [])[0] || null;
    const rcq = ultMedida ? this._calcRCQ(ultMedida.cintura, ultMedida.quadril) : null;
    const ultComp = (this.state.composicao || [])[0] || null;
    const composicao = ultComp ? {
      data: ultComp.data, fonte: ultComp.fonte,
      massa_muscular: ultComp.massa_muscular, massa_gordura: ultComp.massa_gordura,
      gordura_pct: ultComp.gordura_pct, gordura_visceral: ultComp.gordura_visceral
    } : null;

    // Mood + alimentação + balanço de hoje
    const mood = this.state.moodHoje ? { humor: this.state.moodHoje.humor, energia: this.state.moodHoje.energia, sono: this.state.moodHoje.sono } : null;
    const refeicoesHoje = (this.state.refeicoes || []).filter(r => r.data === hoje);
    const consumidoHoje = refeicoesHoje.reduce((s, r) => s + (r.calorias || 0), 0);
    const tmbInfo = this._getTMB();
    let balanco = null;
    if (tmbInfo) {
      const fator = hp.fator_atividade || 1.4;
      const exHojeKcal = (this.state.exercicios || []).filter(e => e.data === hoje).reduce((s, e) => s + (e.calorias || 0), 0);
      const gasto = Math.round(tmbInfo.valor * fator + exHojeKcal);
      balanco = { consumido: consumidoHoje, gasto, saldo: consumidoHoje - gasto, em_deficit: (consumidoHoje - gasto) < 0 };
    }
    const alimentacao = refeicoesHoje.length ? { refeicoes_hoje: refeicoesHoje.length, calorias_consumidas: consumidoHoje, itens: refeicoesHoje.map(r => r.descricao).filter(Boolean).slice(0, 6) } : null;

    // GLP-1: doses e efeitos (diferencial de nicho — agora chega na IA)
    const doses = (this.state.doses || []).slice(0, 5).map(d => ({ data: d.data, medicamento: d.medicamento, dose: d.dose }));
    const efeitos = (this.state.efeitos || []).slice(0, 8).map(e => ({ data: e.data, tipo: e.tipo, intensidade: e.intensidade }));

    // Dados clínicos do perfil (antes coletados e IGNORADOS — agora usados)
    const clinico = {
      condicoes: hp.condicoes || null, glicemia: hp.glicemia || null,
      pressao: (hp.pa_sistolica && hp.pa_diastolica) ? `${hp.pa_sistolica}/${hp.pa_diastolica}` : null,
      fc_repouso: hp.fc_repouso || null, sono_habitual: hp.sono || null, stress: hp.stress || null,
      medicamentos: hp.medicamentos || null
    };

    // MEMÓRIA do usuário — o que a IA já aprendeu sobre a pessoa
    const memoria = (this.state.memoria || []).slice(0, 12).map(m => m.conteudo);

    const ctx = {
      nome: this.state.profile?.nome || null,
      altura: this.altura,
      meta_kg: this.metaKg.toFixed(1),
      peso_atual: pesoAtual, peso_inicial: pesoInicial,
      objetivo: hp.objetivo || null,
      urgencia: hp.urgencia || null,
      historico_peso: profundo ? sorted.slice(-30) : sorted.slice(-12),
      submetas: this.state.submetas.slice(0, 5),
      exercicios_semana: exResumo,
      cintura_cm: ultMedida?.cintura || null,
      relacao_cintura_quadril: rcq,
      composicao_corporal: composicao,
      humor_hoje: mood,
      alimentacao_hoje: alimentacao,
      balanco_calorico: balanco,
      doses_glp1: doses.length ? doses : null,
      efeitos_colaterais: efeitos.length ? efeitos : null,
      dados_clinicos: clinico,
      memoria_usuario: memoria.length ? memoria : null
    };
    return ctx;
  },

  // E-mail(s) com acesso ilimitado (admin). Ajuste com o seu.
  _ADMIN_EMAILS: ['dilson@acacianegocios.com.br'],

  _isAdmin() {
    const email = (this.state.profile?.email || '').toLowerCase();
    if (this._ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)) return true;
    // fallback: plano marcado como admin no banco (via SQL)
    return this.state.healthProfile?.plano === 'admin';
  },
  _isPago() {
    const p = this.state.healthProfile?.plano;
    return p === 'pro' || p === 'med' || p === 'admin';
  },

  // ANÁLISE COMPLETA — mergulho profundo da IA na pessoa inteira.
  // Limite: 1/dia no grátis; ilimitado pra pago e admin. (Trava real fica no endpoint.)
  async pedirAnaliseCompleta() {
    const el = document.getElementById('analiseResultado');
    const btn = document.getElementById('btnAnaliseCompleta');
    const ilimitado = this._isAdmin() || this._isPago();

    // Trava client-side (UX). A trava anti-burla é server-side (ver endpoint).
    if (!ilimitado) {
      try {
        const user = await window.VitaleAuth.getUser();
        const hoje = this._hojeSP();
        const { data: logs } = await window.sb.from('analise_log').select('id, resultado').eq('user_id', user.id).eq('data', hoje);
        if (logs && logs.length > 0) {
          // já usou hoje — mostra a última e oferece upgrade
          if (el) el.innerHTML = `<div class="alert alert-warning">📊 Você já fez sua análise de hoje (1/dia no plano grátis). ${logs[0].resultado ? '' : ''}</div>
            ${logs[0].resultado ? `<div style="margin-top:12px">${logs[0].resultado}</div>` : ''}
            <div style="margin-top:14px;padding:14px;background:rgba(212,168,67,0.08);border-radius:10px;text-align:center">
              <p style="font-size:13px;margin-bottom:8px">Quer análises ilimitadas e acompanhamento profundo?</p>
              <strong style="color:var(--gold)">Conheça o VITALE PRO</strong>
            </div>`;
          return;
        }
      } catch (e) { /* se falhar a checagem, deixa seguir — endpoint barra */ }
    }

    if (btn) { btn.disabled = true; btn.textContent = '🧠 Analisando sua evolução...'; }
    if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--textm)">🧠 A IA está analisando seu histórico completo...</div>';

    try {
      const ctx = this._buildContextoIA({ profundo: true });
      const { data: { session } } = await window.sb.auth.getSession();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ tipo: 'analise_completa', contexto: ctx })
      });
      if (!res.ok) {
        if (res.status === 429) { // limite do servidor
          if (el) el.innerHTML = '<div class="alert alert-warning">📊 Limite diário de análise atingido. No plano grátis é 1 por dia.</div>';
          return;
        }
        throw new Error('API ' + res.status);
      }
      const data = await res.json();
      const texto = data.message || 'Não consegui gerar a análise agora. Tente novamente.';
      if (el) el.innerHTML = `<div style="line-height:1.7">${texto}</div>
        <p style="font-size:11px;color:var(--textm);margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">⚕️ Análise gerada por IA com base nos seus registros e em conhecimento de saúde atualizado. <strong>É apoio, não diagnóstico.</strong> Sempre leve suas dúvidas ao seu médico.</p>`;
      // registra uso + guarda resultado (pra reexibir sem gastar IA)
      try {
        const user = await window.VitaleAuth.getUser();
        await window.sb.from('analise_log').insert({ user_id: user.id, resultado: texto });
      } catch (e) { /* não bloqueia a exibição */ }
    } catch (e) {
      if (el) el.innerHTML = '<div class="alert alert-error">❌ Não consegui analisar agora. Tente em instantes.</div>';
      if (window.VitaleErr) window.VitaleErr.log('analise_completa', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🧠 Gerar Análise Completa'; }
    }
  },

  async generateCoachMessageAI() {
    const enabled = await window.VitaleFlags.isEnabled('coach_ia');
    if (!enabled) return this.generateCoachMessage();

    const sorted = this.getSorted();
    if (sorted.length < 2) return this.generateCoachMessage();

    const el = document.getElementById('coachMessage');
    if (!el) return;

    // CACHE 5min: economiza tokens em refresh/troca de aba
    const CACHE_TTL = 5 * 60 * 1000;
    if (this.state.coachCache && (Date.now() - this.state.coachCache.when) < CACHE_TTL) {
      el.innerHTML = this.state.coachCache.message;
      return;
    }

    const hp = this.state.healthProfile || {};
    // Resumo de exercícios da última semana
    const seteDias = new Date(); seteDias.setDate(seteDias.getDate() - 7);
    const exSemana = (this.state.exercicios || []).filter(e => new Date(e.data) >= seteDias);
    const exResumo = exSemana.length ? {
      treinos: exSemana.length,
      minutos: exSemana.reduce((s, e) => s + e.duracao_min, 0),
      kcal: exSemana.reduce((s, e) => s + (e.calorias || 0), 0),
      tipos: [...new Set(exSemana.map(e => e.tipo))]
    } : null;
    // Última medida + RCQ
    const ultMedida = (this.state.medidas || [])[0] || null;
    const rcq = ultMedida ? this._calcRCQ(ultMedida.cintura, ultMedida.quadril) : null;
    // Mood de hoje
    const mood = this.state.moodHoje ? {
      humor: this.state.moodHoje.humor, energia: this.state.moodHoje.energia, sono: this.state.moodHoje.sono
    } : null;
    // Alimentação de hoje + balanço calórico
    const hoje = this._hojeSP();
    const refeicoesHoje = (this.state.refeicoes || []).filter(r => r.data === hoje);
    const consumidoHoje = refeicoesHoje.reduce((s, r) => s + (r.calorias || 0), 0);
    const tmbInfo = this._getTMB();
    let balanco = null;
    if (tmbInfo) {
      const fator = hp.fator_atividade || 1.4;
      const exHojeKcal = (this.state.exercicios || []).filter(e => e.data === hoje).reduce((s, e) => s + (e.calorias || 0), 0);
      const gasto = Math.round(tmbInfo.valor * fator + exHojeKcal);
      balanco = { consumido: consumidoHoje, gasto, saldo: consumidoHoje - gasto, em_deficit: (consumidoHoje - gasto) < 0 };
    }
    const alimentacao = refeicoesHoje.length ? {
      refeicoes_hoje: refeicoesHoje.length,
      calorias_consumidas: consumidoHoje,
      itens: refeicoesHoje.map(r => r.descricao).filter(Boolean).slice(0, 6)
    } : null;

    const ctx = this._buildContextoIA({ profundo: false });

    try {
      const { data: { session } } = await window.sb.auth.getSession();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ tipo: 'coach', contexto: ctx })
      });
      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();
      if (data.message) {
        el.innerHTML = data.message;
        // Salva no cache
        this.state.coachCache = { message: data.message, when: Date.now() };
      } else this.generateCoachMessage();
    } catch (e) {
      if (window.VitaleErr) window.VitaleErr.log('coach_ia', e);
      this.generateCoachMessage();
    }
  },

  // =====================================================
  // CHART
  // =====================================================
  // Filtro de data do dashboard (afeta SÓ a visualização do gráfico,
  // nunca os cálculos de projeção/coach, que sempre usam a série completa)
  dashFiltro: { de: null, ate: null },

  aplicarFiltroDashboard() {
    this.dashFiltro = {
      de: document.getElementById('dashFiltroDe')?.value || null,
      ate: document.getElementById('dashFiltroAte')?.value || null
    };
    this.buildWeightChart();
    this.buildIMCChart();
    this.buildMedidasChart();
    this.buildComposicaoChart();
    this._atualizarInfoFiltro();
  },

  limparFiltroDashboard() {
    this.dashFiltro = { de: null, ate: null };
    const de = document.getElementById('dashFiltroDe');
    const ate = document.getElementById('dashFiltroAte');
    if (de) de.value = '';
    if (ate) ate.value = '';
    this.buildWeightChart();
    this.buildIMCChart();
    this.buildMedidasChart();
    this.buildComposicaoChart();
    this._atualizarInfoFiltro();
  },

  // Helper central: um registro (por data) está dentro do filtro ativo?
  _dentroDoFiltro(dataStr) {
    const de = this.dashFiltro?.de ? (this._normData ? this._normData(this.dashFiltro.de) : this.dashFiltro.de) : null;
    const ate = this.dashFiltro?.ate ? (this._normData ? this._normData(this.dashFiltro.ate) : this.dashFiltro.ate) : null;
    const d = this._normData ? this._normData(dataStr) : dataStr;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  },

  _atualizarInfoFiltro() {
    const info = document.getElementById('dashFiltroInfo');
    if (!info) return;
    const f = this.dashFiltro || {};
    if (f.de || f.ate) {
      const de = f.de ? this.fmt(f.de) : 'início';
      const ate = f.ate ? this.fmt(f.ate) : 'hoje';
      info.style.display = '';
      info.innerHTML = `📅 Filtrando de <strong>${de}</strong> até <strong>${ate}</strong> — afeta todos os gráficos`;
    } else {
      info.style.display = 'none';
    }
  },

  buildWeightChart() {
    const canvas = document.getElementById('weightChart');
    if (!canvas) return;
    let sorted = this.getSorted();
    if (sorted.length < 2) return;

    // Aplica filtro de data SOMENTE à série exibida no gráfico
    const de = this._normData ? this._normData(this.dashFiltro.de) : this.dashFiltro.de;
    const ate = this._normData ? this._normData(this.dashFiltro.ate) : this.dashFiltro.ate;
    const projecaoAtiva = !de && !ate; // só projeta quando vê a série inteira
    if (de) sorted = sorted.filter(w => (this._normData ? this._normData(w.date) : w.date) >= de);
    if (ate) sorted = sorted.filter(w => (this._normData ? this._normData(w.date) : w.date) <= ate);
    if (sorted.length < 2) {
      // Faixa estreita demais: mostra aviso no lugar do gráfico
      if (this.state.chartInstance) { this.state.chartInstance.destroy(); this.state.chartInstance = null; }
      const ctxEmpty = canvas.getContext('2d');
      ctxEmpty.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const first = sorted[0], last = sorted[sorted.length - 1];
    const diasTotal = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
    const velDiaria = diasTotal > 0 ? (first.peso - last.peso) / diasTotal : 0;

    const allPesos = sorted.map(w => w.peso);
    const pesoMax = Math.max(...allPesos);
    const yMax = Math.ceil(pesoMax + 3);
    const yMin = Math.floor(this.metaKg - 3);

    const labels = sorted.map(w => this.fmt(w.date));
    const realData = sorted.map(w => w.peso);
    const projData = new Array(sorted.length - 1).fill(null);
    projData.push(last.peso);

    if (velDiaria > 0 && projecaoAtiva) {
      const diasParaMeta = Math.ceil((last.peso - this.metaKg) / velDiaria);
      const projSteps = 4;
      for (let i = 1; i <= projSteps; i++) {
        const diasOffset = Math.round(diasParaMeta / projSteps * i);
        const futDate = new Date(last.date + 'T12:00:00');
        futDate.setDate(futDate.getDate() + diasOffset);
        labels.push(this.fmt(futDate.toISOString().slice(0, 10)));
        realData.push(null);
        projData.push(Math.max(last.peso - velDiaria * diasOffset, this.metaKg));
      }
    }

    const metaLine = new Array(labels.length).fill(this.metaKg);

    // SPOTS DE META: marca onde cada submeta cai sobre a projeção (com data estimada)
    const spotData = new Array(labels.length).fill(null);
    const spotInfo = {}; // índice → texto do tooltip
    if (velDiaria > 0 && projecaoAtiva && this.state.submetas?.length) {
      this.state.submetas.forEach(sm => {
        const alvo = sm.pesoAlvo;
        if (alvo >= last.peso || alvo < this.metaKg) return; // já passou ou abaixo da meta final
        const diasAteAlvo = Math.ceil((last.peso - alvo) / velDiaria);
        const dataAlvo = new Date(last.date + 'T12:00:00');
        dataAlvo.setDate(dataAlvo.getDate() + diasAteAlvo);
        const labelAlvo = this.fmt(dataAlvo.toISOString().slice(0, 10));
        // Adiciona um ponto novo no eixo pra essa submeta
        labels.push(labelAlvo);
        realData.push(null);
        projData.push(null);
        metaLine.push(this.metaKg);
        spotData.push(alvo);
        spotInfo[labels.length - 1] = `🎯 Meta ${alvo}kg em ${labelAlvo}`;
      });
    }
    // Repreenche spotData no tamanho final
    while (spotData.length < labels.length) spotData.push(null);

    // MARCADORES DE DOSE: mostra no gráfico onde houve mudança de dose do GLP-1
    const doseMarkers = new Array(labels.length).fill(null);
    const doseInfo = {};
    const doses = this.state.doses || [];
    if (doses.length) {
      // mapeia cada dose à data de peso mais próxima (mesmo dia ou anterior)
      doses.forEach(dose => {
        const dDose = this._normData ? this._normData(dose.data) : dose.data;
        // acha o índice do peso real na mesma data (ou a mais próxima antes)
        let idx = -1;
        for (let i = 0; i < sorted.length; i++) {
          const dPeso = this._normData ? this._normData(sorted[i].date) : sorted[i].date;
          if (dPeso <= dDose) idx = i; else break;
        }
        if (idx >= 0 && realData[idx] != null) {
          doseMarkers[idx] = realData[idx];
          doseInfo[idx] = `💉 ${dose.medicamento} ${dose.dose} (${this.fmt(dose.data)})`;
        }
      });
    }
    this._doseInfo = doseInfo;

    const ctx = canvas.getContext('2d');
    if (this.state.chartInstance) this.state.chartInstance.destroy();
    this._spotInfo = spotInfo;

    this.state.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Real', data: realData, borderColor: '#27c47d', backgroundColor: 'rgba(39,196,125,0.08)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#27c47d', pointBorderColor: '#0d1223', pointBorderWidth: 2, tension: 0.4, fill: true, spanGaps: false },
          { label: 'Projeção', data: projData, borderColor: '#d4a843', backgroundColor: 'rgba(212,168,67,0.04)', borderWidth: 2, borderDash: [6, 4], pointRadius: 4, pointBackgroundColor: '#d4a843', pointBorderColor: '#0d1223', pointBorderWidth: 2, tension: 0.3, fill: false, spanGaps: true },
          { label: 'Meta', data: metaLine, borderColor: 'rgba(232,80,74,0.5)', borderWidth: 1.5, borderDash: [3, 5], pointRadius: 0, fill: false },
          { label: 'Submetas', data: spotData, borderColor: 'transparent', backgroundColor: '#e8924a', pointRadius: 8, pointStyle: 'star', pointBorderColor: '#fff', pointBorderWidth: 1, showLine: false },
          { label: 'Dose', data: doseMarkers, borderColor: 'transparent', backgroundColor: '#4a9de8', pointRadius: 7, pointStyle: 'rectRot', pointBorderColor: '#fff', pointBorderWidth: 1.5, showLine: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d1223', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
            titleColor: '#d4a843', bodyColor: '#ede8e0', padding: 12,
            callbacks: { label: (c) => {
              if (c.datasetIndex === 4 && c.raw !== null) return this._doseInfo?.[c.dataIndex] || ' 💉 Dose';
              if (c.datasetIndex === 3 && c.raw !== null) return this._spotInfo?.[c.dataIndex] || ` 🎯 ${c.raw} kg`;
              return c.raw === null ? null : ` ${c.raw.toFixed(1)}${c.datasetIndex === 2 ? ' (Meta)' : ' kg'}`;
            } }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#545870', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#545870', font: { size: 11 }, callback: v => v.toFixed(0) + ' kg' }, min: yMin, max: yMax }
        }
      }
    });
  },

  // =====================================================
  // BLOCO IMC — Mini-gráfico de evolução do IMC
  // =====================================================
  // Reaproveita a mesma série de pesos (média diária). IMC = peso/altura².
  // Faixas de classificação desenhadas como bandas de fundo (contexto clínico).
  buildIMCChart() {
    const canvas = document.getElementById('imcChart');
    if (!canvas) return;
    let sorted = this.getSorted();
    if (sorted.length < 2) {
      // Sem dados suficientes: limpa e some o card pra não mostrar gráfico vazio
      if (this.state.imcChartInstance) { this.state.imcChartInstance.destroy(); this.state.imcChartInstance = null; }
      const card = document.getElementById('imcChartCard');
      if (card) card.style.display = 'none';
      return;
    }
    const card = document.getElementById('imcChartCard');
    if (card) card.style.display = '';

    // Aplica o MESMO filtro de data do dashboard (consistência visual)
    const de = this._normData ? this._normData(this.dashFiltro.de) : this.dashFiltro.de;
    const ate = this._normData ? this._normData(this.dashFiltro.ate) : this.dashFiltro.ate;
    const projecaoAtiva = !de && !ate; // só projeta quando vê a série inteira
    if (de) sorted = sorted.filter(w => (this._normData ? this._normData(w.date) : w.date) >= de);
    if (ate) sorted = sorted.filter(w => (this._normData ? this._normData(w.date) : w.date) <= ate);
    if (sorted.length < 2) {
      if (this.state.imcChartInstance) { this.state.imcChartInstance.destroy(); this.state.imcChartInstance = null; }
      return;
    }

    const h2 = this.altura * this.altura;
    const first = sorted[0], last = sorted[sorted.length - 1];
    const labels = sorted.map(w => this.fmt(w.date));
    const imcData = sorted.map(w => parseFloat(this.calcIMC(w.peso, this.altura)));

    // Projeção de IMC: mesma matemática da projeção de peso (peso/altura²)
    const imcMeta = this.metaKg / h2; // IMC alvo (= 30 na config do app)
    const diasTotal = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
    const velDiaria = diasTotal > 0 ? (first.peso - last.peso) / diasTotal : 0;
    const projData = new Array(imcData.length - 1).fill(null);
    projData.push(imcData[imcData.length - 1]); // ancora no último ponto real

    if (velDiaria > 0 && projecaoAtiva) {
      const diasParaMeta = Math.ceil((last.peso - this.metaKg) / velDiaria);
      const projSteps = 4;
      for (let i = 1; i <= projSteps; i++) {
        const diasOffset = Math.round(diasParaMeta / projSteps * i);
        const futDate = new Date(last.date + 'T12:00:00');
        futDate.setDate(futDate.getDate() + diasOffset);
        labels.push(this.fmt(futDate.toISOString().slice(0, 10)));
        imcData.push(null);
        const pesoProj = Math.max(last.peso - velDiaria * diasOffset, this.metaKg);
        projData.push(parseFloat((pesoProj / h2).toFixed(1)));
      }
    }

    const primeiro = imcData[0];
    // "atual" = último valor REAL (ignora os nulls da projeção)
    const reais = imcData.filter(v => v != null);
    const atual = reais[reais.length - 1];
    const delta = atual - primeiro;
    const info = this.getObesidadeInfo(atual);

    // Atualiza o cabeçalho do card (IMC atual + variação + classificação)
    const hdr = document.getElementById('imcChartHeader');
    if (hdr) {
      const sinal = delta < 0 ? '↓' : delta > 0 ? '↑' : '→';
      const corDelta = delta < 0 ? 'var(--em)' : delta > 0 ? 'var(--red)' : 'var(--textm)';
      hdr.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:11px;color:var(--textm);text-transform:uppercase;letter-spacing:1px">Evolução do IMC</div>
            <div style="font-size:28px;font-weight:600;color:${info.color};line-height:1.1">${atual.toFixed(1)}
              <span style="font-size:13px;color:${info.color};font-weight:400">${info.grau}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:600;color:${corDelta}">${sinal} ${Math.abs(delta).toFixed(1)}</div>
            <div style="font-size:11px;color:var(--textm)">no período</div>
          </div>
        </div>`;
    }

    // Faixas de classificação como anotações de fundo (via plugin inline)
    // Considera tanto valores reais quanto projetados para o range do eixo
    const todosValores = [...imcData, ...projData].filter(v => v != null);
    const yMin = Math.max(Math.floor(Math.min(...todosValores) - 1), 15);
    const yMax = Math.ceil(Math.max(...todosValores) + 1);

    // Plugin que pinta as faixas de IMC no fundo
    const faixasPlugin = {
      id: 'faixasIMC',
      beforeDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const faixas = [
          { de: 0, ate: 18.5, cor: 'rgba(74,157,232,0.06)' },
          { de: 18.5, ate: 25, cor: 'rgba(39,196,125,0.06)' },
          { de: 25, ate: 30, cor: 'rgba(212,168,67,0.06)' },
          { de: 30, ate: 35, cor: 'rgba(232,146,74,0.06)' },
          { de: 35, ate: 40, cor: 'rgba(232,80,74,0.06)' },
          { de: 40, ate: 100, cor: 'rgba(192,64,192,0.06)' }
        ];
        ctx.save();
        faixas.forEach(f => {
          const y1 = scales.y.getPixelForValue(Math.min(f.ate, yMax));
          const y2 = scales.y.getPixelForValue(Math.max(f.de, yMin));
          if (y1 < chartArea.bottom && y2 > chartArea.top) {
            ctx.fillStyle = f.cor;
            const top = Math.max(y1, chartArea.top);
            const bot = Math.min(y2, chartArea.bottom);
            ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bot - top);
          }
        });
        // Linhas de referência em 25 e 30 (limites clínicos)
        [25, 30].forEach(lim => {
          if (lim >= yMin && lim <= yMax) {
            const y = scales.y.getPixelForValue(lim);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
          }
        });
        ctx.restore();
      }
    };

    const ctx = canvas.getContext('2d');
    if (this.state.imcChartInstance) this.state.imcChartInstance.destroy();
    this.state.imcChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'IMC', data: imcData,
          borderColor: info.color,
          backgroundColor: 'rgba(255,255,255,0.02)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: info.color,
          pointBorderColor: '#0d1223', pointBorderWidth: 1.5, tension: 0.4, fill: false, spanGaps: false
        }, {
          label: 'Projeção', data: projData,
          borderColor: '#d4a843', backgroundColor: 'rgba(212,168,67,0.04)',
          borderWidth: 2, borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: '#d4a843',
          pointBorderColor: '#0d1223', pointBorderWidth: 1.5, tension: 0.3, fill: false, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d1223', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
            titleColor: '#d4a843', bodyColor: '#ede8e0', padding: 10,
            callbacks: { label: (c) => c.raw == null ? null : ` IMC ${c.raw.toFixed(1)}${c.datasetIndex === 1 ? ' (projeção)' : ' — ' + this.getObesidadeInfo(c.raw).grau}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#545870', font: { size: 10 }, maxTicksLimit: 6 } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#545870', font: { size: 10 }, callback: v => v.toFixed(0) }, min: yMin, max: yMax }
        }
      },
      plugins: [faixasPlugin]
    });
  },
  updateProjecoes() {
    if (this.state.weights.length < 2) return;
    const sorted = this.getSorted();
    const first = sorted[0], last = sorted[sorted.length - 1];
    const imc = this.calcIMC(last.peso, this.altura);
    const info = this.getObesidadeInfo(imc);
    const diasTotal = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
    const velDiaria = diasTotal > 0 ? (first.peso - last.peso) / diasTotal : 0;
    const velSemanal = (velDiaria * 7).toFixed(2);
    const kgFalta = Math.max(last.peso - this.metaKg, 0).toFixed(1);

    const setText = (id, v, c) => { const el = document.getElementById(id); if (el) { el.textContent = v; if (c) el.style.color = c; } };
    setText('statusObesidade', info.grau, info.color);
    setText('velocidadePerda', `${velSemanal} kg/semana`);
    setText('imcAtualMetas', imc);
    setText('faltaMeta', `${kgFalta} kg`);

    const pt = document.getElementById('projecaoTexto');
    if (pt) {
      if (velDiaria > 0) {
        const diasParaMeta = Math.ceil((last.peso - this.metaKg) / velDiaria);
        const dataMeta = new Date(); dataMeta.setDate(dataMeta.getDate() + diasParaMeta);
        pt.innerHTML = `No ritmo atual de <strong style="color:var(--gold)">${velSemanal} kg/semana</strong>, você atingirá <strong>${this.metaKg.toFixed(1)} kg (IMC < 30)</strong> em <strong style="color:var(--em)">${this.fmtLong(dataMeta)}</strong> — ${diasParaMeta} dias.`;
      } else {
        pt.textContent = 'Adicione registros mais recentes para calcular a projeção.';
      }
    }

    const mc = document.getElementById('marcosContainer');
    if (mc) {
      const marcos = [
        { label: 'Sair Obesidade II', imc: 35, kg: 35 * this.altura * this.altura },
        { label: 'Sair Obesidade I', imc: 30, kg: 30 * this.altura * this.altura },
        { label: 'Entrar Sobrepeso', imc: 29.9, kg: 29.9 * this.altura * this.altura },
        { label: 'Peso Normal', imc: 25, kg: 25 * this.altura * this.altura }
      ];
      mc.innerHTML = marcos.map(m => {
        const falta = last.peso - m.kg;
        const reached = parseFloat(imc) <= m.imc;
        const dias = !reached && velDiaria > 0 ? Math.ceil(falta / velDiaria) : 0;
        const d = new Date(); d.setDate(d.getDate() + dias);
        return `<div class="milestone ${reached ? 'achieved' : ''}">
          <div style="font-size:12px;color:var(--textm)">${m.label} (IMC < ${m.imc})</div>
          <div style="display:flex;justify-content:space-between;margin-top:6px">
            <span style="font-size:12px;color:${reached ? 'var(--em)' : 'var(--textm)'}">${reached ? '✅ Atingido!' : `Faltam ${Math.max(falta, 0).toFixed(1)} kg`}</span>
            <span style="font-size:12px;color:var(--gold)">${!reached && falta > 0 ? this.fmtLong(d) : ''}</span>
          </div>
        </div>`;
      }).join('');
    }
    this.updateSubmetasUI();
  },

  // =====================================================
  // PESOS — CRUD
  // =====================================================
  // Adiciona um peso. Múltiplos registros por dia são permitidos.
  // Não usa upsert: cada chamada é um INSERT.
  async addWeight(date, peso, origem = 'manual', hora = null) {
    if (!date || isNaN(peso) || peso <= 0) throw new Error('Dados inválidos');
    if (peso > 500) throw new Error('Peso parece inválido');

    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
    if (new Date(date + 'T23:59:59') > hoje) throw new Error('Data não pode ser futura');

    const userId = (await window.VitaleAuth.getUser()).id;
    const payload = { user_id: userId, data: date, peso, origem };
    if (hora) payload.hora = hora;

    const { data, error } = await window.sb
      .from('weights')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    // Adiciona em weightsRaw
    this.state.weightsRaw.unshift({
      id: data.id, date: data.data, hora: data.hora, peso: parseFloat(data.peso),
      origem: data.origem, createdAt: data.created_at
    });

    // Recalcula média do dia em state.weights
    this._recomputeDailyAverage(date);

    if (window.VitaleAnalytics) window.VitaleAnalytics.track('weight_add', { origem });
    this._invalidateCoachCache();
    this.updateDashboard();
    this.checkConquistas(); // gamificação: pode desbloquear badge de peso/IMC/streak
    return data;
  },

  // Recalcula média diária para um dia específico (sincroniza state.weights com weightsRaw)
  _recomputeDailyAverage(date) {
    const doDia = this.state.weightsRaw.filter(w => w.date === date);
    const idx = this.state.weights.findIndex(w => w.date === date);
    if (!doDia.length) {
      if (idx >= 0) this.state.weights.splice(idx, 1);
      return;
    }
    const media = doDia.reduce((s, w) => s + w.peso, 0) / doDia.length;
    const entry = { date, peso: parseFloat(media.toFixed(2)), registros_dia: doDia.length };
    if (idx >= 0) this.state.weights[idx] = entry;
    else {
      this.state.weights.push(entry);
      this.state.weights.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
  },

  async deletePeso(id) {
    if (!confirm('Remover este registro?')) return;
    const reg = this.state.weightsRaw.find(w => w.id === id);
    const { error } = await window.sb.from('weights').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.weightsRaw = this.state.weightsRaw.filter(w => w.id !== id);
    if (reg) this._recomputeDailyAverage(reg.date);
    this._invalidateCoachCache();
    this.updateDashboard();
    this.showAlert('success', '✅ Registro removido');
  },

  async adicionarPesoManual() {
    const date = document.getElementById('manualDate').value;
    const pesoRaw = document.getElementById('manualPeso').value.replace(',', '.');
    const peso = parseFloat(pesoRaw);
    if (!date || isNaN(peso) || peso <= 0) return this.showAlert('error', 'Preencha data e peso válidos!');
    if (peso > 500) return this.showAlert('error', 'Peso parece inválido (> 500 kg).');

    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
    if (new Date(date + 'T23:59:59') > hoje) return this.showAlert('error', 'Data não pode ser futura.');

    // NOVO COMPORTAMENTO: múltiplos pesos/dia são permitidos.
    // Se já existe registro nessa data, apenas avisa e pergunta se quer adicionar OUTRO.
    const doDia = this.state.weightsRaw.filter(w => w.date === date);
    if (doDia.length > 0) {
      const lista = doDia.map(w => `${w.peso.toFixed(1)} kg${w.hora ? ' às ' + w.hora.slice(0, 5) : ''}`).join(', ');
      const confirma = confirm(
        `Já existe(m) ${doDia.length} registro(s) em ${this.fmtStr(date)}: ${lista}.\n\n` +
        `Adicionar ${peso.toFixed(1)} kg como NOVO registro? (a média diária será recalculada)\n\n` +
        `Cancelar = não adicionar.`
      );
      if (!confirma) return;
    }

    try {
      // Pega hora atual no formato HH:MM:SS pra desambiguar registros do mesmo dia
      const agora = new Date();
      const hh = String(agora.getHours()).padStart(2, '0');
      const mm = String(agora.getMinutes()).padStart(2, '0');
      const hora = `${hh}:${mm}:00`;
      await this.addWeight(date, peso, 'manual', hora);
      document.getElementById('manualDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('manualPeso').value = '';
      this.showAlert('success', `✅ ${peso.toFixed(1)} kg adicionado para ${this.fmt(date)}!`);
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('add_weight_manual', e);
    }
  },

  async importarTexto() {
    const text = document.getElementById('textInput').value;
    if (!text.trim()) return this.showAlert('error', 'Cole os dados primeiro!');

    // Aceita múltiplos por dia. Cada linha vira um registro independente.
    const todos = [];
    text.split('\n').forEach(line => {
      const m = line.match(/(\d{4}-\d{2}-\d{2})[:\s]+(\d+[.,]?\d*)\s*kg?/i);
      if (m) {
        const date = m[1], peso = parseFloat(m[2].replace(',', '.'));
        if (!isNaN(peso) && peso > 0 && peso < 500) {
          todos.push({ date, peso });
        }
      }
    });

    if (!todos.length) return this.showAlert('error', 'Nenhum dado válido (formato: 2026-03-16: 114.3kg)');

    this.state.tempImportacao = todos;
    this.showConfirmModal(todos, 'Dados do Texto');
  },

  showConfirmModal(dados, title) {
    // Agrupa por data para visualização
    const porData = {};
    dados.forEach(d => {
      if (!porData[d.date]) porData[d.date] = [];
      porData[d.date].push(d.peso);
    });

    const datasOrdenadas = Object.keys(porData).sort();
    const rows = datasOrdenadas.map(date => {
      const pesos = porData[date];
      if (pesos.length === 1) {
        return `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <span>${this.fmt(date)}</span>
          <span style="color:var(--gold);font-weight:700">${pesos[0].toFixed(1)} kg</span>
        </div>`;
      }
      const media = (pesos.reduce((s, p) => s + p, 0) / pesos.length).toFixed(1);
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;justify-content:space-between">
          <span>${this.fmt(date)} <span style="color:var(--cyan);font-size:11px">(${pesos.length} pesagens)</span></span>
          <span style="color:var(--gold);font-weight:700">média ${media} kg</span>
        </div>
        <div style="font-size:11px;color:var(--textm);margin-top:4px">${pesos.map(p => p.toFixed(1)).join(', ')} kg</div>
      </div>`;
    }).join('');

    const aviso = dados.length > Object.keys(porData).length
      ? `<div style="background:rgba(74,157,232,0.08);border-left:3px solid var(--cyan);padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--cyan)">ℹ️ Múltiplas pesagens no mesmo dia serão salvas separadamente. O dashboard mostrará a <strong>média do dia</strong>.</div>`
      : '';

    document.getElementById('resumoImportacao').innerHTML =
      `<h4 style="margin:0 0 12px;color:var(--gold)">${title} — ${dados.length} registro(s) em ${Object.keys(porData).length} dia(s)</h4>${aviso}${rows}`;
    document.getElementById('modalConfirmacao').classList.add('active');
  },

  // INSERT em lote (não upsert). Múltiplos pesos/dia OK.
  async confirmarImportacao() {
    if (!this.state.tempImportacao) return;
    const items = this.state.tempImportacao;
    const userId = (await window.VitaleAuth.getUser()).id;
    try {
      const rows = items.map(i => ({
        user_id: userId,
        data: i.date,
        peso: i.peso,
        origem: i.origem || 'texto',
        hora: i.hora || null
      }));
      const { error } = await window.sb.from('weights').insert(rows);
      if (error) throw error;
      this.state.tempImportacao = null;
      // Recarrega tudo do banco
      this.state.weights = await this.loadWeights();
      this.state.weightsRaw = await this.loadWeightsRaw();
      this.closeModal('modalConfirmacao');
      this._invalidateCoachCache();
      this.updateDashboard();
      this.checkConquistas(); // gamificação após importação
      const count = items.length;
      this.showAlert('success', `✅ ${count} registro(s) importado(s)!`);
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('import_batch', { count });

      const imgEl = document.querySelector('#imagePreview img');
      if (imgEl) {
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('btnProcessarImagem').style.display = 'none';
        const ocrR = document.getElementById('ocrResult'); if (ocrR) ocrR.innerHTML = '';
      }
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('import_batch', e);
    }
  },

  // =====================================================
  // OCR — FIX: Authorization Bearer + compressão de imagem
  // =====================================================
  handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return this.showAlert('error', 'Arquivo muito grande (máx 10MB)');
    const ocrR = document.getElementById('ocrResult'); if (ocrR) ocrR.innerHTML = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = document.createElement('img');
      img.src = ev.target.result;
      img.style.cssText = 'max-width:100%;border-radius:8px;margin-bottom:8px';
      document.getElementById('imagePreview').innerHTML = '';
      document.getElementById('imagePreview').appendChild(img);
      document.getElementById('btnProcessarImagem').style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  // FASE A — Foto de alimento → IA estima calorias
  handleFoodUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return this.showAlert('error', 'Arquivo muito grande (máx 10MB)');
    const r = document.getElementById('foodResult'); if (r) r.innerHTML = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = document.createElement('img');
      img.src = ev.target.result;
      img.style.cssText = 'max-width:100%;border-radius:8px;margin-bottom:8px';
      const prev = document.getElementById('foodPreview');
      prev.innerHTML = ''; prev.appendChild(img);
      document.getElementById('btnProcessarFood').style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  // FASE A — Texto livre → IA estima calorias (sem foto)
  async processarTextoAlimento() {
    const txt = document.getElementById('foodTexto')?.value.trim();
    if (!txt) return this.showAlert('error', 'Escreva o que você comeu.');
    const btn = document.getElementById('btnProcessarTexto');
    const out = document.getElementById('foodTextoResult');
    btn.disabled = true; btn.textContent = '⏳ Analisando...';
    try {
      const session = await window.sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ modo: 'alimento_texto', texto: txt })
      });
      if (!res.ok) {
        const ed = await res.json().catch(() => ({}));
        throw new Error(`IA ${res.status}: ${ed.error || res.statusText}`);
      }
      const data = await res.json();
      const a = data.alimento || data;
      if (a && (a.calorias || a.descricao)) {
        const d = document.getElementById('ref_desc'); if (d) d.value = a.descricao || txt;
        const c = document.getElementById('ref_cal'); if (c && a.calorias) c.value = a.calorias;
        const p = document.getElementById('ref_peso'); if (p && a.peso_g) p.value = a.peso_g;
        this._refeicaoOrigem = 'texto';
        out.innerHTML = `<div class="alert alert-success" style="margin-bottom:10px">✅ Estimativa: <strong>${a.calorias || '?'} kcal</strong> — ${this._escapeHtml(a.descricao || txt)}. Revise os valores abaixo se quiser.</div>
          <button class="btn btn-primary" onclick="VITALE_CORE.salvarRefeicao()" style="width:100%;font-size:15px;padding:14px">✅ Confirmar e Salvar Refeição</button>`;
        document.getElementById('ref_desc')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        out.innerHTML = `<div class="alert alert-warning">⚠️ Não consegui estimar. Tente detalhar mais ou preencha manualmente.</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="alert alert-error">❌ ${e.message}</div>`;
      if (window.VitaleErr) window.VitaleErr.log('texto_alimento', e);
    } finally {
      btn.disabled = false; btn.textContent = '🔍 ESTIMAR COM IA';
    }
  },

  // FASE B — Print de app de exercício → IA extrai dados
  handleExercUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return this.showAlert('error', 'Arquivo muito grande (máx 10MB)');
    const r = document.getElementById('exercFotoResult'); if (r) r.innerHTML = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = document.createElement('img');
      img.src = ev.target.result;
      img.style.cssText = 'max-width:100%;border-radius:8px;margin-bottom:8px';
      const prev = document.getElementById('exercFotoPreview');
      prev.innerHTML = ''; prev.appendChild(img);
      document.getElementById('btnProcessarExercFoto').style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  async processarFotoExercicio() {
    const imgEl = document.querySelector('#exercFotoPreview img');
    if (!imgEl) return this.showAlert('error', 'Selecione um print primeiro.');
    const btn = document.getElementById('btnProcessarExercFoto');
    const out = document.getElementById('exercFotoResult');
    btn.disabled = true; btn.textContent = '⏳ Analisando...';
    try {
      const compressed = await this._compressImageForOCR(imgEl.src);
      const base64 = compressed.split(',')[1];
      const session = await window.sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ image: base64, mime: 'image/jpeg', modo: 'exercicio' })
      });
      if (!res.ok) {
        const ed = await res.json().catch(() => ({}));
        throw new Error(`IA ${res.status}: ${ed.error || res.statusText}`);
      }
      const data = await res.json();
      const ex = data.exercicio || data;
      if (ex && (ex.tipo || ex.duracao_min)) {
        if (ex.tipo) this.exercDraft.tipo = ex.tipo;
        if (ex.intensidade) this.exercDraft.intensidade = ex.intensidade;
        if (ex.duracao_min) { const d = document.getElementById('exercDuracao'); if (d) d.value = ex.duracao_min; }
        this._renderExercForm();
        const resumo = `${ex.tipo || '?'} · ${ex.duracao_min || '?'}min${ex.calorias ? ' · ' + ex.calorias + ' kcal' : ''}`;
        out.innerHTML = `<div class="alert alert-success" style="margin-bottom:10px">✅ Detectado: <strong>${resumo}</strong>. Revise abaixo.</div>
          <button class="btn btn-primary" onclick="VITALE_CORE.salvarExercicio()" style="width:100%;font-size:15px;padding:14px">✅ Confirmar e Salvar Exercício</button>`;
        document.getElementById('exercDuracao')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        out.innerHTML = `<div class="alert alert-warning">⚠️ Não identifiquei o treino. Preencha manualmente.</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="alert alert-error">❌ ${e.message}</div>`;
      if (window.VitaleErr) window.VitaleErr.log('foto_exercicio', e);
    } finally {
      btn.disabled = false; btn.textContent = '🔍 EXTRAIR COM IA';
    }
  },

  async processarFotoAlimento() {
    const imgEl = document.querySelector('#foodPreview img');
    if (!imgEl) return this.showAlert('error', 'Selecione uma foto primeiro.');
    const btn = document.getElementById('btnProcessarFood');
    const out = document.getElementById('foodResult');
    const pesoInformado = parseInt(document.getElementById('ref_peso')?.value) || null;
    btn.disabled = true; btn.textContent = '⏳ Analisando...';
    try {
      const compressed = await this._compressImageForOCR(imgEl.src);
      const base64 = compressed.split(',')[1];
      const mimeType = 'image/jpeg';
      const session = await window.sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ image: base64, mime: mimeType, modo: 'alimento', peso_g: pesoInformado })
      });
      if (!res.ok) {
        const ed = await res.json().catch(() => ({}));
        throw new Error(`IA ${res.status}: ${ed.error || res.statusText}`);
      }
      const data = await res.json();
      const a = data.alimento || data;
      if (a && (a.calorias || a.descricao)) {
        if (a.descricao) { const d = document.getElementById('ref_desc'); if (d) d.value = a.descricao; }
        if (a.calorias) { const c = document.getElementById('ref_cal'); if (c) c.value = a.calorias; }
        if (a.peso_g && !pesoInformado) { const p = document.getElementById('ref_peso'); if (p) p.value = a.peso_g; }
        this._refeicaoOrigem = 'foto';
        out.innerHTML = `<div class="alert alert-success" style="margin-bottom:10px">✅ Estimativa: <strong>${a.calorias || '?'} kcal</strong>${a.descricao ? ' — ' + this._escapeHtml(a.descricao) : ''}. Revise os valores abaixo se quiser.</div>
          <button class="btn btn-primary" onclick="VITALE_CORE.salvarRefeicao()" style="width:100%;font-size:15px;padding:14px">✅ Confirmar e Salvar Refeição</button>`;
        document.getElementById('ref_desc')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        out.innerHTML = `<div class="alert alert-warning">⚠️ Não consegui identificar o alimento. Preencha manualmente.</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="alert alert-error">❌ ${e.message}</div>`;
      if (window.VitaleErr) window.VitaleErr.log('foto_alimento', e);
    } finally {
      btn.disabled = false; btn.textContent = '🔍 ESTIMAR COM IA';
    }
  },
  // Redimensiona pra máx 1280px (lado maior) e converte pra JPEG q=0.85.
  // Reduz token cost da Anthropic significativamente (até 80%).
  async _compressImageForOCR(srcDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // fundo branco caso PNG transparente
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = srcDataUrl;
    });
  },

  // Modo do OCR: 'peso' (padrão) ou 'bioimpedancia'
  ocrModo: 'peso',
  setOcrModo(modo) {
    this.ocrModo = modo;
    const bp = document.getElementById('ocrModoPeso');
    const bb = document.getElementById('ocrModoBio');
    if (bp) bp.style.borderColor = modo === 'peso' ? 'var(--gold)' : 'var(--border)';
    if (bb) bb.style.borderColor = modo === 'bioimpedancia' ? 'var(--gold)' : 'var(--border)';
  },

  async processarImagemOCR() {
    const btn = document.getElementById('btnProcessarImagem');
    const ocrDiv = document.getElementById('ocrResult');
    btn.disabled = true;
    btn.textContent = '⏳ Comprimindo imagem...';
    ocrDiv.innerHTML = '';

    const imgEl = document.querySelector('#imagePreview img');
    if (!imgEl) { btn.disabled = false; btn.textContent = '🔍 PROCESSAR COM IA'; return; }

    try {
      // FIX 4: comprime antes de enviar
      const compressed = await this._compressImageForOCR(imgEl.src);
      const base64 = compressed.split(',')[1];
      const mimeType = 'image/jpeg';

      btn.textContent = '⏳ Processando com IA...';

      const { data: { session } } = await window.sb.auth.getSession();
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ image: base64, mime: mimeType, modo: this.ocrModo })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`OCR ${res.status}: ${errData.error || res.statusText}`);
      }

      const data = await res.json();

      // Modo bioimpedância: resposta traz medidas, não peso
      if (this.ocrModo === 'bioimpedancia') {
        const m = data.medidas || data;
        // Campos de COMPOSIÇÃO corporal (não circunferências!)
        const campos = ['peso', 'gordura_pct', 'massa_gordura', 'massa_muscular', 'agua_corporal', 'gordura_visceral', 'tmb', 'imc'];
        let achou = 0;
        campos.forEach(c => {
          if (m[c] != null && !isNaN(parseFloat(m[c]))) {
            const el = document.getElementById('comp_' + c);
            if (el) { el.value = m[c]; achou++; }
          }
        });
        // Detecta a fonte do aparelho (InBody / Xiaomi) e preenche o select — editável depois
        if (m.fonte) {
          const fEl = document.getElementById('comp_fonte');
          if (fEl) fEl.value = ['inbody', 'xiaomi'].includes(m.fonte) ? m.fonte : 'outro';
        }
        if (achou > 0) {
          const fonteTxt = m.fonte ? ` (detectado: ${m.fonte === 'inbody' ? 'InBody' : m.fonte === 'xiaomi' ? 'Xiaomi' : m.fonte})` : '';
          ocrDiv.innerHTML = `<div class="alert alert-success" style="margin-bottom:10px">✅ IA preencheu ${achou} campo(s)${fonteTxt}. Revise a fonte e os valores abaixo.</div>
            <button class="btn btn-primary" onclick="VITALE_CORE.salvarComposicao()" style="width:100%;font-size:15px;padding:14px">✅ Confirmar e Salvar Composição</button>`;
          document.getElementById('comp_peso')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          ocrDiv.innerHTML = `<div class="alert alert-warning">⚠️ Nenhum dado identificado. Tente um print mais nítido ou preencha manualmente.</div>`;
        }
        return;
      }

      // Modo peso (padrão)
      if (data.registros && data.registros.length > 0) {
        const items = data.registros.map(r => ({ ...r, origem: 'ocr' }));
        this.state.tempImportacao = items;
        this.showConfirmModal(items, 'Extraído via IA');
        ocrDiv.innerHTML = `<div class="alert alert-success">✅ IA encontrou ${items.length} registro(s). Confirme abaixo.</div>`;
        if (window.VitaleAnalytics) window.VitaleAnalytics.track('ocr_success', { count: items.length });
      } else {
        ocrDiv.innerHTML = `<div class="alert alert-warning">⚠️ Nenhum dado de peso identificado na imagem.</div>`;
      }
    } catch (err) {
      ocrDiv.innerHTML = `<div class="alert alert-error">❌ ${err.message}</div>`;
      if (window.VitaleErr) window.VitaleErr.log('ocr_processar', err);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 PROCESSAR COM IA';
    }
  },

  // =====================================================
  // SUBMETAS — CRUD
  // =====================================================
  selectedSubIcon: '🎯',

  selectSubIcon(el, icon) {
    this.selectedSubIcon = icon;
    document.querySelectorAll('[onclick*="selectSubIcon"]').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  },

  async adicionarSubmeta() {
    const nome = document.getElementById('subNome').value.trim();
    const peso = parseFloat(document.getElementById('subPeso').value);
    const data = document.getElementById('subData').value;
    if (!nome) return this.showAlert('error', 'Dê um nome à submeta!');
    if (isNaN(peso) || peso <= 0) return this.showAlert('error', 'Informe o peso alvo!');

    try {
      const userId = (await window.VitaleAuth.getUser()).id;
      const { data: row, error } = await window.sb.from('submetas').insert({
        user_id: userId, nome, peso_alvo: peso, data_alvo: data || null, icone: this.selectedSubIcon
      }).select().single();
      if (error) throw error;

      this.state.submetas.unshift({
        id: row.id, nome, pesoAlvo: peso, dataAlvo: data || null, icone: this.selectedSubIcon, atingida: false
      });
      document.getElementById('subNome').value = '';
      document.getElementById('subPeso').value = '';
      document.getElementById('subData').value = '';
      this.updateSubmetasUI();
      this.showAlert('success', `✅ Submeta "${nome}" adicionada!`);
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('add_submeta', e);
    }
  },

  async removerSubmeta(id) {
    if (!confirm('Remover esta submeta?')) return;
    const { error } = await window.sb.from('submetas').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.submetas = this.state.submetas.filter(s => s.id !== id);
    this.updateSubmetasUI();
  },

  updateSubmetasUI() {
    const el = document.getElementById('submetasContainer');
    if (!el) return;
    if (!this.state.submetas.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:16px 0">Nenhuma submeta ainda 🎯</p>';
      return;
    }
    if (!this.state.weights.length) { el.innerHTML = ''; return; }

    const sorted = this.getSorted();
    const first = sorted[0];
    const current = sorted[sorted.length - 1].peso;
    const diasDecorridos = sorted.length >= 2 ? Math.max(Math.floor((new Date(sorted[sorted.length - 1].date) - new Date(first.date)) / 86400000), 1) : 1;
    const velD = sorted.length >= 2 ? (first.peso - current) / diasDecorridos : 0;

    el.innerHTML = this.state.submetas.map(s => {
      const reached = current <= s.pesoAlvo;
      const falta = Math.max(current - s.pesoAlvo, 0).toFixed(1);
      const range = first.peso - s.pesoAlvo;
      const progress = range <= 0 ? 100 : Math.min(Math.max(((first.peso - current) / range) * 100, 0), 100);
      const diasEst = !reached && velD > 0 ? Math.ceil((current - s.pesoAlvo) / velD) : null;
      const dataEst = diasEst ? (() => { const d = new Date(); d.setDate(d.getDate() + diasEst); return d; })() : null;
      const barColor = reached ? '#27c47d' : '#4a9de8';
      const targetDisplay = s.dataAlvo ? this.fmtStr(s.dataAlvo) : (dataEst ? 'Est. ' + this.fmtLong(dataEst) : '—');

      return `<div class="submeta-item ${reached ? 'reached' : ''}">
        <div class="submeta-header">
          <div>
            <div class="submeta-name">${s.icone} ${s.nome}</div>
            <div class="submeta-meta">${s.pesoAlvo.toFixed(1)} kg alvo • ${targetDisplay}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="submeta-badge ${reached ? 'reached' : 'pending'}">${reached ? '✅ Atingida' : `-${falta} kg`}</span>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerSubmeta(${s.id})">🗑️</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          <span style="font-size:11px;color:var(--textm)">${first.peso.toFixed(1)} kg</span>
          <span style="font-size:11px;color:${barColor};font-weight:700">${progress.toFixed(0)}%</span>
          <span style="font-size:11px;color:var(--textm)">${s.pesoAlvo.toFixed(1)} kg</span>
        </div>
        <div class="sub-progress-bar"><div class="sub-progress-fill" style="width:${progress.toFixed(1)}%;background:${barColor}"></div></div>
        ${!reached && diasEst ? `<p style="font-size:11px;color:var(--cyan);margin-top:6px">⏱ Estimativa: ${this.fmtLong(dataEst)} (${diasEst} dias)</p>` : ''}
        ${reached ? `<p style="font-size:11px;color:var(--em);margin-top:6px">🎉 Meta alcançada!</p>` : ''}
      </div>`;
    }).join('');
  },

  // =====================================================
  // MEDICAÇÕES — CRUD
  // =====================================================
  currentFreq: 'diario',

  selectFreq(type) {
    this.currentFreq = type;
    ['diario', 'semanal', 'especifico'].forEach(t => {
      const lbl = document.getElementById('lbl-' + t);
      const pnl = document.getElementById('panel-' + t);
      if (lbl) lbl.classList.toggle('selected', t === type);
      if (pnl) pnl.classList.toggle('open', t === type);
    });
  },

  toggleChip(el, store, val) {
    el.classList.toggle('selected');
    const arr = this.state[store];
    const idx = arr.indexOf(val);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
  },

  selectDiaSemana(el, dia) {
    document.querySelectorAll('#diasSemanaChips .checkbox-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    this.state.diaSemana = dia;
  },

  addCustomHorario() {
    const val = document.getElementById('outroHorario').value;
    if (!val || this.state.horarios.includes(val)) return;
    this.state.horarios.push(val);
    const chip = document.createElement('span');
    chip.className = 'checkbox-chip selected';
    chip.textContent = val;
    chip.onclick = () => this.toggleChip(chip, 'horarios', val);
    document.getElementById('horariosChips').appendChild(chip);
    document.getElementById('outroHorario').value = '';
  },

  async salvarAgendamento() {
    const nome = document.getElementById('medNome').value.trim();
    const dose = document.getElementById('medDose').value.trim();
    if (!nome || !dose) return this.showAlert('error', 'Preencha nome e dose!');

    let detalhes = {};
    if (this.currentFreq === 'diario') {
      if (!this.state.horarios.length) return this.showAlert('error', 'Selecione pelo menos um horário!');
      detalhes = { horarios: [...this.state.horarios] };
    } else if (this.currentFreq === 'semanal') {
      if (!this.state.diaSemana) return this.showAlert('error', 'Selecione o dia da semana!');
      detalhes = { dia: this.state.diaSemana, hora: document.getElementById('horarioSemanal').value };
    } else {
      if (!this.state.diasEsp.length) return this.showAlert('error', 'Selecione pelo menos um dia!');
      detalhes = { dias: [...this.state.diasEsp], hora: document.getElementById('horarioEspecifico').value };
    }

    try {
      const userId = (await window.VitaleAuth.getUser()).id;
      const { data, error } = await window.sb.from('medicacoes').insert({
        user_id: userId, nome, dose, frequencia: this.currentFreq, detalhes
      }).select().single();
      if (error) throw error;

      this.state.medicacoes.unshift(data);
      this.updateAgendamentos();
      document.getElementById('medNome').value = '';
      document.getElementById('medDose').value = '';
      this.state.horarios = []; this.state.diasEsp = []; this.state.diaSemana = null;
      document.querySelectorAll('.checkbox-chip').forEach(c => c.classList.remove('selected'));
      this.showAlert('success', `✅ "${nome}" agendado!`);
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('add_medicacao', e);
    }
  },

  updateAgendamentos() {
    const el = document.getElementById('agendadosContainer');
    if (!el) return;
    if (!this.state.medicacoes.length) {
      el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:20px 0">Nenhum agendamento</p>';
      return;
    }
    const DIAS = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };
    el.innerHTML = this.state.medicacoes.map(med => {
      let freq = '';
      if (med.frequencia === 'diario') freq = `Diário às ${med.detalhes.horarios?.join(', ')}`;
      else if (med.frequencia === 'semanal') freq = `${DIAS[med.detalhes.dia]} às ${med.detalhes.hora}`;
      else freq = `${med.detalhes.dias?.map(d => DIAS[d]).join(', ')} às ${med.detalhes.hora}`;
      return `<div class="med-item">
        <div class="med-info">
          <h4>${med.nome}</h4>
          <p>💊 ${med.dose}</p>
          <p>⏰ ${freq}</p>
        </div>
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerAgendamento('${med.id}')">🗑️</button>
      </div>`;
    }).join('');
  },

  async removerAgendamento(id) {
    if (!confirm('Remover este agendamento?')) return;
    const { error } = await window.sb.from('medicacoes').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.medicacoes = this.state.medicacoes.filter(m => m.id !== id);
    this.updateAgendamentos();
  },

  // =====================================================
  // HISTÓRICO
  // =====================================================
  // Estado de UI do histórico (filtro de data + seleção múltipla)
  histFiltro: { de: null, ate: null },
  histSelecionados: new Set(),

  // Aplica o filtro de datas vindo dos inputs e re-renderiza
  aplicarFiltroHistorico() {
    const de = document.getElementById('histFiltroDe')?.value || null;
    const ate = document.getElementById('histFiltroAte')?.value || null;
    this.histFiltro = { de, ate };
    this.renderHistorico();
  },

  limparFiltroHistorico() {
    this.histFiltro = { de: null, ate: null };
    const de = document.getElementById('histFiltroDe');
    const ate = document.getElementById('histFiltroAte');
    if (de) de.value = '';
    if (ate) ate.value = '';
    this.renderHistorico();
  },

  // Normaliza qualquer formato de data para 'YYYY-MM-DD' (robusto contra
  // datas que venham como ISO completo, com timezone, etc.)
  _normData(d) {
    if (!d) return '';
    return String(d).slice(0, 10);
  },

  // Retorna os registros raw já filtrados pela faixa de datas
  _histRawFiltrado() {
    let raw = [...this.state.weightsRaw];
    const de = this._normData(this.histFiltro.de);
    const ate = this._normData(this.histFiltro.ate);
    if (de) raw = raw.filter(w => this._normData(w.date) >= de);
    if (ate) raw = raw.filter(w => this._normData(w.date) <= ate);
    return raw;
  },

  toggleHistSelecionado(id, checked) {
    if (checked) this.histSelecionados.add(id);
    else this.histSelecionados.delete(id);
    this._atualizarBarraSelecao();
  },

  toggleHistSelecionarTodos(checked) {
    const raw = this._histRawFiltrado();
    if (checked) raw.forEach(w => this.histSelecionados.add(w.id));
    else this.histSelecionados.clear();
    // Reflete nos checkboxes visíveis
    document.querySelectorAll('.hist-check').forEach(cb => { cb.checked = checked; });
    this._atualizarBarraSelecao();
  },

  _atualizarBarraSelecao() {
    const bar = document.getElementById('histAcoesSelecao');
    const cnt = document.getElementById('histSelCount');
    const n = this.histSelecionados.size;
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent = n;
  },

  // Exclui em lote todos os pesos selecionados
  async excluirPesosSelecionados() {
    const ids = [...this.histSelecionados];
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} registro(s) de peso? Esta ação não pode ser desfeita.`)) return;
    try {
      const { error } = await window.sb.from('weights').delete().in('id', ids);
      if (error) throw error;
      // Atualiza state local sem refetch completo (economia de request)
      const datasAfetadas = new Set(
        this.state.weightsRaw.filter(w => ids.includes(w.id)).map(w => w.date)
      );
      this.state.weightsRaw = this.state.weightsRaw.filter(w => !ids.includes(w.id));
      datasAfetadas.forEach(d => this._recomputeDailyAverage(d));
      this.histSelecionados.clear();
      this._invalidateCoachCache();
      this.updateDashboard();
      this.showAlert('success', `${ids.length} registro(s) excluído(s).`);
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('delete_pesos_lote', e);
    }
  },

  renderHistorico() {
    const el = document.getElementById('pesoTable');
    if (!el) return;
    if (!this.state.weightsRaw.length) {
      el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--textm);padding:24px">Nenhum registro ainda</td></tr>';
      this._atualizarBarraSelecao();
      this.renderHistoricoCompleto();
      return;
    }

    // Usa state.weights (média diária) para calcular variação dia-a-dia e %
    const sortedDaily = this.getSorted();
    const first = sortedDaily[0];
    const dailyByDate = {};
    sortedDaily.forEach((w, i) => { dailyByDate[w.date] = { peso: w.peso, idx: i }; });

    // Aplica filtro de datas
    const raw = this._histRawFiltrado();
    if (!raw.length) {
      el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--textm);padding:24px">Nenhum registro no período selecionado</td></tr>';
      this._atualizarBarraSelecao();
      this.renderHistoricoCompleto();
      return;
    }

    // Remove da seleção ids que sumiram do filtro (evita excluir o que não está à vista)
    this.histSelecionados.forEach(id => { if (!raw.some(w => w.id === id)) this.histSelecionados.delete(id); });

    el.innerHTML = raw.map(w => {
      const imcW = this.calcIMC(w.peso, this.altura);
      const daily = dailyByDate[w.date];
      let varW = '—', varColor = 'var(--textm)';
      if (daily && daily.idx > 0) {
        const prevAvg = sortedDaily[daily.idx - 1].peso;
        const delta = w.peso - prevAvg;
        varW = (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' kg';
        varColor = delta < 0 ? 'var(--em)' : delta > 0 ? 'var(--red)' : 'var(--textm)';
      }
      const pctW = first ? ((first.peso - w.peso) / first.peso * 100).toFixed(1) : '0.0';
      const horaTxt = w.hora ? ` <span style="color:var(--textm);font-size:11px">${w.hora.slice(0, 5)}</span>` : '';
      const origemBadge = w.origem === 'ocr' ? ' 🤖' : w.origem === 'texto' ? ' 📝' : '';
      const multCount = raw.filter(r => r.date === w.date).length;
      const multBadge = multCount > 1 ? ` <span style="color:var(--cyan);font-size:10px;background:rgba(74,157,232,0.1);padding:1px 6px;border-radius:8px">${multCount}×</span>` : '';
      const checked = this.histSelecionados.has(w.id) ? 'checked' : '';

      return `<tr>
        <td style="text-align:center"><input type="checkbox" class="hist-check" ${checked} style="width:18px;height:18px;cursor:pointer;accent-color:var(--gold)" onchange="VITALE_CORE.toggleHistSelecionado(${w.id}, this.checked)"></td>
        <td>${this.fmt(w.date)}${horaTxt}${multBadge}</td>
        <td><strong>${w.peso.toFixed(1)}</strong>${origemBadge}</td>
        <td style="color:var(--textm)">${imcW}</td>
        <td style="color:${varColor}">${varW}</td>
        <td style="color:var(--gold)"><strong>${pctW}%</strong></td>
        <td><button class="btn btn-danger btn-small" onclick="VITALE_CORE.deletePeso(${w.id})">🗑️</button></td>
      </tr>`;
    }).join('');

    // Feedback visual do filtro: mostra quantos de quantos
    const info = document.getElementById('histFiltroInfo');
    if (info) {
      const total = this.state.weightsRaw.length;
      const filtroAtivo = this.histFiltro.de || this.histFiltro.ate;
      if (filtroAtivo) {
        info.style.display = 'block';
        info.innerHTML = `Mostrando <strong style="color:var(--gold)">${raw.length}</strong> de ${total} registros` +
          (this.histFiltro.de ? ` · de ${this.fmt(this.histFiltro.de)}` : '') +
          (this.histFiltro.ate ? ` até ${this.fmt(this.histFiltro.ate)}` : '');
      } else {
        info.style.display = 'none';
      }
    }

    // Sincroniza o "selecionar todos" e a barra de ações
    const selAll = document.getElementById('histSelAll');
    if (selAll) selAll.checked = raw.length > 0 && raw.every(w => this.histSelecionados.has(w.id));
    this._atualizarBarraSelecao();

    // Renderiza também os demais tipos de dados no histórico
    this.renderHistoricoCompleto();
  },

  // Badge da fonte do aparelho de bioimpedância (não comparáveis entre si)
  _fonteBadge(fonte) {
    if (!fonte || fonte === 'manual') return '';
    const map = {
      inbody: { txt: 'InBody', cor: '#27c47d', bg: 'rgba(39,196,125,0.12)' },
      xiaomi: { txt: 'Xiaomi', cor: '#e8924a', bg: 'rgba(232,146,74,0.12)' },
      outro: { txt: 'Outro aparelho', cor: 'var(--textm)', bg: 'rgba(255,255,255,0.05)' }
    };
    const f = map[fonte] || map.outro;
    return `<span style="font-size:9px;padding:2px 7px;border-radius:8px;background:${f.bg};color:${f.cor};letter-spacing:0.5px">⚖️ ${f.txt}</span>`;
  },

  // Badge de origem do dado (manual, bioimpedância, OCR, integração)
  _origemBadge(origem) {
    const map = {
      manual: { txt: 'Manual', cor: 'var(--textm)', bg: 'rgba(255,255,255,0.05)' },
      ocr: { txt: '🤖 OCR', cor: 'var(--cyan)', bg: 'rgba(74,157,232,0.1)' },
      bio: { txt: '📊 Bioimpedância', cor: 'var(--em)', bg: 'rgba(39,196,125,0.1)' },
      texto: { txt: '📝 Texto', cor: 'var(--textm)', bg: 'rgba(255,255,255,0.05)' },
      app: { txt: '📱 App', cor: 'var(--purple)', bg: 'rgba(155,89,232,0.1)' }
    };
    const o = map[origem] || map.manual;
    return `<span style="font-size:9px;padding:2px 7px;border-radius:8px;background:${o.bg};color:${o.cor};letter-spacing:0.5px">${o.txt}</span>`;
  },

  // Renderiza TODOS os tipos de dados no Histórico, editável/removível.
  // Cada item identifica a origem (manual / análise de bio / OCR / app).
  renderHistoricoCompleto() {
    // Composição corporal
    const elC = document.getElementById('histComposicao');
    if (elC) {
      const cs = this.state.composicao || [];
      elC.innerHTML = !cs.length
        ? '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhum registro</p>'
        : cs.map(c => {
          const campos = this._composicaoCampos.filter(f => c[f.id] != null)
            .map(f => `${f.icone} ${c[f.id]}${f.un ? f.un === '%' ? '%' : ' ' + f.un : ''}`).join(' · ');
          return `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px;color:var(--textm)">${this.fmt(c.data)} ${this._origemBadge(c.origem || 'bio')}</h4>
            <p style="margin-top:4px">${campos}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerComposicao(${c.id})">🗑️</button>
          </div>`;
        }).join('');
    }

    // Medidas de fita
    const elM = document.getElementById('histMedidas');
    if (elM) {
      const ms = this.state.medidas || [];
      elM.innerHTML = !ms.length
        ? '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhum registro</p>'
        : ms.map(m => {
          const campos = this._medidasCampos.filter(f => m[f.id] != null)
            .map(f => `${f.icone} ${f.nome} ${m[f.id]}cm`).join(' · ');
          return `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px;color:var(--textm)">${this.fmt(m.data)} ${this._origemBadge(m.origem || 'manual')}</h4>
            <p style="margin-top:4px">${campos || '—'}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerMedida(${m.id})">🗑️</button>
          </div>`;
        }).join('');
    }

    // Exercícios
    const elE = document.getElementById('histExercicios');
    if (elE) {
      const exs = this.state.exercicios || [];
      elE.innerHTML = !exs.length
        ? '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhum registro</p>'
        : exs.map(e => {
          const ex = this._exercicios.find(t => t.id === e.tipo) || { icone: '💪', nome: e.tipo };
          return `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px">${ex.icone} ${ex.nome} ${this._origemBadge(e.origem || 'manual')}</h4>
            <p style="margin-top:4px;color:var(--textm)">${this.fmt(e.data)} · ${e.duracao_min}min · ${e.calorias || 0} kcal</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerExercicio(${e.id})">🗑️</button>
          </div>`;
        }).join('');
    }

    // Diário
    const elD = document.getElementById('histDiario');
    if (elD) {
      const ds = this.state.moodHistoricoCache || [];
      if (!ds.length) {
        // Carrega sob demanda (não estava em memória)
        this.loadMoodHistorico().then(dados => {
          this.state.moodHistoricoCache = dados;
          if (dados.length) this.renderHistoricoCompleto();
        }).catch(() => {});
        elD.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Carregando…</p>';
      } else {
        elD.innerHTML = ds.slice().reverse().map(d => {
          const e = this._moodEmojis;
          const parts = [];
          if (d.humor) parts.push(`${e.humor[d.humor]} Humor`);
          if (d.energia) parts.push(`${e.energia[d.energia]} Energia`);
          if (d.sono) parts.push(`${e.sono[d.sono]} Sono`);
          return `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px;color:var(--textm)">${this.fmt(d.data)}</h4>
            <p style="margin-top:4px">${parts.join(' · ') || '—'}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerMood('${d.data}')">🗑️</button>
          </div>`;
        }).join('');
      }
    }

    // Refeições (últimos 30 dias) — agrupadas por dia
    const elR = document.getElementById('histRefeicoes');
    if (elR) {
      const rs = [...(this.state.refeicoes || [])].reverse();
      if (!rs.length) {
        elR.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhuma refeição nos últimos 30 dias</p>';
      } else {
        let diaAtual = null;
        elR.innerHTML = rs.map(r => {
          const t = (this._tiposRefeicao || []).find(x => x.id === r.tipo) || { icone: '🍽️', nome: r.tipo || '' };
          const cab = r.data !== diaAtual ? `<div style="font-size:11px;color:var(--gold);letter-spacing:1px;margin:14px 0 6px">${this.fmt(r.data)}</div>` : '';
          diaAtual = r.data;
          return `${cab}<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px">${t.icone} ${this._escapeHtml(r.descricao || t.nome)} ${this._origemBadge(r.origem || 'manual')}</h4>
            <p style="margin-top:3px;font-size:12px;color:var(--textm)">${r.calorias ? r.calorias + ' kcal' : '—'}${r.peso_g ? ' · ' + r.peso_g + 'g' : ''}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerRefeicao(${r.id})">🗑️</button>
          </div>`;
        }).join('');
      }
    }

    // Doses GLP-1
    const elDo = document.getElementById('histDoses');
    if (elDo) {
      const ds2 = this.state.doses || [];
      elDo.innerHTML = !ds2.length
        ? '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhuma dose registrada</p>'
        : ds2.map(d => `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px">💉 ${this._escapeHtml(d.medicamento)} — ${this._escapeHtml(d.dose)}</h4>
            <p style="margin-top:3px;font-size:12px;color:var(--textm)">${this.fmt(d.data)}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerDose(${d.id})">🗑️</button>
          </div>`).join('');
    }

    // Efeitos colaterais
    const elEf = document.getElementById('histEfeitos');
    if (elEf) {
      const es = this.state.efeitos || [];
      const nomes = {}; (this._efeitoTipos || []).forEach(t => nomes[t.id] = t.label);
      elEf.innerHTML = !es.length
        ? '<p style="color:var(--textm);font-size:13px;text-align:center;padding:14px 0">Nenhum sintoma registrado</p>'
        : es.map(e => `<div class="med-item">
            <div class="med-info"><h4 style="font-size:13px">${nomes[e.tipo] || e.tipo} · intensidade ${e.intensidade}/5</h4>
            <p style="margin-top:3px;font-size:12px;color:var(--textm)">${this.fmt(e.data)}</p></div>
            <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerEfeito(${e.id})">🗑️</button>
          </div>`).join('');
    }
  },

  // Remove um registro de diário por data
  async removerMood(data) {
    if (!confirm('Remover o diário de ' + this.fmt(data) + '?')) return;
    const user = await window.VitaleAuth.getUser();
    if (!user) return;
    const { error } = await window.sb.from('mood_logs').delete().eq('user_id', user.id).eq('data', data);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.moodHistoricoCache = (this.state.moodHistoricoCache || []).filter(d => d.data !== data);
    if (this.state.moodHoje && this.state.moodHoje.data === data) {
      this.state.moodHoje = null;
      this.renderMoodCard();
    }
    this.renderHistoricoCompleto();
    this.renderMoodHistorico();
    this.showAlert('success', 'Diário removido.');
  },

  // =====================================================
  // RELATÓRIO PDF
  // =====================================================
  gerarRelatorioPDF() {
    if (!this.state.weights.length) return this.showAlert('error', 'Sem dados para relatório!');
    try {
      if (typeof html2pdf === 'undefined') throw new Error('html2pdf não carregado');
      const sorted = this.getSorted();
      const last = sorted[sorted.length - 1];
      const imc = this.calcIMC(last.peso, this.altura);
      const meds = this.state.medicacoes.length ? this.state.medicacoes.map(m => `<li><strong>${m.nome}</strong> — ${m.dose}</li>`).join('') : '<li>Nenhuma</li>';
      const subs = this.state.submetas.length ? this.state.submetas.map(s => `<li>${s.icone} <strong>${s.nome}</strong>: ${s.pesoAlvo.toFixed(1)} kg${s.dataAlvo ? ' até ' + this.fmtStr(s.dataAlvo) : ''}</li>`).join('') : '<li>Nenhuma</li>';
      const nome = this.state.profile?.nome || '';
      const html = `<div style="font-family:serif;padding:40px;max-width:800px;color:#111">
        <h1 style="text-align:center;border-bottom:2px solid #333;padding-bottom:20px;letter-spacing:2px">VITALE — RELATÓRIO DE SAÚDE</h1>
        <p style="text-align:center;color:#666;font-style:italic">${nome ? nome + ' • ' : ''}Confidencial • ${new Date().toLocaleDateString('pt-BR')}</p>
        <h2 style="margin-top:32px;border-bottom:1px solid #ccc;padding-bottom:8px">Resumo</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="background:#f5f5f5"><td style="padding:10px;border:1px solid #ccc"><b>Peso Atual</b></td><td style="padding:10px;border:1px solid #ccc">${last.peso.toFixed(1)} kg</td><td style="padding:10px;border:1px solid #ccc"><b>IMC</b></td><td style="padding:10px;border:1px solid #ccc">${imc}</td></tr>
          <tr><td style="padding:10px;border:1px solid #ccc"><b>Peso Inicial</b></td><td style="padding:10px;border:1px solid #ccc">${sorted[0].peso.toFixed(1)} kg</td><td style="padding:10px;border:1px solid #ccc"><b>Perda Total</b></td><td style="padding:10px;border:1px solid #ccc"><b>${(sorted[0].peso - last.peso).toFixed(1)} kg (${((sorted[0].peso - last.peso) / sorted[0].peso * 100).toFixed(1)}%)</b></td></tr>
        </table>
        <h2 style="margin-top:32px;border-bottom:1px solid #ccc;padding-bottom:8px">Histórico de Peso</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead><tr style="background:#333;color:white"><th style="padding:10px;text-align:left">Data</th><th style="padding:10px;text-align:center">Peso (kg)</th><th style="padding:10px;text-align:center">IMC</th></tr></thead>
          <tbody>${sorted.map(w => `<tr><td style="padding:10px;border:1px solid #ccc">${this.fmt(w.date)}</td><td style="padding:10px;border:1px solid #ccc;text-align:center">${w.peso.toFixed(1)}</td><td style="padding:10px;border:1px solid #ccc;text-align:center">${this.calcIMC(w.peso, this.altura)}</td></tr>`).join('')}</tbody>
        </table>
        <h2 style="margin-top:32px;border-bottom:1px solid #ccc;padding-bottom:8px">Submetas</h2><ul style="margin:16px 0;line-height:2">${subs}</ul>
        <h2 style="margin-top:32px;border-bottom:1px solid #ccc;padding-bottom:8px">Medicações</h2><ul style="margin:16px 0;line-height:2">${meds}</ul>
        <p style="margin-top:40px;border-top:1px solid #ccc;padding-top:16px;font-size:11px;color:#666">VITALE v4 — ${new Date().toLocaleDateString('pt-BR')}</p>
      </div>`;
      html2pdf().set({
        margin: 10,
        filename: `VITALE_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
      }).from(html).save();
      this.showAlert('success', '✅ PDF gerado!');
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('pdf_generated');
    } catch (err) {
      this.showAlert('error', '❌ Erro ao gerar PDF: ' + err.message);
      if (window.VitaleErr) window.VitaleErr.log('pdf_gen', err);
    }
  },

  // =====================================================
  // HEALTH PROFILE — Aba Saúde
  // =====================================================
  fillHealthProfileForm() {
    const hp = this.state.healthProfile;
    if (!hp) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== null && v !== undefined) el.value = v; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    setVal('hPaSistolica', hp.pa_sistolica);
    setVal('hPaDiastolica', hp.pa_diastolica);
    setVal('hGlicemia', hp.glicemia_jejum);
    setVal('hFc', hp.fc_repouso);

    setCheck('hMedGlp1', hp.med_glp1);
    setCheck('hMedAntiHip', hp.med_anti_hipertensivo);
    setCheck('hMedEstatina', hp.med_estatina);
    setCheck('hMedMetformina', hp.med_metformina);
    setCheck('hMedInsulina', hp.med_insulina);
    setCheck('hMedTireoide', hp.med_tireoide);
    setCheck('hMedVitaminas', hp.med_vitaminas);
    setVal('hMedGlp1Nome', hp.med_glp1_nome);
    setVal('hMedOutros', hp.med_outros);

    if (hp.med_glp1) {
      const wrap = document.getElementById('hMedGlp1NomeWrap');
      if (wrap) wrap.style.display = 'block';
    }

    setCheck('hCondDt2', hp.cond_diabetes_t2);
    setCheck('hCondDt1', hp.cond_diabetes_t1);
    setCheck('hCondHip', hp.cond_hipertensao);
    setCheck('hCondHipoT', hp.cond_hipotireoidismo);
    setCheck('hCondHiperT', hp.cond_hipertireoidismo);
    setCheck('hCondDisli', hp.cond_dislipidemia);
    setCheck('hCondApneia', hp.cond_apneia_sono);
    setCheck('hCondSop', hp.cond_sop);
    setCheck('hCondEsteatose', hp.cond_esteatose);
    setVal('hCondOutros', hp.cond_outros);

    setVal('hNivelAtividade', hp.nivel_atividade);
    setVal('hFreqTreino', hp.freq_treino);
    setVal('hSono', hp.horas_sono);
    setVal('hStress', hp.nivel_stress);

    // Bloco A.1: objetivo + urgência na aba Saúde
    setVal('hObjetivo', hp.objetivo);
    setVal('hUrgencia', hp.urgencia);
    setVal('hObjetivoOutro', hp.objetivo_outro);
    const urWrap = document.getElementById('hUrgenciaWrap');
    if (urWrap) urWrap.style.display = hp.objetivo === 'emagrecimento' ? 'block' : 'none';
    const outroWrap = document.getElementById('hObjetivoOutroWrap');
    if (outroWrap) outroWrap.style.display = hp.objetivo === 'outro' ? 'block' : 'none';
  },

  async salvarHealthProfile() {
    try {
      const user = await window.VitaleAuth.getUser();
      if (!user) return;
      const getNum = (id) => { const v = document.getElementById(id)?.value; return v ? parseFloat(v.replace(',', '.')) : null; };
      const getInt = (id) => { const v = document.getElementById(id)?.value; return v ? parseInt(v) : null; };
      const getStr = (id) => { const v = document.getElementById(id)?.value?.trim(); return v || null; };
      const getCheck = (id) => !!document.getElementById(id)?.checked;

      const data = {
        id: user.id,
        pa_sistolica: getInt('hPaSistolica'),
        pa_diastolica: getInt('hPaDiastolica'),
        glicemia_jejum: getNum('hGlicemia'),
        fc_repouso: getInt('hFc'),
        med_glp1: getCheck('hMedGlp1'),
        med_glp1_nome: getStr('hMedGlp1Nome'),
        med_anti_hipertensivo: getCheck('hMedAntiHip'),
        med_estatina: getCheck('hMedEstatina'),
        med_metformina: getCheck('hMedMetformina'),
        med_insulina: getCheck('hMedInsulina'),
        med_tireoide: getCheck('hMedTireoide'),
        med_vitaminas: getCheck('hMedVitaminas'),
        med_outros: getStr('hMedOutros'),
        cond_diabetes_t2: getCheck('hCondDt2'),
        cond_diabetes_t1: getCheck('hCondDt1'),
        cond_hipertensao: getCheck('hCondHip'),
        cond_hipotireoidismo: getCheck('hCondHipoT'),
        cond_hipertireoidismo: getCheck('hCondHiperT'),
        cond_dislipidemia: getCheck('hCondDisli'),
        cond_apneia_sono: getCheck('hCondApneia'),
        cond_sop: getCheck('hCondSop'),
        cond_esteatose: getCheck('hCondEsteatose'),
        cond_outros: getStr('hCondOutros'),
        nivel_atividade: getStr('hNivelAtividade'),
        freq_treino: getInt('hFreqTreino'),
        horas_sono: getNum('hSono'),
        nivel_stress: getInt('hStress'),
        objetivo: getStr('hObjetivo'),
        objetivo_outro: getStr('hObjetivoOutro'),
        urgencia: getStr('hUrgencia'),
        updated_at: new Date().toISOString()
      };

      const { error } = await window.sb.from('health_profile').upsert(data);
      if (error) throw error;

      this.state.healthProfile = data;
      this._invalidateCoachCache();
      this.showAlert('success', '✅ Perfil de saúde salvo!');
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('health_profile_saved');
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('save_health_profile', e);
    }
  },

  // =====================================================
  // ONBOARDING WIZARD — 6 telas (Bloco A.1: + Objetivos)
  // =====================================================
  onbCurrentStep: 1,
  ONB_TOTAL_STEPS: 7,

  showOnboarding(prePreenchido = false) {
    try {
      this.onbCurrentStep = 1;
      // Limpa seleções de objetivo/urgência de aberturas anteriores
      document.querySelectorAll('.objetivo-card.selected, .urgencia-card.selected')
        .forEach(c => c.classList.remove('selected'));
      this.state.objetivoEscolhido = null;
      if (prePreenchido) this._prefillOnboardingFromState();
      this.onbRenderStep();
      const modal = document.getElementById('modalOnboarding');
      if (modal) modal.classList.add('active');
    } catch (e) {
      console.error('[VITALE] showOnboarding error:', e);
      if (window.VitaleErr) window.VitaleErr.log('show_onboarding', e);
      // Mesmo se o prefill falhar, abre o wizard vazio em vez de "não fazer nada"
      this.onbCurrentStep = 1;
      this.onbRenderStep();
      const modal = document.getElementById('modalOnboarding');
      if (modal) modal.classList.add('active');
    }
  },

  // Reabre o onboarding pré-preenchido com dados atuais (botão "Refazer")
  reabrirOnboarding() {
    if (!confirm('Reabrir o questionário inicial com seus dados atuais para revisar/editar?\n\nVocê pode pular etapas que não quiser alterar.')) return;
    this.showOnboarding(true);
  },

  _prefillOnboardingFromState() {
    const p = this.state.profile || {};
    const hp = this.state.healthProfile || {};
    const weights = Array.isArray(this.state.weights) ? this.state.weights : [];
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    // Tela 1
    setVal('onbNome', p.nome);
    setVal('onbAltura', p.altura);
    if (weights.length) setVal('onbPeso', weights[weights.length - 1].peso);
    setVal('onbDataNasc', hp.data_nascimento);
    setVal('onbSexo', hp.sexo);

    // Tela 2
    setVal('onbPaSist', hp.pa_sistolica);
    setVal('onbPaDiast', hp.pa_diastolica);
    setVal('onbGlicemia', hp.glicemia_jejum);
    setVal('onbFc', hp.fc_repouso);

    // Tela 3
    setCheck('onbMedGlp1', hp.med_glp1);
    setCheck('onbMedAntiHip', hp.med_anti_hipertensivo);
    setCheck('onbMedEstatina', hp.med_estatina);
    setCheck('onbMedMetformina', hp.med_metformina);
    setCheck('onbMedInsulina', hp.med_insulina);
    setCheck('onbMedTireoide', hp.med_tireoide);
    setCheck('onbMedVitaminas', hp.med_vitaminas);
    setVal('onbMedGlp1Nome', hp.med_glp1_nome);
    if (hp.med_glp1) { const w = document.getElementById('onbMedGlp1Wrap'); if (w) w.style.display = 'block'; }

    // Tela 4
    setCheck('onbCondDt2', hp.cond_diabetes_t2);
    setCheck('onbCondDt1', hp.cond_diabetes_t1);
    setCheck('onbCondHip', hp.cond_hipertensao);
    setCheck('onbCondHipoT', hp.cond_hipotireoidismo);
    setCheck('onbCondDisli', hp.cond_dislipidemia);
    setCheck('onbCondApneia', hp.cond_apneia_sono);
    setCheck('onbCondSop', hp.cond_sop);
    setCheck('onbCondEsteatose', hp.cond_esteatose);

    // Tela 5
    setVal('onbNivelAtividade', hp.nivel_atividade);
    setVal('onbFreqTreino', hp.freq_treino);
    setVal('onbSono', hp.horas_sono);
    setVal('onbStress', hp.nivel_stress);

    // Tela 6 (objetivo)
    if (hp.objetivo) {
      const card = document.querySelector(`.objetivo-card[data-objetivo="${hp.objetivo}"]`);
      if (card) card.classList.add('selected');
      this.state.objetivoEscolhido = hp.objetivo;
      if (hp.objetivo === 'emagrecimento') {
        const ur = document.getElementById('onbUrgenciaWrap');
        if (ur) ur.style.display = 'block';
        if (hp.urgencia) {
          const u = document.querySelector(`.urgencia-card[data-urgencia="${hp.urgencia}"]`);
          if (u) u.classList.add('selected');
        }
      }
    }
  },

  onbRenderStep() {
    document.querySelectorAll('.onb-tela').forEach(t => t.style.display = 'none');
    const tela = document.querySelector(`.onb-tela[data-tela="${this.onbCurrentStep}"]`);
    if (tela) tela.style.display = 'block';

    document.querySelectorAll('.onb-step').forEach((s, i) => {
      s.classList.remove('current', 'done');
      const idx = i + 1;
      if (idx < this.onbCurrentStep) s.classList.add('done');
      else if (idx === this.onbCurrentStep) s.classList.add('current');
    });

    const btnVoltar = document.getElementById('onbVoltar');
    if (btnVoltar) btnVoltar.style.display = this.onbCurrentStep > 1 ? 'inline-block' : 'none';

    const avancar = document.getElementById('onbAvancar');
    if (avancar) avancar.textContent = this.onbCurrentStep === this.ONB_TOTAL_STEPS ? 'Finalizar 🎉' : 'Continuar →';

    const pular = document.getElementById('onbPular');
    if (pular) pular.style.display = this.onbCurrentStep === 1 ? 'none' : 'inline';
  },

  onbVoltar() {
    if (this.onbCurrentStep > 1) {
      this.onbCurrentStep--;
      this.onbRenderStep();
    }
  },

  onbPular() {
    if (this.onbCurrentStep < this.ONB_TOTAL_STEPS) {
      this.onbCurrentStep++;
      this.onbRenderStep();
    } else {
      this.onbFinalizar();
    }
  },

  // Selecionar objetivo na tela 6
  selectObjetivo(el, objetivo) {
    document.querySelectorAll('.objetivo-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    this.state.objetivoEscolhido = objetivo;

    const urWrap = document.getElementById('onbUrgenciaWrap');
    const outroWrap = document.getElementById('onbObjetivoOutroWrap');
    if (urWrap) urWrap.style.display = objetivo === 'emagrecimento' ? 'block' : 'none';
    if (outroWrap) outroWrap.style.display = objetivo === 'outro' ? 'block' : 'none';
  },

  selectUrgencia(el, urgencia) {
    document.querySelectorAll('.urgencia-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  },

  async onbAvancar() {
    if (this.onbCurrentStep === 1) {
      const nome = document.getElementById('onbNome').value.trim();
      const altura = parseFloat((document.getElementById('onbAltura').value || '').replace(',', '.'));
      const peso = parseFloat((document.getElementById('onbPeso').value || '').replace(',', '.'));
      if (!nome) return this.showAlert('error', 'Como devemos te chamar?');
      if (isNaN(altura) || altura < 1.2 || altura > 2.5) return this.showAlert('error', 'Altura inválida (ex: 1.75)');
      if (isNaN(peso) || peso < 30 || peso > 500) return this.showAlert('error', 'Peso inválido');
    }

    // Tela 7: aceite dos termos é obrigatório
    if (this.onbCurrentStep === 7) {
      const aceitou = document.getElementById('onbAceiteTermos')?.checked;
      if (!aceitou) {
        const aviso = document.getElementById('onbAceiteAviso');
        if (aviso) aviso.style.display = 'block';
        return;
      }
    }

    if (this.onbCurrentStep < this.ONB_TOTAL_STEPS) {
      this.onbCurrentStep++;
      this.onbRenderStep();
    } else {
      await this.onbFinalizar();
    }
  },

  // =====================================================
  // WALKTHROUGH — Tour de primeiro acesso (balões + checklist)
  // =====================================================
  _tourPassos: [
    { titulo: '👋 Bem-vindo ao VITALE!', texto: 'Deixa eu te mostrar rapidinho onde fica cada coisa. Leva 30 segundos.', destaque: null },
    { titulo: '📊 Dashboard', texto: 'Aqui você vê seu peso, projeção, balanço calórico e a mensagem do seu Coach IA — tudo num lugar.', destaque: "dashboard" },
    { titulo: '⚖️ Registrar Peso', texto: 'Toque em "Registrar" para adicionar seu peso. Ou suba um print da balança e a IA lê pra você.', destaque: "upload" },
    { titulo: '🍽️ Alimentação', texto: 'Registre o que comeu — por foto, por texto ("um pão com café") ou manual. A IA estima as calorias.', destaque: "alimentacao" },
    { titulo: '🏃 Exercícios', texto: 'Registre treinos ou suba um print do Apple Saúde/Strava. Conta no seu balanço calórico do dia.', destaque: "exercicios" },
    { titulo: '🎯 Metas', texto: 'Defina sua meta e acompanhe submetas. Elas aparecem como estrelas no seu gráfico de peso.', destaque: "metas" },
    { titulo: '✅ Pronto!', texto: 'Comece registrando seu peso de hoje. Você pode rever este tour quando quiser, nas Configurações.', destaque: null }
  ],
  _tourIdx: 0,

  iniciarTour() {
    this._tourIdx = 0;
    let ov = document.getElementById('tourOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'tourOverlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:99990;display:block;pointer-events:auto';
      document.body.appendChild(ov);
    }
    ov.style.display = 'block';
    this._tourRender();
  },

  _tourRender() {
    const ov = document.getElementById('tourOverlay');
    if (!ov) return;
    const p = this._tourPassos[this._tourIdx];
    const ehUltimo = this._tourIdx === this._tourPassos.length - 1;
    const ehPrimeiro = this._tourIdx === 0;

    // SPOTLIGHT: mede o elemento destacado e recorta o overlay em volta dele.
    // O escuro é o box-shadow do recorte — funciona acima de qualquer stacking context.
    let spotStyle = 'display:none';
    if (p.destaque) {
      const btn = document.querySelector(`.tab-btn[onclick*="'${p.destaque}'"]`);
      if (btn) {
        btn.scrollIntoView({ block: 'nearest', inline: 'center' }); // instantâneo p/ medir certo
        const r = btn.getBoundingClientRect();
        const pad = 6;
        spotStyle = `display:block;position:fixed;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border-radius:10px;box-shadow:0 0 0 100vmax rgba(4,6,8,0.85);outline:3px solid var(--gold);animation:tourSpotPulse 1.4s ease-in-out infinite;pointer-events:none`;
      }
    }
    const fundoCheio = spotStyle === 'display:none' ? 'background:rgba(4,6,8,0.85);' : '';

    // CHECKLIST de primeiros passos (último passo do tour)
    let checklistHtml = '';
    if (ehUltimo) {
      const temPeso = (this.state.weights || []).length > 0;
      const temRef = (this.state.refeicoes || []).length > 0;
      const temExerc = (this.state.exercicios || []).length > 0;
      const item = (ok, txt) => `<div style="display:flex;gap:8px;align-items:center;font-size:13.5px;color:${ok ? 'var(--em)' : 'var(--text)'};margin-bottom:8px">${ok ? '✅' : '⬜'} ${txt}</div>`;
      checklistHtml = `<div style="background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.18);border-radius:10px;padding:14px;margin-bottom:18px;text-align:left">
        <div style="font-size:11px;color:var(--gold);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Primeiros passos</div>
        ${item(temPeso, 'Registrar meu primeiro peso')}
        ${item(temRef, 'Registrar uma refeição')}
        ${item(temExerc, 'Registrar um exercício')}
      </div>`;
    }

    const dots = this._tourPassos.map((_, i) => `<span style="width:7px;height:7px;border-radius:50%;background:${i === this._tourIdx ? 'var(--gold)' : 'rgba(255,255,255,0.2)'}"></span>`).join('');
    ov.innerHTML = `
      <div id="tourSpot" style="${spotStyle}"></div>
      <div style="position:fixed;inset:0;${fundoCheio}display:flex;align-items:flex-end;justify-content:center;padding:24px;pointer-events:none">
        <div style="background:var(--card,#0d1223);border:1px solid var(--gold);border-radius:18px;padding:26px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.55);pointer-events:auto;margin-bottom:8vh">
          <h2 style="color:var(--gold);font-size:23px;margin-bottom:10px">${p.titulo}</h2>
          <p style="color:var(--text,#ede8e0);font-size:14.5px;line-height:1.65;margin-bottom:18px">${p.texto}</p>
          ${checklistHtml}
          <div style="display:flex;gap:6px;justify-content:center;margin-bottom:18px">${dots}</div>
          <div style="display:flex;gap:10px;justify-content:space-between;align-items:center">
            <button onclick="VITALE_CORE._tourPular()" style="background:none;border:none;color:var(--textm,#8c8880);font-size:13px;cursor:pointer">Pular</button>
            <div style="display:flex;gap:8px">
              ${!ehPrimeiro ? '<button class="btn btn-secondary btn-small" onclick="VITALE_CORE._tourAnterior()">← Voltar</button>' : ''}
              <button class="btn btn-primary btn-small" onclick="VITALE_CORE._tourProximo()">${ehUltimo ? '✅ Começar' : 'Próximo →'}</button>
            </div>
          </div>
        </div>
      </div>`;
  },

  _tourProximo() {
    if (this._tourIdx < this._tourPassos.length - 1) {
      this._tourIdx++;
      this._tourRender();
    } else {
      this._tourFinalizar();
    }
  },
  _tourAnterior() { if (this._tourIdx > 0) { this._tourIdx--; this._tourRender(); } },
  _tourPular() { this._tourFinalizar(); },

  async _tourFinalizar() {
    const ov = document.getElementById('tourOverlay');
    if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
    // persiste que viu o tour
    try {
      const user = await window.VitaleAuth.getUser();
      if (user) {
        await window.sb.from('health_profile').upsert({ id: user.id, tour_visto: true });
        if (this.state.healthProfile) this.state.healthProfile.tour_visto = true;
      }
    } catch (e) { console.warn('tour persist', e); }
  },

  // chamado pelo botão "Rever tour" nas configurações
  refazerTour() {
    this.closeModal('modalSettings');
    setTimeout(() => this.iniciarTour(), 300);
  },

  // =====================================================
  // DICA DIÁRIA — mensagem curta da IA (reusa Coach, cache diário)
  // =====================================================
  renderDicaDiaria() {
    const el = document.getElementById('dicaDiaria');
    if (!el) return;
    const hoje = this._hojeSP();
    // cache: 1 dica por dia, guardada em localStorage
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('vitale_dica') || 'null'); } catch (e) {}
    if (cache && cache.data === hoje && cache.texto) {
      el.innerHTML = `<div style="font-size:13px;color:var(--text);line-height:1.6">💡 <strong style="color:var(--gold)">Dica do dia:</strong> ${this._escapeHtml(cache.texto)}</div>`;
      el.style.display = '';
      return;
    }
    // gera uma dica curta determinística (sem custo de IA) baseada no estado
    const dica = this._gerarDicaLocal();
    if (dica) {
      try { localStorage.setItem('vitale_dica', JSON.stringify({ data: hoje, texto: dica })); } catch (e) {}
      el.innerHTML = `<div style="font-size:13px;color:var(--text);line-height:1.6">💡 <strong style="color:var(--gold)">Dica do dia:</strong> ${this._escapeHtml(dica)}</div>`;
      el.style.display = '';
    }
  },

  _gerarDicaLocal() {
    const dicas = [
      'Pese-se sempre no mesmo horário, de preferência em jejum, para comparações mais justas.',
      'No tratamento GLP-1, manter a massa muscular é tão importante quanto perder peso. Não esqueça da proteína.',
      'Beber água ao longo do dia ajuda na saciedade e no funcionamento do metabolismo.',
      'Registrar a alimentação, mesmo nos dias ruins, é o que mais ajuda a entender seu padrão.',
      'Treino de força preserva músculo durante o emagrecimento. Caminhar também conta muito.',
      'O peso oscila dia a dia (água, sal, intestino). Olhe a tendência da semana, não o número de hoje.',
      'Sono ruim aumenta a fome no dia seguinte. Cuidar do sono é cuidar do peso.',
      'Constância vence intensidade. Pequenos registros diários valem mais que esforços isolados.'
    ];
    // escolhe pela data pra ser estável no dia
    const hoje = this._hojeSP();
    const seed = hoje.split('-').reduce((s, n) => s + parseInt(n), 0);
    return dicas[seed % dicas.length];
  },

  // =====================================================
  // DIFERENCIAL GLP-1 — Doses e Efeitos Colaterais
  // =====================================================
  _efeitoTipos: [
    { id: 'nausea', label: '🤢 Náusea' }, { id: 'constipacao', label: '🚽 Constipação' },
    { id: 'saciedade', label: '🍽️ Saciedade' }, { id: 'fadiga', label: '😴 Fadiga' },
    { id: 'refluxo', label: '🔥 Refluxo' }, { id: 'outro', label: '➕ Outro' }
  ],
  _efeitoSel: { tipo: null, intensidade: 3 },

  renderGlp1Forms() {
    const grid = document.getElementById('efeitoTipoGrid');
    if (grid) grid.innerHTML = this._efeitoTipos.map(t =>
      `<span class="checkbox-chip${this._efeitoSel.tipo === t.id ? ' selected' : ''}" onclick="VITALE_CORE.selEfeitoTipo('${t.id}')">${t.label}</span>`).join('');
    const intens = document.getElementById('efeitoIntensidade');
    if (intens) intens.innerHTML = [1, 2, 3, 4, 5].map(n =>
      `<span class="checkbox-chip${this._efeitoSel.intensidade === n ? ' selected' : ''}" onclick="VITALE_CORE.selEfeitoIntens(${n})" style="min-width:40px;text-align:center">${n}</span>`).join('');
    const dd = document.getElementById('doseData'); if (dd && !dd.value) dd.value = this._hojeSP();
  },
  selEfeitoTipo(t) { this._efeitoSel.tipo = t; this.renderGlp1Forms(); },
  selEfeitoIntens(n) { this._efeitoSel.intensidade = n; this.renderGlp1Forms(); },

  async salvarDose() {
    const med = document.getElementById('doseMed')?.value.trim();
    const dose = document.getElementById('doseValor')?.value.trim();
    const data = document.getElementById('doseData')?.value || this._hojeSP();
    if (!med || !dose) return this.showAlert('error', 'Informe o medicamento e a dose.');
    try {
      const user = await window.VitaleAuth.getUser();
      const reg = { user_id: user.id, medicamento: med, dose, data };
      const { data: saved, error } = await window.sb.from('doses_medicacao').insert(reg).select().single();
      if (error) throw error;
      if (!this.state.doses) this.state.doses = [];
      this.state.doses.unshift(saved);
      document.getElementById('doseMed').value = '';
      document.getElementById('doseValor').value = '';
      this.renderDosesList();
      this.buildWeightChart();
      this._invalidateCoachCache();
      this.showAlert('success', '✅ Dose registrada!');
    } catch (e) { this.showAlert('error', 'Erro: ' + (e.message || e)); }
  },

  renderDosesList() {
    const el = document.getElementById('dosesList');
    if (!el) return;
    const ds = this.state.doses || [];
    if (!ds.length) { el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center">Nenhuma dose registrada ainda.</p>'; return; }
    el.innerHTML = ds.map(d =>
      `<div class="med-item"><div class="med-info"><h4 style="font-size:14px">${this._escapeHtml(d.medicamento)} — ${this._escapeHtml(d.dose)}</h4><div style="font-size:12px;color:var(--textm)">${this.fmt(d.data)}</div></div><button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerDose(${d.id})">🗑️</button></div>`).join('');
  },

  async removerDose(id) {
    if (!confirm('Remover esta dose?')) return;
    try {
      await window.sb.from('doses_medicacao').delete().eq('id', id);
      this.state.doses = (this.state.doses || []).filter(d => d.id !== id);
      this.renderDosesList();
      this.buildWeightChart();
    } catch (e) { this.showAlert('error', 'Erro: ' + (e.message || e)); }
  },

  async salvarEfeito() {
    if (!this._efeitoSel.tipo) return this.showAlert('error', 'Selecione um sintoma.');
    try {
      const user = await window.VitaleAuth.getUser();
      const reg = { user_id: user.id, tipo: this._efeitoSel.tipo, intensidade: this._efeitoSel.intensidade, data: this._hojeSP() };
      const { data: saved, error } = await window.sb.from('efeitos_colaterais').insert(reg).select().single();
      if (error) throw error;
      if (!this.state.efeitos) this.state.efeitos = [];
      this.state.efeitos.unshift(saved);
      this._efeitoSel = { tipo: null, intensidade: 3 };
      this.renderGlp1Forms();
      this.renderEfeitosList();
      this._invalidateCoachCache();
      this.showAlert('success', '✅ Sintoma registrado!');
    } catch (e) { this.showAlert('error', 'Erro: ' + (e.message || e)); }
  },

  renderEfeitosList() {
    const el = document.getElementById('efeitosList');
    if (!el) return;
    const es = this.state.efeitos || [];
    if (!es.length) { el.innerHTML = '<p style="color:var(--textm);font-size:13px;text-align:center">Nenhum sintoma registrado.</p>'; return; }
    const nomes = {}; this._efeitoTipos.forEach(t => nomes[t.id] = t.label);
    el.innerHTML = es.slice(0, 20).map(e =>
      `<div class="med-item"><div class="med-info"><h4 style="font-size:14px">${nomes[e.tipo] || e.tipo} <span style="color:var(--gold)">·</span> intensidade ${e.intensidade}/5</h4><div style="font-size:12px;color:var(--textm)">${this.fmt(e.data)}</div></div><button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerEfeito(${e.id})">🗑️</button></div>`).join('');
  },

  async removerEfeito(id) {
    if (!confirm('Remover este registro?')) return;
    try {
      await window.sb.from('efeitos_colaterais').delete().eq('id', id);
      this.state.efeitos = (this.state.efeitos || []).filter(e => e.id !== id);
      this.renderEfeitosList();
    } catch (e) { this.showAlert('error', 'Erro: ' + (e.message || e)); }
  },

  verTermos(e) {
    if (e) e.preventDefault();
    window.open('/termos.html', '_blank');
  },

  async onbFinalizar() {
    try {
      const user = await window.VitaleAuth.getUser();
      const getNum = (id) => { const v = document.getElementById(id)?.value; return v ? parseFloat(v.replace(',', '.')) : null; };
      const getInt = (id) => { const v = document.getElementById(id)?.value; return v ? parseInt(v) : null; };
      const getStr = (id) => { const v = document.getElementById(id)?.value?.trim(); return v || null; };
      const getCheck = (id) => !!document.getElementById(id)?.checked;

      // 1) profile
      const nome = document.getElementById('onbNome').value.trim();
      const altura = parseFloat((document.getElementById('onbAltura').value || '').replace(',', '.'));
      const peso = parseFloat((document.getElementById('onbPeso').value || '').replace(',', '.'));
      await window.sb.from('profiles').update({ nome, altura, updated_at: new Date().toISOString() }).eq('id', user.id);

      // 6) Objetivo (tela nova)
      const objetivo = this.state.objetivoEscolhido || null;
      const urgenciaEl = document.querySelector('.urgencia-card.selected');
      const urgencia = (objetivo === 'emagrecimento' && urgenciaEl) ? urgenciaEl.dataset.urgencia : null;
      const objetivoOutro = (objetivo === 'outro') ? getStr('onbObjetivoOutro') : null;

      // 2) health_profile
      const aceiteMkt = getCheck('onbConsentMarketing');
      const agora = new Date().toISOString();
      const hpData = {
        id: user.id,
        data_nascimento: document.getElementById('onbDataNasc')?.value || null,
        sexo: getStr('onbSexo'),
        telefone: getStr('onbTelefone'),
        estado: getStr('onbEstado'),
        como_conheceu: getStr('onbComoConheceu'),
        aceite_termos: getCheck('onbAceiteTermos'),
        aceite_termos_em: agora,
        aceite_termos_versao: '1.0',
        consent_essencial: getCheck('onbConsentEssencial'),
        consent_marketing: aceiteMkt,
        consent_marketing_em: aceiteMkt ? agora : null,
        pa_sistolica: getInt('onbPaSist'),
        pa_diastolica: getInt('onbPaDiast'),
        glicemia_jejum: getNum('onbGlicemia'),
        fc_repouso: getInt('onbFc'),
        med_glp1: getCheck('onbMedGlp1'),
        med_glp1_nome: getStr('onbMedGlp1Nome'),
        med_anti_hipertensivo: getCheck('onbMedAntiHip'),
        med_estatina: getCheck('onbMedEstatina'),
        med_metformina: getCheck('onbMedMetformina'),
        med_insulina: getCheck('onbMedInsulina'),
        med_tireoide: getCheck('onbMedTireoide'),
        med_vitaminas: getCheck('onbMedVitaminas'),
        cond_diabetes_t2: getCheck('onbCondDt2'),
        cond_diabetes_t1: getCheck('onbCondDt1'),
        cond_hipertensao: getCheck('onbCondHip'),
        cond_hipotireoidismo: getCheck('onbCondHipoT'),
        cond_dislipidemia: getCheck('onbCondDisli'),
        cond_apneia_sono: getCheck('onbCondApneia'),
        cond_sop: getCheck('onbCondSop'),
        cond_esteatose: getCheck('onbCondEsteatose'),
        nivel_atividade: getStr('onbNivelAtividade'),
        freq_treino: getInt('onbFreqTreino'),
        horas_sono: getNum('onbSono'),
        nivel_stress: getInt('onbStress'),
        objetivo,
        objetivo_outro: objetivoOutro,
        urgencia,
        updated_at: new Date().toISOString()
      };
      await window.sb.from('health_profile').upsert(hpData);

      // 3) Primeiro peso (INSERT, não upsert — múltiplos/dia OK)
      const today = new Date().toISOString().slice(0, 10);
      // Só insere peso se não houver registro recente do dia
      const jaTemHoje = this.state.weightsRaw.some(w => w.date === today);
      if (!jaTemHoje) {
        await window.sb.from('weights').insert({ user_id: user.id, data: today, peso, origem: 'manual' });
      }

      // 4) Se objetivo = emagrecimento E IMC >= 30, oferecer gerar metas auto
      const imcAtual = peso / (altura * altura);
      let geraMetasNoFinal = false;
      if (objetivo === 'emagrecimento' && imcAtual >= 25) {
        geraMetasNoFinal = confirm(
          `Seu IMC atual é ${imcAtual.toFixed(1)} (${this.getObesidadeInfo(imcAtual).grau}).\n\n` +
          `Quer que eu crie automaticamente submetas em cascata pra te guiar até o peso ideal?\n\n` +
          `Cada marco vira uma submeta com data estimada (baseada em ${urgencia || 'ritmo moderado'}).`
        );
      }

      // 5) Reload completo do state
      this.state.profile = { ...this.state.profile, nome, altura };
      this.state.healthProfile = hpData;
      this.state.weights = await this.loadWeights();
      this.state.weightsRaw = await this.loadWeightsRaw();

      this.closeModal('modalOnboarding');
      this.renderHeader();
      this._invalidateCoachCache();
      // Após o onboarding, mostra o tour de boas-vindas (se ainda não viu)
      if (!this.state.healthProfile?.tour_visto) setTimeout(() => this.iniciarTour(), 800);

      if (geraMetasNoFinal) {
        await this.gerarMetasAutomaticas(/* silencioso */ true);
      }

      this.updateDashboard();
      this.fillHealthProfileForm();
      this.showAlert('success', `Bem-vindo(a), ${nome}! 🎉`);
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('onboarding_complete', { objetivo });
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('onboarding_final', e);
    }
  },

  // =====================================================
  // BLOCO A.1: GERAR METAS AUTOMÁTICAS EM CASCATA
  // =====================================================
  // Cria submetas de IMC: Obesidade III → II → I → Sobrepeso → Normal
  // Pula marcos já atingidos. Calcula data estimada conforme urgência.
  async gerarMetasAutomaticas(silencioso = false) {
    if (!this.state.weights.length) {
      if (!silencioso) this.showAlert('warning', 'Adicione pelo menos um peso primeiro.');
      return;
    }
    const altura = this.altura;
    const pesoAtual = this.state.weights[this.state.weights.length - 1].peso;
    const imcAtual = pesoAtual / (altura * altura);
    const hp = this.state.healthProfile || {};
    const urgencia = hp.urgencia || 'moderada';

    // kg/semana esperada conforme urgência (estimativa conservadora)
    const ritmoKgSem = urgencia === 'sem_pressa' ? 0.4 :
                      urgencia === 'acelerada' ? 0.85 : 0.6;

    // Marcos em cascata (do mais distante ao mais próximo)
    const todosMarcos = [
      { imc: 40, label: 'Sair de Obesidade Grau III', icone: '🎯' },
      { imc: 35, label: 'Sair de Obesidade Grau II', icone: '🎯' },
      { imc: 30, label: 'Sair de Obesidade Grau I', icone: '🎯' },
      { imc: 25, label: 'Atingir Peso Normal (IMC < 25)', icone: '🩺' },
      { imc: 22, label: 'Peso Normal Ideal (IMC 22)', icone: '⭐' }
    ];

    // Filtra apenas marcos AINDA NÃO atingidos
    const marcosFalta = todosMarcos.filter(m => imcAtual > m.imc);
    if (!marcosFalta.length) {
      if (!silencioso) this.showAlert('info', 'Você já está abaixo de todos os marcos! 🎉');
      return;
    }

    // Para cada marco, calcula peso alvo e data estimada
    const userId = (await window.VitaleAuth.getUser()).id;
    const hoje = new Date();
    const novasSubmetas = [];

    // Set de submetas existentes (evitar duplicar)
    const nomesExistentes = new Set(this.state.submetas.map(s => s.nome));

    let pesoPartida = pesoAtual;
    for (const m of marcosFalta) {
      if (nomesExistentes.has(m.label)) continue;
      const pesoAlvo = parseFloat((m.imc * altura * altura).toFixed(1));
      const kgFaltam = pesoPartida - pesoAlvo;
      const semanasEstimadas = Math.ceil(kgFaltam / ritmoKgSem);
      const diasEstimados = semanasEstimadas * 7;
      const dataAlvo = new Date(hoje);
      dataAlvo.setDate(dataAlvo.getDate() + diasEstimados);
      const dataStr = dataAlvo.toISOString().slice(0, 10);

      novasSubmetas.push({
        user_id: userId,
        nome: m.label,
        peso_alvo: pesoAlvo,
        data_alvo: dataStr,
        icone: m.icone
      });
      pesoPartida = pesoAlvo;
    }

    if (!novasSubmetas.length) {
      if (!silencioso) this.showAlert('info', 'Todas as metas em cascata já existem nas suas submetas.');
      return;
    }

    try {
      const { data, error } = await window.sb.from('submetas').insert(novasSubmetas).select();
      if (error) throw error;
      // Atualiza state
      const novas = (data || []).map(s => ({
        id: s.id, nome: s.nome, pesoAlvo: parseFloat(s.peso_alvo),
        dataAlvo: s.data_alvo, icone: s.icone, atingida: s.atingida
      }));
      this.state.submetas = [...novas, ...this.state.submetas];
      this.updateSubmetasUI();
      if (!silencioso) {
        this.showAlert('success', `✅ ${novas.length} submeta(s) criada(s) em cascata!`);
      }
      if (window.VitaleAnalytics) window.VitaleAnalytics.track('metas_auto', { count: novas.length, urgencia });
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      if (window.VitaleErr) window.VitaleErr.log('metas_auto', e);
    }
  },

  // =====================================================
  // SETTINGS
  // =====================================================
  async openSettings() {
    document.getElementById('alturaInput').value = this.state.profile?.altura || '';
    document.getElementById('nomeInput').value = this.state.profile?.nome || '';
    const hp = this.state.healthProfile || {};
    const tel = document.getElementById('telefoneInput'); if (tel) tel.value = hp.telefone || '';
    const est = document.getElementById('estadoInput'); if (est) est.value = hp.estado || '';
    const mkt = document.getElementById('consentMarketingInput'); if (mkt) mkt.checked = !!hp.consent_marketing;
    document.getElementById('modalSettings').classList.add('active');
  },

  async salvarPerfil() {
    if (!this.state.profile?.id) return this.showAlert('error', 'Perfil ainda carregando — tente em instantes.');
    const h = parseFloat(document.getElementById('alturaInput').value.replace(',', '.'));
    const n = document.getElementById('nomeInput').value.trim();
    const update = {};
    if (!isNaN(h) && h > 1 && h < 2.5) update.altura = h;
    if (n) update.nome = n;
    if (Object.keys(update).length) {
      update.updated_at = new Date().toISOString();
      const { error } = await window.sb.from('profiles').update(update).eq('id', this.state.profile.id);
      if (error) return this.showAlert('error', 'Erro: ' + error.message);
      this.state.profile = { ...this.state.profile, ...update };
    }
    // Dados de contato/consentimento → health_profile
    const tel = document.getElementById('telefoneInput')?.value.trim() || null;
    const est = document.getElementById('estadoInput')?.value || null;
    const mkt = !!document.getElementById('consentMarketingInput')?.checked;
    const hpUpd = { id: this.state.profile.id, telefone: tel, estado: est, consent_marketing: mkt };
    if (mkt && !this.state.healthProfile?.consent_marketing) hpUpd.consent_marketing_em = new Date().toISOString();
    const { error: e2 } = await window.sb.from('health_profile').upsert(hpUpd);
    if (e2) return this.showAlert('error', 'Erro ao salvar contato: ' + e2.message);
    this.state.healthProfile = { ...this.state.healthProfile, ...hpUpd };
    this.updateDashboard();
    this.renderHeader();
    this.showAlert('success', '✅ Perfil salvo!');
  },

  // =====================================================
  // BACKUP JSON
  // =====================================================
  exportarJSON() {
    const data = {
      vitale_version: '4.1',
      exportedAt: new Date().toISOString(),
      profile: this.state.profile,
      healthProfile: this.state.healthProfile,
      weights: this.state.weights,
      medicacoes: this.state.medicacoes,
      submetas: this.state.submetas
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vitale_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showAlert('success', '✅ Backup exportado!');
  },

  // =====================================================
  // HELPERS UI
  // =====================================================
  switchTab(e, tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    e.currentTarget.classList.add('active');
    // Ao abrir o Histórico, garante que todos os painéis estão atualizados
    if (tabName === 'historico') {
      try { this.renderHistoricoCompleto(); } catch (err) { console.warn('hist', err); }
    }
    // Ao abrir Medicações, renderiza os forms e listas GLP-1
    if (tabName === 'medic') {
      try { this.renderGlp1Forms(); this.renderDosesList(); this.renderEfeitosList(); } catch (err) { console.warn('glp1', err); }
    }
  },

  closeModal(id) { document.getElementById(id).classList.remove('active'); },

  showAlert(type, msg) {
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    const c = document.querySelector('.container');
    if (c) {
      c.insertBefore(el, c.children[1] || c.firstChild);
      setTimeout(() => el.remove(), 4500);
    }
  },

  async signOut() {
    if (!confirm('Sair da sua conta?')) return;
    try {
      if (window.VitaleAuth && window.VitaleAuth.signOut) {
        await window.VitaleAuth.signOut();
      } else if (window.sb && window.sb.auth) {
        await window.sb.auth.signOut();
      }
    } catch (e) {
      console.error('[VITALE] signOut error:', e);
    } finally {
      // Garante saída mesmo se a chamada de auth falhar
      window.location.href = '/';
    }
  },

  // Handler para mudança do select de objetivo na aba Saúde
  onSaudeObjetivoChange() {
    const val = document.getElementById('hObjetivo')?.value;
    const urWrap = document.getElementById('hUrgenciaWrap');
    const outroWrap = document.getElementById('hObjetivoOutroWrap');
    if (urWrap) urWrap.style.display = val === 'emagrecimento' ? 'block' : 'none';
    if (outroWrap) outroWrap.style.display = val === 'outro' ? 'block' : 'none';
  }
};

window.VITALE_CORE = VITALE_CORE;
