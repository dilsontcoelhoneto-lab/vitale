// =====================================================
// VITALE — Supabase Client
// IMPORTANTE: Substitua as duas constantes abaixo pelos
// valores do seu projeto (Settings > API no Supabase Dashboard)
// =====================================================

const SUPABASE_URL = window.VITALE_CONFIG?.SUPABASE_URL || 'COLE_SUA_URL_AQUI';
const SUPABASE_ANON_KEY = window.VITALE_CONFIG?.SUPABASE_ANON_KEY || 'COLE_SUA_ANON_KEY_AQUI';

// Importa o cliente Supabase via CDN (carregado no HTML)
const { createClient } = window.supabase;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Disponibiliza globalmente
window.sb = sb;

// =====================================================
// Helpers de autenticação
// =====================================================
window.VitaleAuth = {
  async getUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
  },

  async getProfile() {
    const user = await this.getUser();
    if (!user) return null;
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) {
      console.warn('Erro ao buscar profile:', error);
      return null;
    }
    return data;
  },

  async signInWithPassword(email, senha) {
    return await sb.auth.signInWithPassword({ email, password: senha });
  },

  async signUpWithPassword(email, senha) {
    return await sb.auth.signUp({
      email,
      password: senha,
      options: { emailRedirectTo: window.location.origin + '/app.html' }
    });
  },

  async signInWithMagicLink(email) {
    return await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/app.html' }
    });
  },

  async signOut() {
    await sb.auth.signOut();
    window.location.href = '/index.html';
  },
  async requireAuth() {
    // Se há tokens de auth na URL (signup/magic-link), aguarda Supabase processar
    if (window.location.hash && window.location.hash.includes('access_token')) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 3000);
        const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            clearTimeout(timeout);
            subscription.unsubscribe();
            history.replaceState(null, '', window.location.pathname);
            resolve();
          }
        });
      });
    }
    const user = await this.getUser();
    if (!user) {
      window.location.href = '/index.html';
      return null;
    }
    return user;
  },

  async requireAdmin() {
    const profile = await this.getProfile();
    if (!profile || profile.role !== 'admin') {
      window.location.href = '/app.html';
      return null;
    }
    return profile;
  }
};

// =====================================================
// Helper: log de erros centralizado (vai para a Torre)
// =====================================================
window.VitaleErr = {
  async log(contexto, error) {
    try {
      const user = await window.VitaleAuth.getUser();
      await sb.from('error_logs').insert({
        user_id: user?.id || null,
        user_email: user?.email || null,
        contexto,
        mensagem: error?.message || String(error),
        stack: error?.stack || null,
        user_agent: navigator.userAgent,
        url: window.location.href
      });
    } catch (e) {
      console.error('[VitaleErr] falha ao logar erro:', e);
    }
  }
};

// =====================================================
// Helper: analytics simples
// =====================================================
window.VitaleAnalytics = {
  async track(acao, detalhes = {}) {
    try {
      const user = await window.VitaleAuth.getUser();
      if (!user) return;
      await sb.from('usage_analytics').insert({
        user_id: user.id,
        acao,
        detalhes
      });
    } catch (e) {
      // silencioso — analytics nunca quebra app
    }
  }
};
