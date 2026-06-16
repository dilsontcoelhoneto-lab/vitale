// =====================================================
// VITALE — Proxy Coach IA
// Cloudflare Pages Function (runtime Workers)
// Endpoint: POST /api/chat
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
    // Auth check básica (mesma estratégia do OCR)
    const authHeader = request.headers.get('Authorization');
    const cookieHeader = request.headers.get('Cookie') || '';
    if ((!authHeader || !authHeader.startsWith('Bearer ')) && !cookieHeader.includes('sb-')) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: corsHeaders
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.tipo) {
      return new Response(JSON.stringify({ error: 'Payload inválido' }), {
        status: 400, headers: corsHeaders
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Servidor não configurado' }), {
        status: 500, headers: corsHeaders
      });
    }

    const { tipo, contexto } = body;

    // ===== TIPO: COACH (análise motivacional do progresso) =====
    if (tipo === 'coach') {
      const { altura, meta_kg, nome, historico, submetas } = contexto || {};
      if (!historico || !Array.isArray(historico) || historico.length < 2) {
        return new Response(JSON.stringify({ error: 'Histórico insuficiente' }), {
          status: 400, headers: corsHeaders
        });
      }

      const first = historico[0];
      const last = historico[historico.length - 1];
      const dias = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000);
      const perdido = (first.peso - last.peso).toFixed(1);
      const velSem = dias > 0 ? ((first.peso - last.peso) / dias * 7).toFixed(2) : '0';
      const imc = (last.peso / (altura * altura)).toFixed(1);

      const submetasTxt = (submetas || []).slice(0, 3).map(s =>
        `- ${s.nome}: alvo ${s.pesoAlvo} kg ${s.dataAlvo ? 'até ' + s.dataAlvo : ''}`
      ).join('\n');

      const prompt = `Você é o "VITALE Coach", um coach de saúde pessoal brasileiro, direto, motivador mas honesto.

Dados do usuário:
- Nome: ${nome || 'usuário'}
- Altura: ${altura} m
- Peso inicial (${first.date}): ${first.peso} kg
- Peso atual (${last.date}): ${last.peso} kg
- IMC atual: ${imc}
- Meta IMC < 30 (~${meta_kg} kg)
- Período monitorado: ${dias} dias
- Total perdido: ${perdido} kg
- Velocidade média: ${velSem} kg/semana
- Últimos pesos: ${JSON.stringify(historico.slice(-6))}
${submetasTxt ? '\nSubmetas:\n' + submetasTxt : ''}

Gere uma mensagem MOTIVACIONAL E PERSONALIZADA em português brasileiro com:
1. Reconhecimento do progresso real
2. Análise da tendência das últimas semanas (acelerando, estável, desacelerando?)
3. Projeção honesta para meta
4. UM conselho prático específico para o estado atual

Regras:
- Máximo 4 parágrafos curtos
- Use HTML inline: <strong>, <span class="hl">, <br>
- Numere conquistas em destaque com <span class="hl">XX kg</span>
- Tom: parceiro de jornada, não vendedor; honesto mas encorajador
- Se houver platô ou regressão, mencione com empatia e sugira ajuste prático
- NÃO use markdown, NÃO use emojis em excesso (no máximo 2)
- NÃO termine com "Conte comigo" ou frases vazias — termine com a ação concreta

Responda APENAS o HTML da mensagem, nada mais.`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error('[Chat] Claude API erro:', claudeRes.status, errText);
        return new Response(JSON.stringify({
          error: `Erro da IA (${claudeRes.status})`
        }), { status: claudeRes.status, headers: corsHeaders });
      }

      const data = await claudeRes.json();
      const message = (data.content || []).map(c => c.text || '').join('').trim();

      return new Response(JSON.stringify({ message }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Tipo de chat não suportado' }), {
      status: 400, headers: corsHeaders
    });

  } catch (e) {
    console.error('[Chat] erro:', e);
    return new Response(JSON.stringify({ error: 'Erro interno: ' + e.message }), {
      status: 500, headers: corsHeaders
    });
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
// =====================================================
// VITALE — Trecho para o endpoint /functions/api/chat.js (Cloudflare)
// Cole/adapte ao seu endpoint existente. Faz 2 coisas:
//   1) Trava de limite de Análise Completa (anti-burla, server-side)
//   2) Prompt da Análise Completa com disclaimer forte
// Precisa do Supabase service role pra checar o log com segurança.
// =====================================================

// --- Dentro do onRequestPost, depois de identificar o usuário (user.id) ---

if (body.tipo === 'analise_completa') {
  // 1) Descobrir plano/admin do usuário
  const ADMIN_EMAILS = ['dilson@acacianegocios.com.br']; // ajuste
  const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

  // lê o plano no health_profile
  let plano = 'free';
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/health_profile?id=eq.${user.id}&select=plano`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` }
    });
    const rows = await r.json();
    if (rows && rows[0]) plano = rows[0].plano || 'free';
  } catch (e) {}
  const ilimitado = isAdmin || plano === 'pro' || plano === 'med' || plano === 'admin';

  // 2) Se não for ilimitado, checar se já usou hoje
  if (!ilimitado) {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/analise_log?user_id=eq.${user.id}&data=eq.${hoje}&select=id`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` }
    });
    const usadas = await r.json();
    if (Array.isArray(usadas) && usadas.length >= 1) {
      return new Response(JSON.stringify({ error: 'limite_diario' }), { status: 429, headers: corsHeaders });
    }
  }

  // 3) Prompt da análise completa
  const ctx = body.contexto || {};
  const promptAnalise = `Você é um analista de saúde metabólica do VITALE, com conhecimento atualizado em obesidade, tratamento GLP-1, composição corporal e hábitos.

Analise a PESSOA COMO UM TODO a partir dos dados abaixo — não comente números isolados, encontre conexões, padrões e a história. Seja específico, acolhedor e direto. Destaque o que está indo bem, o que merece atenção, e 2-3 ações concretas. Se houver memória do usuário (eventos como viagens, padrões emocionais), use-a para contextualizar.

REGRAS:
- Linguagem clara, em português do Brasil, sem jargão desnecessário.
- Baseie-se em conhecimento de saúde atualizado, mas NUNCA dê diagnóstico nem prescrição.
- Se algum dado clínico (glicemia, pressão) parecer alterado, sugira levar ao médico — sem alarmar.
- No tratamento GLP-1, valorize a preservação de massa muscular e a relação dose × resposta.
- Máximo ~400 palavras. Use parágrafos curtos.

DADOS DA PESSOA (JSON):
${JSON.stringify(ctx, null, 2)}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: promptAnalise }] })
  });
  const d = await r.json();
  const message = (d.content || []).map(c => c.text || '').join('').trim();
  return new Response(JSON.stringify({ message }), { headers: corsHeaders });
}

// IMPORTANTE: o registro no analise_log é feito pelo app (client) após receber a resposta.
// Se quiser blindar 100%, mova o insert do log pra cá (server) usando o service role.

