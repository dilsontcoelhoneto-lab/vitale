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
      const promptAnalise = `Você reúne quatro olhares sobre a mesma pessoa: um endocrinologista (metabolismo, GLP-1, tireoide, resistência à insulina), um nutrólogo (proteína, composição corporal, padrão alimentar), um fisiologista do exercício (treino, gasto energético, recuperação) e um clínico que costura tudo. Você fala pelo VITALE, para o próprio paciente ler.

Analise a PESSOA COMO UM TODO — não comente números isolados, encontre as CONEXÕES entre eles e conte a história por trás dos dados. Cruze as quatro lentes: por exemplo, ligue a resistência à insulina (HOMA-IR) ao padrão de proteína e treino; ligue as enzimas hepáticas à estatina e ao exercício recente; ligue a preservação de massa magra à adesão à proteína no GLP-1.

ESTRUTURA (use estes rótulos em <strong>, nesta ordem):
1. <strong>O que está indo bem</strong> — 1-2 vitórias reais e específicas.
2. <strong>O que vigiar</strong> — o que merece atenção agora, com o porquê.
3. <strong>3 ações para as próximas semanas</strong> — concretas, na ordem de impacto.
4. <strong>Quando procurar seu médico</strong> — só se algo justificar; diga o quê e com que urgência.

REGRAS:
- Linguagem clara, em português do Brasil, sem jargão desnecessário.
- Pode interpretar os DADOS de forma assertiva (tendências, o que está fora da faixa, o que os marcadores costumam indicar), mas NUNCA dê diagnóstico fechado nem prescreva medicamento/dose. A interpretação é educacional.
- Se algum marcador estiver MUITO alterado ou houver combinação preocupante, gere um alerta claro recomendando procurar o médico (com urgência se for grave) — sem causar pânico.
- No tratamento GLP-1, valorize a preservação de massa muscular e a relação dose × resposta.
- Se houver "proteina" (meta_g_dia, hoje_g e meta_batida_ultimos_7_dias), comente a adesão à proteína — é o fator que mais preserva massa magra em GLP-1. Ex.: bateu a meta em poucos dos 7 é um alerta prático. Cruze com "composicao.tendencia_massa_muscular" quando existir.
- Se houver "balanco_calorico" com basal/rotina/exercicio, distinga a origem do déficit (treino vs. ingestão) — são leituras diferentes.
- Se houver "protocolo_medicacoes" (medicamentos e suplementos com horário, relação com alimento e há quanto tempo usa), considere-o na leitura: possíveis interações (ex.: NAC × zinco, ferro × cálcio), adesão, se o horário/alimento está adequado (ex.: lipossolúveis com gordura), e conexões com os exames (ex.: estatina e enzimas hepáticas; metformina e B12). Não prescreva dose — comente de forma educativa e sugira validar com o médico.
- Se houver "genetica" (achados de teste de DNA), use como CONTEXTO explicativo, não como diagnóstico: conecte com os exames e o protocolo (ex.: predisposição a vitamina D baixa explica a Vit. D dos exames e justifica a suplementação; variante MTHFR justifica B-complexo metilado; predisposição a obesidade reforça a importância do controle de peso). Trate como probabilidade herdada, sempre "predisposição", nunca certeza. Alertas farmacogenéticos (ex.: sensibilidade a AINEs) valem menção.
- Use HTML inline simples (<strong>, <br>), sem markdown. Máximo ~550 palavras, parágrafos curtos. Não repita o JSON nem liste dados crus.

DADOS DA PESSOA (JSON):
${JSON.stringify(ctx, null, 2)}`;

      const ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: promptAnalise }] })
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
    // TIPO: ANÁLISE PARA O MÉDICO (IA-5) — resumo clínico assistido
    // O médico está autenticado com o token DELE. Antes de gastar API,
    // validamos que existe consentimento ATIVO dele para este paciente.
    // Sem isso, um médico poderia pedir análise de quem não autorizou.
    // ============================================================
    if (tipo === 'analise_medico') {
      const pacienteId = body.paciente_id;
      if (!pacienteId) {
        return new Response(JSON.stringify({ error: 'paciente_id ausente' }), { status: 400, headers: corsHeaders });
      }
      // valida consentimento ativo médico(user.id) -> paciente
      let autorizado = false;
      try {
        const cr = await fetch(`${env.SUPABASE_URL}/rest/v1/consentimentos?medico_id=eq.${user.id}&paciente_id=eq.${pacienteId}&status=eq.ativo&select=id`, {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}` }
        });
        const rows = await cr.json();
        autorizado = Array.isArray(rows) && rows.length > 0;
      } catch (e) {}
      if (!autorizado) {
        return new Response(JSON.stringify({ error: 'sem_consentimento' }), { status: 403, headers: corsHeaders });
      }

      // registra na trilha de auditoria (o paciente vê que houve análise)
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/acessos_medico`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ medico_id: user.id, paciente_id: pacienteId, acao: 'analise_ia' })
        });
      } catch (e) {}

      const ctxM = contexto || {};
      const promptMed = `Você é um assistente clínico do VITALE apoiando um MÉDICO na leitura rápida de um paciente. NÃO é laudo nem prescrição — é um resumo para poupar o tempo dele antes/na consulta. Público: profissional de saúde, então pode usar termos técnicos e ser direto.

Os dados são AUTO-RELATADOS pelo paciente no app (peso, composição por bioimpedância, exames que ele cadastrou, protocolo de medicações e suplementos, treinos). Trate-os como relato, não como prontuário.

Produza um resumo TELEGRÁFICO em HTML inline (<strong>, <br>), com estes blocos:
<strong>Panorama</strong> — 1-2 linhas: quem é, objetivo, tempo de acompanhamento, tendência de peso/composição.
<strong>Sinais de atenção</strong> — marcadores fora da faixa, combinações de risco, adesão à proteína baixa, efeitos colaterais relatados. Ordene por relevância clínica. Se nada relevante, diga.
<strong>Interações e conduta a considerar</strong> — do protocolo: interações plausíveis, adequação de horário/jejum, e conexões com exames (ex.: estatina × TGO/TGP, metformina × B12). Se houver "genetica", conecte achados relevantes (ex.: predisposição a Vit. D baixa, MTHFR, farmacogenética de AINEs, portador de alfa-1 antitripsina). Sugestões de conduta como HIPÓTESES a validar, nunca prescrição.
<strong>Perguntar na consulta</strong> — 2-3 perguntas objetivas que os dados sugerem.

REGRAS: máximo ~350 palavras; sem diagnóstico fechado; sem dose prescrita; termine com "<em>Resumo assistido por IA sobre dados auto-relatados — a conduta é do médico.</em>". Não repita o JSON.

DADOS DO PACIENTE (JSON):
${JSON.stringify(ctxM, null, 2)}`;

      const mr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1100, messages: [{ role: 'user', content: promptMed }] })
      });
      if (!mr.ok) {
        const t = await mr.text();
        return new Response(JSON.stringify({ error: `Erro da IA (${mr.status})`, detail: t.slice(0, 150) }), { status: mr.status, headers: corsHeaders });
      }
      const md = await mr.json();
      const message = (md.content || []).map(c => c.text || '').join('').trim();
      return new Response(JSON.stringify({ message }), { headers: corsHeaders });
    }

    // ============================================================
    // TIPO: COACH (mensagem motivacional do progresso)
    // ============================================================
    if (tipo === 'coach') {
      const { altura, meta_kg, nome, historico, historico_peso, submetas,
              objetivo, exercicios_semana, proteina, balanco_calorico,
              composicao_corporal } = contexto || {};
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

      // v5.40 (IA-3) — sinais além do peso, para o coach da home ser
      // realmente personalizado. Curtos de propósito (custo baixo).
      const sinais = [];
      if (objetivo) sinais.push(`Objetivo declarado: ${objetivo} (adapte o tom — nem todo mundo quer emagrecer).`);
      if (exercicios_semana) sinais.push(`Exercício nos últimos 7 dias: ${exercicios_semana.treinos} treino(s), ${exercicios_semana.minutos} min, ${exercicios_semana.kcal} kcal (${(exercicios_semana.tipos || []).join(', ')}).`);
      if (proteina) sinais.push(`Proteína: meta ${proteina.meta_g_dia} g/dia; bateu em ${proteina.meta_batida_ultimos_7_dias} dos últimos 7 dias.`);
      if (balanco_calorico) sinais.push(`Balanço de hoje: consumiu ${balanco_calorico.consumido} kcal, gastou ${balanco_calorico.gasto} (basal ${balanco_calorico.basal} + rotina ${balanco_calorico.rotina} + exercício ${balanco_calorico.exercicio}); saldo ${balanco_calorico.saldo}.`);
      if (composicao_corporal && composicao_corporal.tendencia_massa_muscular) sinais.push(`Massa muscular (bioimpedância): ${composicao_corporal.tendencia_massa_muscular}.`);

      const prompt = `Você é o "VITALE Coach", um coach de saúde pessoal brasileiro, direto, motivador mas honesto.

Dados do usuário:
- Nome: ${nome || 'usuário'}
- Altura: ${altura} m
- Peso inicial (${first.date}): ${first.peso} kg
- Peso atual (${last.date}): ${last.peso} kg
- IMC atual: ${imc}
- Meta (~${meta_kg} kg)
- Período: ${dias} dias · Variação: ${perdido} kg · Velocidade: ${velSem} kg/semana
- Últimos pesos: ${JSON.stringify(hist.slice(-6))}
${submetasTxt ? '\nSubmetas:\n' + submetasTxt : ''}
${sinais.length ? '\nSinais recentes (use o que for mais relevante HOJE, não repita tudo):\n- ' + sinais.join('\n- ') : ''}

Gere uma mensagem MOTIVACIONAL E PERSONALIZADA em português com:
1. Reconhecimento do progresso real
2. Uma observação PONTUAL baseada nos sinais recentes (ex.: adesão à proteína, semana de treino, saldo calórico) — escolha o mais relevante, não liste tudo
3. UM conselho prático específico ligado ao objetivo declarado

Regras: máximo 4 parágrafos curtos; adeque ao objetivo (se não é emagrecimento, NÃO fale em "perder peso"); HTML inline (<strong>, <span class="hl">, <br>); destaque números com <span class="hl">XX</span>; tom de parceiro honesto; sem markdown; no máximo 2 emojis; termine com a ação concreta. Responda APENAS o HTML.`;

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
