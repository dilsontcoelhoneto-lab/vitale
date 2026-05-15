// =====================================================
// VITALE — Sistema de Feature Flags
// Permite liberar/bloquear funcionalidades pela Torre de Comando
// =====================================================

window.VitaleFlags = {
  _cache: null,
  _cacheTime: 0,
  CACHE_TTL: 60000, // 1 minuto

  async load(force = false) {
    const now = Date.now();
    if (!force && this._cache && (now - this._cacheTime) < this.CACHE_TTL) {
      return this._cache;
    }
    try {
      const { data, error } = await window.sb
        .from('feature_flags')
        .select('flag_key, enabled, fase, rollout_pct, flag_name, descricao');
      if (error) throw error;
      this._cache = {};
      (data || []).forEach(f => { this._cache[f.flag_key] = f; });
      this._cacheTime = now;
      return this._cache;
    } catch (e) {
      console.warn('[Flags] erro ao carregar, usando defaults conservadores:', e);
      // fallback: tudo habilitado para não travar
      this._cache = {};
      return this._cache;
    }
  },

  async isEnabled(flagKey) {
    const flags = await this.load();
    const f = flags[flagKey];
    if (!f) return false; // se a flag não existe, fica oculta
    if (!f.enabled) return false;
    // rollout percentual: usa hash determinístico do user_id
    if (f.rollout_pct < 100) {
      const user = await window.VitaleAuth.getUser();
      if (!user) return false;
      const hash = this._hashCode(user.id) % 100;
      return hash < f.rollout_pct;
    }
    return true;
  },

  // hash determinístico simples — mesmo usuário sempre cai no mesmo bucket
  _hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  },

  // Aplica visibilidade em elementos com [data-flag="nome_da_flag"]
  async applyToUI() {
    const flags = await this.load();
    const elements = document.querySelectorAll('[data-flag]');
    for (const el of elements) {
      const flagKey = el.getAttribute('data-flag');
      const enabled = await this.isEnabled(flagKey);
      if (!enabled) {
        el.style.display = 'none';
        el.classList.add('flag-disabled');
      } else {
        el.classList.remove('flag-disabled');
      }
    }
    // Tabs com data-flag também
    document.querySelectorAll('.tab-btn[data-flag]').forEach(async (btn) => {
      const flagKey = btn.getAttribute('data-flag');
      const enabled = await this.isEnabled(flagKey);
      if (!enabled) {
        btn.style.display = 'none';
      }
    });
  }
};
