// =====================================================
// VITALE — vitale-calc.js
// Módulo ÚNICO de cálculos clínicos (fonte de verdade).
// Funções PURAS (sem `this`, sem DOM) → testáveis por node.
// Roda no navegador (window.VitaleCalc) e no node (module.exports).
// Reproduz exatamente a lógica auditada em v5.6.
// =====================================================
(function (root) {
  'use strict';

  // ---------- IMC ----------
  function calcIMC(pesoKg, alturaM) {
    if (!(pesoKg > 0) || !(alturaM > 0)) return null;
    return pesoKg / (alturaM * alturaM);
  }

  // Classificação OMS
  function faixaIMC(imc) {
    const v = parseFloat(imc);
    if (!isFinite(v)) return null;
    if (v < 18.5) return { grau: 'Baixo Peso', cor: '#4a9de8' };
    if (v < 25) return { grau: 'Peso Normal', cor: '#27c47d' };
    if (v < 30) return { grau: 'Sobrepeso', cor: '#d4a843' };
    if (v < 35) return { grau: 'Obesidade I', cor: '#e8924a' };
    if (v < 40) return { grau: 'Obesidade II', cor: '#e8504a' };
    return { grau: 'Obesidade III', cor: '#c0392b' };
  }

  // Altura válida (sem fallback) — corrige o bug da v5.5
  function alturaValida(altura) {
    const a = parseFloat(altura);
    return (!isNaN(a) && a >= 1.2 && a <= 2.3) ? a : null;
  }

  // ---------- Velocidade de perda (v5.6) ----------
  // pesos: [{date/data:'YYYY-MM-DD', peso:Number}] em ordem crescente.
  // Usa janela recente (28d) e cai p/ histórico só sem registros recentes.
  function velocidade(pesos, janelaDias) {
    janelaDias = janelaDias || 28;
    const arr = (pesos || []).map(w => ({ d: w.date || w.data, p: parseFloat(w.peso) }))
      .filter(w => w.d && isFinite(w.p)).sort((a, b) => a.d < b.d ? -1 : 1);
    if (arr.length < 2) return { kgDia: 0, base: 'sem_dados', dias: 0, confiavel: false };

    const corte = new Date(); corte.setDate(corte.getDate() - janelaDias);
    const corteStr = corte.toISOString().slice(0, 10);
    const rec = arr.filter(w => w.d >= corteStr);

    if (rec.length >= 2) {
      const a = rec[0], b = rec[rec.length - 1];
      const d = Math.max(Math.round((new Date(b.d + 'T12:00:00') - new Date(a.d + 'T12:00:00')) / 86400000), 1);
      return { kgDia: (a.p - b.p) / d, base: 'recente', dias: d, confiavel: d >= 7 };
    }
    const f = arr[0], l = arr[arr.length - 1];
    const d = Math.max(Math.round((new Date(l.d + 'T12:00:00') - new Date(f.d + 'T12:00:00')) / 86400000), 1);
    return { kgDia: (f.p - l.p) / d, base: 'historico', dias: d, confiavel: false };
  }

  // ---------- TMB Mifflin-St Jeor (v5.6) ----------
  // sexo: 'm'/'masculino' vs outro (feminino). idade em anos.
  function tmbMifflin(pesoKg, alturaCm, idade, sexo) {
    if (!(pesoKg > 0) || !(alturaCm > 0) || !(idade >= 10 && idade <= 110)) return null;
    const s = String(sexo || '').toLowerCase();
    const ajuste = s.startsWith('m') ? 5 : -161;
    return Math.round(10 * pesoKg + 6.25 * alturaCm - 5 * idade + ajuste);
  }

  function idadeDe(dataNascimento) {
    if (!dataNascimento) return null;
    const i = Math.floor((Date.now() - new Date(dataNascimento)) / (365.25 * 24 * 3600 * 1000));
    return (isFinite(i) && i >= 0 && i < 120) ? i : null;
  }

  // ---------- Status de marcador laboratorial ----------
  // metasOtim: overlay {max?, min?} de otimização; null = só referência.
  function statusMarcador(valor, refMin, refMax, metaOtim) {
    const foraRef = (refMin != null && valor < refMin) || (refMax != null && valor > refMax);
    if (foraRef) return 'fora';
    if (!metaOtim) return 'ok';
    const atinge = (metaOtim.max == null || valor <= metaOtim.max) && (metaOtim.min == null || valor >= metaOtim.min);
    return atinge ? 'otimo' : 'atencao';
  }

  // ---------- Relação cintura/quadril ----------
  function rcq(cintura, quadril) {
    if (!(cintura > 0) || !(quadril > 0)) return null;
    return cintura / quadril;
  }

  // ---------- Caloria de exercício (MET × peso × horas) ----------
  function calExercicio(met, pesoKg, duracaoMin) {
    if (!(met > 0) || !(pesoKg > 0) || !(duracaoMin > 0)) return null;
    return Math.round(met * pesoKg * (duracaoMin / 60));
  }

  // ---------- Peso-alvo para um IMC ----------
  function pesoAlvoIMC(imcAlvo, alturaM) {
    if (!(imcAlvo > 0) || !(alturaM > 0)) return null;
    return parseFloat((imcAlvo * alturaM * alturaM).toFixed(1));
  }

  const API = {
    calcIMC, faixaIMC, alturaValida, velocidade,
    tmbMifflin, idadeDe, statusMarcador, rcq, calExercicio, pesoAlvoIMC
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VitaleCalc = API;
})(typeof window !== 'undefined' ? window : globalThis);
