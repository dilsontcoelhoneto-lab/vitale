// =====================================================
// VITALE — Sistema de Feature Flags (v2 — 3 bugs corrigidos)
// =====================================================

window.VitaleFlags = {
  _cache: null,
  _cacheTime: 0,
  CACHE_TTL: 30000,

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
      console.warn('[Flags] erro ao carregar:', e);
      this._cache = {};
      return this._cache;
    }
  },

  async isEnabled(flagKey) {
    const flags = await this.load();
    const f = flags[flagKey];
    if (!f) return false;
    if (!f.enabled) return false;
    // BUG FIX: rollout_pct = 0 com enabled = true = liga pra todos
    if (f.rollout_pct === 0 || f.rollout_pct >= 100) return true;
    const user = await window.VitaleAuth.getUser();
    if (!user) return false;
    const hash = this._hashCode(user.id) % 100;
    return hash < f.rollout_pct;
  },

  _hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  },

  // BUG FIX: restaura display quando flag é religada
  async applyToUI() {
    const flags = await this.load();
    const elements = document.querySelectorAll('[data-flag]');
    for (const el of elements) {
      const flagKey = el.getAttribute('data-flag');
      const enabled = await this.isEnabled(flagKey);
      if (!enabled) {
        if (!el.hasAttribute('data-orig-display')) {
          const computed = window.getComputedStyle(el).display;
          el.setAttribute('data-orig-display', computed === 'none' ? '' : computed);
        }
        el.style.display = 'none';
        el.classList.add('flag-disabled');
      } else {
        el.style.removeProperty('display');
        el.classList.remove('flag-disabled');
      }
    }
  },

  async refresh() {
    await this.load(true);
    await this.applyToUI();
  }
};
