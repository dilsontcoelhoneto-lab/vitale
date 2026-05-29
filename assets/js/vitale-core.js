// =====================================================
// VITALE — Core (lógica principal) — v4.2 BLOCO A.4
// Inclui: Bloco A (health_profile + onboarding 5 telas)
//       + Bloco A.1: tela 6 Objetivos, urgência, metas auto
//       + Bloco A.2: filtro de data (dashboard + histórico),
//                    seleção múltipla + exclusão em lote,
//                    fix onboarding (reabrir), selo de versão
//       + Fix: múltiplos pesos/dia (média diária via view)
//       + Fix: cache 5min Coach IA
//       + Fix: compressão de imagem antes do OCR
// =====================================================
 
const VITALE_VERSION = 'v4.2 · Bloco A.4 · 2026-05-29';
 
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
    coachCache: null,     // {message, when} — cache de 5min do Coach IA
    objetivoEscolhido: null  // estado temporário do wizard
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
        this.loadHealthProfile()
      ]);
 
      const nomes = ['profile', 'weights', 'weightsRaw', 'medicacoes', 'submetas', 'healthProfile'];
      const fallbacks = [null, [], [], [], [], null];
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
 
      // Feature flags — também isolado
      try { await window.VitaleFlags.applyToUI(); } catch (e) { console.warn('[VITALE] flags falharam:', e); }
 
      // Render UI (cada um protegido para não cascatear)
      try { this.renderHeader(); } catch (e) { console.warn('renderHeader', e); }
      try { this.updateDashboard(); } catch (e) { console.warn('updateDashboard', e); }
      try { this.updateAgendamentos(); } catch (e) { console.warn('updateAgendamentos', e); }
      try { this.fillHealthProfileForm(); } catch (e) { console.warn('fillHealthProfileForm', e); }
 
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
      this.generateCoachMessage();
      this.updateProjecoes();
    }
 
    this.renderHistorico();
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
    const ctx = {
      altura: this.altura,
      meta_kg: this.metaKg.toFixed(1),
      nome: this.state.profile?.nome || null,
      historico: sorted.slice(-12),
      submetas: this.state.submetas.slice(0, 5),
      objetivo: hp.objetivo || null,
      urgencia: hp.urgencia || null,
      health_profile: hp
    };
 
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
  },
 
  limparFiltroDashboard() {
    this.dashFiltro = { de: null, ate: null };
    const de = document.getElementById('dashFiltroDe');
    const ate = document.getElementById('dashFiltroAte');
    if (de) de.value = '';
    if (ate) ate.value = '';
    this.buildWeightChart();
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
    const ctx = canvas.getContext('2d');
    if (this.state.chartInstance) this.state.chartInstance.destroy();
 
    this.state.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Real', data: realData, borderColor: '#27c47d', backgroundColor: 'rgba(39,196,125,0.08)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#27c47d', pointBorderColor: '#0d1223', pointBorderWidth: 2, tension: 0.4, fill: true, spanGaps: false },
          { label: 'Projeção', data: projData, borderColor: '#d4a843', backgroundColor: 'rgba(212,168,67,0.04)', borderWidth: 2, borderDash: [6, 4], pointRadius: 4, pointBackgroundColor: '#d4a843', pointBorderColor: '#0d1223', pointBorderWidth: 2, tension: 0.3, fill: false, spanGaps: true },
          { label: 'Meta', data: metaLine, borderColor: 'rgba(232,80,74,0.5)', borderWidth: 1.5, borderDash: [3, 5], pointRadius: 0, fill: false }
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
            callbacks: { label: (c) => c.raw === null ? null : ` ${c.raw.toFixed(1)}${c.datasetIndex === 2 ? ' (Meta)' : ' kg'}` }
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
  // PROJEÇÕES
  // =====================================================
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
 
  // Comprime imagem antes de mandar pro OCR.
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
        body: JSON.stringify({ image: base64, mime: mimeType })
      });
 
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`OCR ${res.status}: ${errData.error || res.statusText}`);
      }
 
      const data = await res.json();
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
  ONB_TOTAL_STEPS: 6,
 
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
 
    if (this.onbCurrentStep < this.ONB_TOTAL_STEPS) {
      this.onbCurrentStep++;
      this.onbRenderStep();
    } else {
      await this.onbFinalizar();
    }
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
      const hpData = {
        id: user.id,
        data_nascimento: document.getElementById('onbDataNasc')?.value || null,
        sexo: getStr('onbSexo'),
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
    document.getElementById('modalSettings').classList.add('active');
  },
 
  async salvarPerfil() {
    const h = parseFloat(document.getElementById('alturaInput').value.replace(',', '.'));
    const n = document.getElementById('nomeInput').value.trim();
    const update = {};
    if (!isNaN(h) && h > 1 && h < 2.5) update.altura = h;
    if (n) update.nome = n;
    if (!Object.keys(update).length) return this.showAlert('warning', 'Nenhuma alteração');
    update.updated_at = new Date().toISOString();
    const { error } = await window.sb.from('profiles').update(update).eq('id', this.state.profile.id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.profile = { ...this.state.profile, ...update };
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
