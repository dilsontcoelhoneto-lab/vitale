// =====================================================
// VITALE — Core (lógica principal)
// Baseado no v3.3 mas com persistência via Supabase
// =====================================================

const VITALE_CORE = {
  state: {
    profile: null,
    weights: [],
    medicacoes: [],
    submetas: [],
    horarios: [],
    diaSemana: null,
    diasEsp: [],
    tempImportacao: null,
    chartInstance: null
  },

  // =====================================================
  // INIT
  // =====================================================
  async init() {
    try {
      const user = await window.VitaleAuth.requireAuth();
      if (!user) return;

      // Carrega profile + dados em paralelo
      const [profile, weights, meds, submetas] = await Promise.all([
        window.VitaleAuth.getProfile(),
        this.loadWeights(),
        this.loadMedicacoes(),
        this.loadSubmetas()
      ]);

      this.state.profile = profile;
      this.state.weights = weights;
      this.state.medicacoes = meds;
      this.state.submetas = submetas;

      // Aplica feature flags
      await window.VitaleFlags.applyToUI();

      // Render UI
      this.renderHeader();
      this.updateDashboard();
      this.updateAgendamentos();

      window.VitaleAnalytics.track('app_open');

      // Esconde loader
      const loader = document.getElementById('initLoader');
      if (loader) {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 500);
      }

      // Se for primeiro acesso, abre onboarding
      if (!profile?.altura || profile.altura === 1.70) {
        this.checkOnboarding();
      }
    } catch (e) {
      console.error('[VITALE] init error:', e);
      window.VitaleErr.log('app_init', e);
      this.showAlert('error', 'Erro ao carregar. Recarregue a página.');
    }
  },

  // =====================================================
  // DATABASE LOADERS
  // =====================================================
  async loadWeights() {
    const { data, error } = await window.sb
      .from('weights')
      .select('id, data, peso, origem')
      .order('data', { ascending: true });
    if (error) throw error;
    return (data || []).map(w => ({ id: w.id, date: w.data, peso: parseFloat(w.peso), origem: w.origem }));
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

  // =====================================================
  // UTILS (do v3.3, idêntico)
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
  // COACH IA (v3.3 com fallback se IA desabilitada)
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

  // Coach IA via API (Fase 3)
  async generateCoachMessageAI() {
    const enabled = await window.VitaleFlags.isEnabled('coach_ia');
    if (!enabled) return this.generateCoachMessage();

    const sorted = this.getSorted();
    if (sorted.length < 2) return this.generateCoachMessage();

    const el = document.getElementById('coachMessage');
    if (!el) return;

    const ctx = {
      altura: this.altura,
      meta_kg: this.metaKg.toFixed(1),
      nome: this.state.profile?.nome || null,
      historico: sorted.slice(-12),
      submetas: this.state.submetas.slice(0, 5)
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'coach',
          contexto: ctx
        })
      });
      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();
      if (data.message) el.innerHTML = data.message;
      else this.generateCoachMessage(); // fallback determinístico
    } catch (e) {
      window.VitaleErr.log('coach_ia', e);
      this.generateCoachMessage(); // fallback
    }
  },

  // =====================================================
  // CHART
  // =====================================================
  buildWeightChart() {
    const canvas = document.getElementById('weightChart');
    if (!canvas) return;
    const sorted = this.getSorted();
    if (sorted.length < 2) return;

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

    if (velDiaria > 0) {
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
  async addWeight(date, peso, origem = 'manual') {
    const altura = this.altura;
    if (!date || isNaN(peso) || peso <= 0) throw new Error('Dados inválidos');
    if (peso > 500) throw new Error('Peso parece inválido');

    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
    if (new Date(date + 'T23:59:59') > hoje) throw new Error('Data não pode ser futura');

    const { data, error } = await window.sb
      .from('weights')
      .upsert({ user_id: (await window.VitaleAuth.getUser()).id, data: date, peso, origem }, { onConflict: 'user_id,data' })
      .select()
      .single();
    if (error) throw error;

    // Atualiza state local
    const existing = this.state.weights.findIndex(w => w.date === date);
    if (existing >= 0) this.state.weights[existing] = { id: data.id, date, peso, origem };
    else this.state.weights.push({ id: data.id, date, peso, origem });
    this.state.weights.sort((a, b) => new Date(a.date) - new Date(b.date));

    window.VitaleAnalytics.track('weight_add', { origem });
    this.updateDashboard();
    return data;
  },

  async deletePeso(id) {
    if (!confirm('Remover este registro?')) return;
    const { error } = await window.sb.from('weights').delete().eq('id', id);
    if (error) return this.showAlert('error', 'Erro: ' + error.message);
    this.state.weights = this.state.weights.filter(w => w.id !== id);
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

    const existing = this.state.weights.find(w => w.date === date);
    if (existing) {
      if (!confirm(`Já existe registro em ${this.fmtStr(date)}: ${existing.peso.toFixed(1)} kg.\n\nSubstituir por ${peso.toFixed(1)} kg?`)) return;
    }

    try {
      await this.addWeight(date, peso, 'manual');
      document.getElementById('manualDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('manualPeso').value = '';
      this.showAlert('success', `✅ ${peso.toFixed(1)} kg adicionado para ${this.fmt(date)}!`);
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      window.VitaleErr.log('add_weight_manual', e);
    }
  },

  async importarTexto() {
    const text = document.getElementById('textInput').value;
    if (!text.trim()) return this.showAlert('error', 'Cole os dados primeiro!');

    const novos = [], duplicados = [];
    text.split('\n').forEach(line => {
      const m = line.match(/(\d{4}-\d{2}-\d{2})[:\s]+(\d+[.,]?\d*)\s*kg?/i);
      if (m) {
        const date = m[1], peso = parseFloat(m[2].replace(',', '.'));
        if (!isNaN(peso) && peso > 0 && peso < 500) {
          if (this.state.weights.find(w => w.date === date)) duplicados.push({ date, peso });
          else novos.push({ date, peso });
        }
      }
    });

    if (!novos.length && !duplicados.length) return this.showAlert('error', 'Nenhum dado válido (formato: 2026-03-16: 114.3kg)');

    let msg = `${novos.length} novo(s) registro(s).`;
    if (duplicados.length) msg += ` ${duplicados.length} data(s) já existem.`;
    const todos = [...novos];
    if (duplicados.length && confirm(`${msg}\n\nSubstituir os ${duplicados.length} registro(s) que já existem?`)) {
      todos.push(...duplicados);
    }
    if (!todos.length) return this.showAlert('warning', 'Nada para importar.');

    this.state.tempImportacao = todos;
    this.showConfirmModal(todos, 'Dados do Texto');
  },

  showConfirmModal(dados, title) {
    const rows = dados.map(d =>
      `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <span>${this.fmt(d.date)}</span>
        <span style="color:var(--gold);font-weight:700">${d.peso.toFixed(1)} kg</span>
      </div>`
    ).join('');
    document.getElementById('resumoImportacao').innerHTML =
      `<h4 style="margin:0 0 12px;color:var(--gold)">${title} — ${dados.length} registros</h4>${rows}`;
    document.getElementById('modalConfirmacao').classList.add('active');
  },

  async confirmarImportacao() {
    if (!this.state.tempImportacao) return;
    const items = this.state.tempImportacao;
    const userId = (await window.VitaleAuth.getUser()).id;
    let count = 0;
    try {
      const rows = items.map(i => ({ user_id: userId, data: i.date, peso: i.peso, origem: i.origem || 'texto' }));
      const { error } = await window.sb.from('weights').upsert(rows, { onConflict: 'user_id,data' });
      if (error) throw error;
      this.state.tempImportacao = null;
      this.state.weights = await this.loadWeights();
      this.closeModal('modalConfirmacao');
      this.updateDashboard();
      count = items.length;
      this.showAlert('success', `✅ ${count} registro(s) importado(s)!`);
      window.VitaleAnalytics.track('import_batch', { count });

      const imgEl = document.querySelector('#imagePreview img');
      if (imgEl) {
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('btnProcessarImagem').style.display = 'none';
        const ocrR = document.getElementById('ocrResult'); if (ocrR) ocrR.innerHTML = '';
      }
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      window.VitaleErr.log('import_batch', e);
    }
  },

  // =====================================================
  // OCR
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

  async processarImagemOCR() {
    const btn = document.getElementById('btnProcessarImagem');
    const ocrDiv = document.getElementById('ocrResult');
    btn.disabled = true;
    btn.textContent = '⏳ Processando com IA...';
    ocrDiv.innerHTML = '';

    const imgEl = document.querySelector('#imagePreview img');
    if (!imgEl) { btn.disabled = false; btn.textContent = '🔍 PROCESSAR COM IA'; return; }

    try {
      const base64 = imgEl.src.split(',')[1];
      const mimeType = imgEl.src.split(';')[0].replace('data:', '') || 'image/jpeg';

      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mime: mimeType })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`OCR ${res.status}: ${errData.error || res.statusText}`);
      }

      const data = await res.json();
      if (data.registros && data.registros.length > 0) {
        // Marca origem como OCR
        const items = data.registros.map(r => ({ ...r, origem: 'ocr' }));
        this.state.tempImportacao = items;
        this.showConfirmModal(items, 'Extraído via IA');
        ocrDiv.innerHTML = `<div class="alert alert-success">✅ IA encontrou ${items.length} registro(s). Confirme abaixo.</div>`;
        window.VitaleAnalytics.track('ocr_success', { count: items.length });
      } else {
        ocrDiv.innerHTML = `<div class="alert alert-warning">⚠️ Nenhum dado de peso identificado na imagem.</div>`;
      }
    } catch (err) {
      ocrDiv.innerHTML = `<div class="alert alert-error">❌ ${err.message}</div>`;
      window.VitaleErr.log('ocr_processar', err);
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
      window.VitaleErr.log('add_submeta', e);
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
      window.VitaleErr.log('add_medicacao', e);
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
        <button class="btn btn-danger btn-small" onclick="VITALE_CORE.removerAgendamento(${med.id})">🗑️</button>
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
  renderHistorico() {
    const el = document.getElementById('pesoTable');
    if (!el) return;
    if (!this.state.weights.length) {
      el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--textm);padding:24px">Nenhum registro ainda</td></tr>';
      return;
    }
    const sorted = this.getSorted();
    const first = sorted[0];
    const reversed = [...sorted].reverse();
    el.innerHTML = reversed.map((w, i, arr) => {
      const prev = arr[i + 1];
      const imcW = this.calcIMC(w.peso, this.altura);
      const varW = prev ? (w.peso - prev.peso).toFixed(1) + ' kg' : '—';
      const pctW = ((first.peso - w.peso) / first.peso * 100).toFixed(1);
      const varColor = prev && (w.peso - prev.peso) < 0 ? 'var(--em)' : prev && (w.peso - prev.peso) > 0 ? 'var(--red)' : 'var(--textm)';
      return `<tr>
        <td>${this.fmt(w.date)}</td>
        <td><strong>${w.peso.toFixed(1)}</strong></td>
        <td style="color:var(--textm)">${imcW}</td>
        <td style="color:${varColor}">${varW}</td>
        <td style="color:var(--gold)"><strong>${pctW}%</strong></td>
        <td><button class="btn btn-danger btn-small" onclick="VITALE_CORE.deletePeso(${w.id})">🗑️</button></td>
      </tr>`;
    }).join('');
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
      window.VitaleAnalytics.track('pdf_generated');
    } catch (err) {
      this.showAlert('error', '❌ Erro ao gerar PDF: ' + err.message);
      window.VitaleErr.log('pdf_gen', err);
    }
  },

  // =====================================================
  // ONBOARDING
  // =====================================================
  checkOnboarding() {
    if (this.state.weights.length === 0 && (!this.state.profile?.altura || this.state.profile.altura === 1.70)) {
      this.showOnboarding();
    }
  },

  showOnboarding() {
    document.getElementById('modalOnboarding')?.classList.add('active');
  },

  async saveOnboarding() {
    const nome = document.getElementById('onbNome').value.trim();
    const altura = parseFloat(document.getElementById('onbAltura').value.replace(',', '.'));
    const peso = parseFloat(document.getElementById('onbPeso').value.replace(',', '.'));

    if (!nome) return this.showAlert('error', 'Como devemos te chamar?');
    if (isNaN(altura) || altura < 1.2 || altura > 2.5) return this.showAlert('error', 'Altura inválida (ex: 1.75)');
    if (isNaN(peso) || peso < 30 || peso > 500) return this.showAlert('error', 'Peso inválido');

    try {
      const userId = (await window.VitaleAuth.getUser()).id;
      await window.sb.from('profiles').update({ nome, altura, updated_at: new Date().toISOString() }).eq('id', userId);
      this.state.profile = { ...this.state.profile, nome, altura };
      const today = new Date().toISOString().slice(0, 10);
      await this.addWeight(today, peso, 'manual');
      this.closeModal('modalOnboarding');
      this.showAlert('success', `Bem-vindo(a), ${nome}! 🎉`);
      this.renderHeader();
      window.VitaleAnalytics.track('onboarding_complete');
    } catch (e) {
      this.showAlert('error', '❌ ' + e.message);
      window.VitaleErr.log('onboarding', e);
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
      vitale_version: '4.0',
      exportedAt: new Date().toISOString(),
      profile: this.state.profile,
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
    await window.VitaleAuth.signOut();
  }
};

window.VITALE_CORE = VITALE_CORE;
