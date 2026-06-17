// =====================================================
// VITALE — Proxy Coach IA + Análise Completa
// Cloudflare Pages Function — Endpoint: POST /api/chat
// SUBSTITUA o seu /functions/api/chat.js inteiro por este arquivo.
// =====================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  try {
    // ---- Auth: pega o token e descobre QUEM é o usuário (id + email) ----
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: corsHeaders });
    }

    // Resolve o usuário pelo token, via Supabase Auth
    let user = null;
    try {
      const ures = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${token}` }
      });
      if (ures.ok) user = await ures.json();
    } catch (e) {}
    if (!user || !user.id) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), { status: 401, headers: corsHeaders });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.tipo) {
      return new Response(JSON.stringify({ error: 'Payload inválido' }), { status: 400, headers: corsHeaders });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Servidor não configurado' }), { status: 500, headers: corsHeaders });
    }

    const { tipo, contexto } = body;

    // ============================================================
    // TIPO: ANÁLISE COMPLETA (mergulho profundo, com rate limit)
    // ============================================================
    if (tipo === 'analise_completa') {
      const ADMIN_EMAILS = ['dilson@acacianegocios.com.br']; // ⚠️ ajuste para o SEU e-mail
      const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

      // lê o plano no health_profile (service role p/ ignorar RLS com segurança)
      let plano = 'free';
      try {
        const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/health_profile?id=eq.${user.id}&select=plano`, {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` }
        });
        const rows = await pr.json();
        if (Array.isArray(rows) && rows[0]) plano = rows[0].plano || 'free';
      } catch (e) {}
      const ilimitado = isAdmin || plano === 'pro' || plano === 'med' || plano === 'admin';

      // limite: 1/dia no grátis
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      if (!ilimitado) {
        try {
          const lr = await fetch(`${env.SUPABASE_URL}/rest/v1/analise_log?user_id=eq.${user.id}&data=eq.${hoje}&select=id`, {
            headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` }
          });
          const usadas = await lr.json();
          if (Array.isArray(usadas) && usadas.length >= 1) {
            return new Response(JSON.stringify({ error: 'limite_diario' }), { status: 429, headers: corsHeaders });
          }
        } catch (e) {}
      }

      const ctx = contexto || {};
      const promptAnalise = `Você é um analista de saúde metabólica do VITALE, com conhecimento atualizado em obesidade, tratamento GLP-1, composição corporal e hábitos.

Analise a PESSOA COMO UM TODO a partir dos dados abaixo — não comente números isolados, encontre conexões, padrões e a história. Seja específico, acolhedor e direto. Destaque o que está indo bem, o que merece atenção, e 2-3 ações concretas. Se houver memória do usuário (eventos como viagens, padrões emocionais), use-a para contextualizar.

REGRAS:
- Linguagem clara, em português do Brasil, sem jargão desnecessário.
- Baseie-se em conhecimento de saúde atualizado, mas NUNCA dê diagnóstico nem prescrição.
- Se algum dado clínico (glicemia, pressão) parecer alterado, sugira levar ao médico — sem alarmar.
- No tratamento GLP-1, valorize a preservação de massa muscular e a relação dose × resposta.
- Use HTML inline simples (<strong>, <br>), sem markdown. Máximo ~400 palavras, parágrafos curtos.

DADOS DA PESSOA (JSON):
${JSON.stringify(ctx, null, 2)}`;

      const ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: promptAnalise }] })
      });
      if (!ar.ok) {
        const t = await ar.text();
        return new Response(JSON.stringify({ error: `Erro da IA (${ar.status})`, detail: t.slice(0, 150) }), { status: ar.status, headers: corsHeaders });
      }
      const ad = await ar.json();
      const message = (ad.content || []).map(c => c.text || '').join('').trim();

      // registra o uso no servidor (blindado contra burla)
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/analise_log`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: user.id, data: hoje, resultado: message })
        });
      } catch (e) {}

      return new Response(JSON.stringify({ message }), { headers: corsHeaders });
    }

    // ============================================================
    // TIPO: COACH (mensagem motivacional do progresso)
    // ============================================================
    if (tipo === 'coach') {
      const { altura, meta_kg, nome, historico, historico_peso, submetas } = contexto || {};
      const hist = historico || historico_peso || [];
      if (!Array.isArray(hist) || hist.length < 2) {
        return new Response(JSON.stringify({ error: 'Histórico insuficiente' }), { status: 400, headers: corsHeaders });
      }
      const first = hist[0];
      const last = hist[hist.length - 1];
      const dias = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
      const perdido = (first.peso - last.peso).toFixed(1);
      const velSem = dias > 0 ? ((first.peso - last.peso) / dias * 7).toFixed(2) : '0';
      const imc = altura ? (last.peso / (altura * altura)).toFixed(1) : '—';
      const submetasTxt = (submetas || []).slice(0, 3).map(s => `- ${s.nome}: alvo ${s.pesoAlvo} kg ${s.dataAlvo ? 'até ' + s.dataAlvo : ''}`).join('\n');

      const prompt = `Você é o "VITALE Coach", um coach de saúde pessoal brasileiro, direto, motivador mas honesto.

Dados do usuário:
- Nome: ${nome || 'usuário'}
- Altura: ${altura} m
- Peso inicial (${first.date}): ${first.peso} kg
- Peso atual (${last.date}): ${last.peso} kg
- IMC atual: ${imc}
- Meta IMC < 30 (~${meta_kg} kg)
- Período: ${dias} dias · Total perdido: ${perdido} kg · Velocidade: ${velSem} kg/semana
- Últimos pesos: ${JSON.stringify(hist.slice(-6))}
${submetasTxt ? '\nSubmetas:\n' + submetasTxt : ''}

Gere uma mensagem MOTIVACIONAL E PERSONALIZADA em português com:
1. Reconhecimento do progresso real
2. Análise da tendência das últimas semanas
3. Projeção honesta para a meta
4. UM conselho prático específico

Regras: máximo 4 parágrafos curtos; HTML inline (<strong>, <span class="hl">, <br>); destaque números com <span class="hl">XX kg</span>; tom de parceiro honesto; sem markdown; no máximo 2 emojis; termine com a ação concreta, não com frase vazia. Responda APENAS o HTML.`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
      });
      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        return new Response(JSON.stringify({ error: `Erro da IA (${claudeRes.status})` }), { status: claudeRes.status, headers: corsHeaders });
      }
      const data = await claudeRes.json();
      const message = (data.content || []).map(c => c.text || '').join('').trim();
      return new Response(JSON.stringify({ message }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Tipo de chat não suportado' }), { status: 400, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Erro interno: ' + e.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}
