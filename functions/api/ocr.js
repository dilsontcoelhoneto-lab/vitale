// =====================================================
// VITALE — Proxy OCR
// Cloudflare Pages Function (runtime Workers)
// Endpoint: POST /api/ocr
// =====================================================
// Recebe { image (base64), mime, modo } do frontend autenticado,
// chama a Claude API server-side e devolve:
//   - modo 'peso' (padrão):        { registros: [...] }
//   - modo 'bioimpedancia':        { medidas: {...} }
// A chave da API NUNCA sai do servidor.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  try {
    // 1) Verifica JWT do Supabase (segurança extra além do CORS)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const cookieHeader = request.headers.get('Cookie') || '';
      if (!cookieHeader.includes('sb-')) {
        return new Response(JSON.stringify({ error: 'Não autenticado' }), {
          status: 401, headers: corsHeaders
        });
      }
    }

    // 2) Valida payload
    const body = await request.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: 'Payload inválido' }), { status: 400, headers: corsHeaders });
    }

    // Caminho especial: estimativa de alimento por TEXTO (sem imagem)
    if (body.modo === 'alimento_texto') {
      if (!env.ANTHROPIC_API_KEY) {
        return new Response(JSON.stringify({ error: 'Servidor não configurado (ANTHROPIC_API_KEY ausente)' }), { status: 500, headers: corsHeaders });
      }
      const texto = (body.texto || '').slice(0, 500);
      if (!texto) return new Response(JSON.stringify({ error: 'Texto vazio' }), { status: 400, headers: corsHeaders });
      const promptTexto = `O usuário descreveu uma refeição em texto livre: "${texto}"

Estime as calorias totais com base na descrição. Seja realista, não otimista. Se houver peso/quantidade, use para calibrar.

Responda APENAS com JSON puro, sem markdown:
{"alimento":{"descricao":"<resumo curto do que foi descrito>","calorias":0,"peso_g":0}}

Se não der pra estimar (texto não é comida), responda {"alimento":null}.`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: promptTexto }] })
      });
      if (!r.ok) {
        const e = await r.text();
        return new Response(JSON.stringify({ error: `IA (${r.status})`, detail: e.slice(0, 150) }), { status: r.status, headers: corsHeaders });
      }
      const rd = await r.json();
      const raw = (rd.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
      let p; try { p = JSON.parse(raw); } catch { const mm = raw.match(/\{[\s\S]*\}/); p = mm ? JSON.parse(mm[0]) : null; }
      const a = (p && p.alimento) || null;
      const out = {};
      if (a) {
        if (a.descricao) out.descricao = String(a.descricao).slice(0, 200);
        const cal = parseInt(a.calorias); if (!isNaN(cal) && cal > 0 && cal < 10000) out.calorias = cal;
        const pg = parseInt(a.peso_g); if (!isNaN(pg) && pg > 0 && pg < 5000) out.peso_g = pg;
      }
      return new Response(JSON.stringify({ alimento: Object.keys(out).length ? out : null }), { headers: corsHeaders });
    }

    // Caminho especial: DIÁRIO LIVRE — o usuário conta o dia em texto e a IA estrutura
    if (body.modo === 'diario') {
      if (!env.ANTHROPIC_API_KEY) {
        return new Response(JSON.stringify({ error: 'Servidor não configurado' }), { status: 500, headers: corsHeaders });
      }
      const textoD = (body.texto || '').slice(0, 1200);
      const hoje = body.hoje || new Date().toISOString().slice(0, 10);
      if (!textoD) return new Response(JSON.stringify({ error: 'Texto vazio' }), { status: 400, headers: corsHeaders });
      const promptDiario = `Hoje é ${hoje}. Um usuário de app de saúde contou em texto livre o que fez/comeu. Estruture os dados.

TEXTO DO USUÁRIO: "${textoD}"

Extraia (use null/[] quando não houver; NUNCA invente):
1. exercicios: cada atividade citada → {"tipo":"caminhada|corrida|bicicleta|musculacao|natacao|funcional|yoga|esporte|outro","duracao_min":num ou null,"intensidade":"leve|moderada|intensa","data":"YYYY-MM-DD"} — converta "ontem", "sábado", "fim de semana" usando a data de hoje; sem data explícita = hoje.
2. refeicoes: cada refeição/comida citada → {"tipo":"cafe|almoco|jantar|lanche","descricao":"...","calorias":estimativa realista,"data":"YYYY-MM-DD"}
3. eventos: contexto relevante para saúde (viagem, estresse, festa, comeu mal, dormiu pouco, doença) → {"descricao":"frase curta em 3ª pessoa","data":"YYYY-MM-DD ou null"}
4. resposta: UMA resposta curta (máx 2 frases), acolhedora e direta, em pt-BR, como um coach — reconheça o que foi feito sem julgar excessos.

Responda APENAS com JSON puro, sem markdown:
{"resposta":"...","exercicios":[],"refeicoes":[],"eventos":[]}`;
      const r2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, messages: [{ role: 'user', content: promptDiario }] })
      });
      if (!r2.ok) {
        const e = await r2.text();
        return new Response(JSON.stringify({ error: `IA (${r2.status})`, detail: e.slice(0, 150) }), { status: r2.status, headers: corsHeaders });
      }
      const rd2 = await r2.json();
      const raw2 = (rd2.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
      let p2; try { p2 = JSON.parse(raw2); } catch { const mm = raw2.match(/\{[\s\S]*\}/); p2 = mm ? JSON.parse(mm[0]) : null; }
      if (!p2) return new Response(JSON.stringify({ error: 'Não consegui interpretar' }), { status: 502, headers: corsHeaders });
      const tiposEx = ['caminhada', 'corrida', 'bicicleta', 'musculacao', 'natacao', 'funcional', 'yoga', 'esporte', 'outro'];
      const diario = {
        resposta: String(p2.resposta || 'Anotado!').slice(0, 300),
        exercicios: (Array.isArray(p2.exercicios) ? p2.exercicios : []).filter(e => e && tiposEx.includes(e.tipo)).slice(0, 6)
          .map(e => ({ tipo: e.tipo, duracao_min: (e.duracao_min > 0 && e.duracao_min <= 600) ? Math.round(e.duracao_min) : null, intensidade: ['leve', 'moderada', 'intensa'].includes(e.intensidade) ? e.intensidade : 'moderada', data: /^\d{4}-\d{2}-\d{2}$/.test(e.data || '') ? e.data : hoje })),
        refeicoes: (Array.isArray(p2.refeicoes) ? p2.refeicoes : []).filter(r => r && r.descricao).slice(0, 8)
          .map(r => ({ tipo: ['cafe', 'almoco', 'jantar', 'lanche'].includes(r.tipo) ? r.tipo : 'lanche', descricao: String(r.descricao).slice(0, 200), calorias: (r.calorias > 0 && r.calorias < 8000) ? Math.round(r.calorias) : null, data: /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data : hoje })),
        eventos: (Array.isArray(p2.eventos) ? p2.eventos : []).filter(e => e && e.descricao).slice(0, 4)
          .map(e => ({ descricao: String(e.descricao).slice(0, 240), data: /^\d{4}-\d{2}-\d{2}$/.test(e.data || '') ? e.data : null }))
      };
      return new Response(JSON.stringify({ diario }), { headers: corsHeaders });
    }

    if (!body.image) {
      return new Response(JSON.stringify({ error: 'Payload inválido — esperado { image, mime }' }), {
        status: 400, headers: corsHeaders
      });
    }
    const { image, mime, modo } = body;
    const mediaType = mime || 'image/jpeg';
    const isBio = modo === 'bioimpedancia';
    const isFood = modo === 'alimento';
    const isExerc = modo === 'exercicio';
    const isAuto = modo === 'auto';
    const pesoG = body.peso_g || null;

    // 3) Tamanho máximo (~10 MB de base64 ≈ 7.5 MB de imagem)
    if (image.length > 14 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Imagem muito grande (máx 10MB)' }), {
        status: 413, headers: corsHeaders
      });
    }

    // 4) Verifica que ANTHROPIC_API_KEY está configurada
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Servidor não configurado (ANTHROPIC_API_KEY ausente)' }), {
        status: 500, headers: corsHeaders
      });
    }

    // 5) Prompt conforme o modo
    const promptPeso = `Esta imagem é um screenshot de um app de saúde (Apple Health, Samsung Health, Google Fit, balança smart, etc.) contendo histórico de peso corporal.

Sua tarefa:
1. Identifique TODOS os registros de peso visíveis na imagem
2. Para cada registro extraia: data (YYYY-MM-DD) e peso em kg (decimal)
3. Se data estiver no formato "ontem", "hoje", "há 2 dias", converta usando a data atual como referência
4. Se o peso estiver em libras (lbs), converta para kg (1 lb = 0.453592 kg)

Responda APENAS com JSON puro, sem markdown, sem explicações, no formato exato:
{"registros":[{"date":"YYYY-MM-DD","peso":123.4}]}

Se a imagem NÃO contém dados de peso, responda:
{"registros":[]}

Se a imagem for ilegível ou irrelevante:
{"registros":[],"erro":"motivo curto"}`;

    const promptBio = `Esta imagem é um exame de bioimpedância. Pode ser de uma balança InBody (relatório profissional, fundo branco/cinza, marca "InBody"), de uma balança Xiaomi/Mi (app azul claro, "Relatório de peso"), ou de outra balança smart.

REGRA CRÍTICA: extraia SOMENTE valores que aparecem EXPLICITAMENTE na imagem. NUNCA invente, estime ou calcule valores ausentes. Se um campo não aparece, use null.

Aparelhos usam nomes diferentes para a mesma coisa — mapeie todos para os campos abaixo:
- peso: "Peso" / peso corporal (kg)
- gordura_pct: "PGC" / "Porcentagem de gordura corporal" / "% gordura" (%)
- massa_gordura: "Massa de Gordura" / "Massa gorda" (kg)
- massa_muscular: "Massa Muscular Esquelética" / "Massa de músculo esquelético" / "Massa muscular" (kg) — prefira a ESQUELÉTICA quando houver as duas
- agua_corporal: "Água Corporal Total" / "Massa de água corporal" / "Água corporal" (L ou kg)
- gordura_visceral: "Nível de Gordura Visceral" / "Classificação de gordura visceral" (número)
- tmb: "Taxa Metabólica Basal" / "TMB" (kcal)
- imc: "IMC" / "Índice de Massa Corporal"

Também identifique a FONTE do aparelho:
- "inbody" se vir a marca InBody
- "xiaomi" se for app Xiaomi/Mi (tela azul clara, "Relatório de peso", "Pontuação corporal")
- "outro" se não conseguir identificar

NÃO extraia circunferências (cintura/quadril) — bioimpedância não mede isso com fita.

Responda APENAS com JSON puro, sem markdown:
{"medidas":{"peso":null,"gordura_pct":null,"massa_gordura":null,"massa_muscular":null,"agua_corporal":null,"gordura_visceral":null,"tmb":null,"imc":null,"fonte":"inbody|xiaomi|outro"}}`;

    const promptFood = `Esta imagem é uma foto de um prato de comida / refeição.

Estime as calorias totais do prato. ${pesoG ? `O usuário informou que o prato pesa aproximadamente ${pesoG}g — use isso para calibrar a estimativa.` : 'Estime também o peso aproximado em gramas.'}

Identifique os alimentos visíveis e dê uma descrição curta (ex: "Arroz, feijão, frango grelhado e salada").

Responda APENAS com JSON puro, sem markdown:
{"alimento":{"descricao":"...","calorias":0,"peso_g":0}}

A estimativa de calorias é aproximada — seja realista, não otimista. Se não for comida, responda {"alimento":null}.`;

    const promptExerc = `Esta imagem é um print de um app de exercício (Apple Saúde, Strava, Google Fit, Nike Run, etc.) mostrando um treino/atividade.

Extraia o que estiver visível. NÃO invente — use null para o que não aparecer.
- tipo: classifique em UM destes: caminhada, corrida, bicicleta, musculacao, natacao, funcional, yoga, esporte, outro
- duracao_min: duração em minutos (converta se estiver em h:min)
- calorias: calorias gastas (kcal), se mostrado
- intensidade: leve, moderada ou intensa (estime pela atividade se não explícito)

Responda APENAS com JSON puro, sem markdown:
{"exercicio":{"tipo":null,"duracao_min":null,"calorias":null,"intensidade":null}}

Se não for um app de exercício, responda {"exercicio":null}.`;

    // Modo AUTO — classifica a imagem e extrai conforme a categoria detectada
    const notaUser = (body.nota || '').slice(0, 300);
    const hojeAuto = body.hoje || new Date().toISOString().slice(0, 10);
    const promptAuto = `Você receberá uma imagem enviada por um usuário de app de saúde. Hoje é ${hojeAuto}. Primeiro CLASSIFIQUE o que ela é, depois EXTRAIA os dados daquela categoria.
${notaUser ? `\nOBSERVAÇÃO DO USUÁRIO (use para calibrar porção, quantidade ou data — tem prioridade sobre sua estimativa visual): "${notaUser}"\n` : ''}

CATEGORIAS possíveis:
- "exercicio": print de app de treino (Strava, Apple Saúde, Garmin, Nike etc.)
- "alimento": foto de comida/prato/refeição
- "composicao": relatório de bioimpedância (InBody, balança Xiaomi/Mi, similar)
- "peso": screenshot de histórico/registro de peso corporal
- "exame_lab": foto ou print de exame de sangue/laudo laboratorial
- "desconhecido": nada acima

REGRA CRÍTICA: extraia SOMENTE o que aparece EXPLICITAMENTE. NUNCA invente valores. Campos ausentes = null.

Extração por categoria:
- exercicio: {"tipo":"caminhada|corrida|bicicleta|musculacao|natacao|funcional|yoga|esporte|outro","duracao_min":null,"calorias":null,"distancia_km":null,"intensidade":"leve|moderada|intensa"}
- alimento: {"descricao":"...","calorias":0,"peso_g":0} (estimativa realista)
- composicao: {"peso":null,"gordura_pct":null,"massa_gordura":null,"massa_muscular":null,"agua_corporal":null,"gordura_visceral":null,"tmb":null,"imc":null,"fonte":"inbody|xiaomi|outro"}
- peso: {"registros":[{"date":"YYYY-MM-DD","peso":123.4}]} (converta lbs→kg; "ontem/hoje" pela data atual)
- exame_lab: {"data_coleta":"YYYY-MM-DD ou null","itens":[{"nome":"nome do marcador como aparece","valor":0,"unidade":"..."}]} — extraia até 25 marcadores numéricos visíveis

Responda APENAS com JSON puro, sem markdown:
{"categoria":"...","exercicio":null,"alimento":null,"composicao":null,"peso":null,"exame_lab":null}
Preencha SOMENTE o campo da categoria detectada; os demais ficam null.`;

    // 6) Monta requisição para Claude API
    const claudePayload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: isAuto ? promptAuto : (isBio ? promptBio : (isFood ? promptFood : (isExerc ? promptExerc : promptPeso))) }
        ]
      }]
    };

    // 7) Chama Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudePayload)
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('[OCR] Claude API erro:', claudeRes.status, errText);
      return new Response(JSON.stringify({
        error: `Erro da IA (${claudeRes.status})`,
        detail: errText.slice(0, 200)
      }), { status: claudeRes.status, headers: corsHeaders });
    }

    const claudeData = await claudeRes.json();
    const rawText = (claudeData.content || []).map(c => c.text || '').join('');

    // 8) Limpa markdown se houver e parseia JSON
    const clean = rawText.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      // tenta achar o primeiro {...}
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; } }
      if (!parsed) {
        return new Response(JSON.stringify({
          error: 'Resposta da IA não pôde ser interpretada',
          raw: clean.slice(0, 300)
        }), { status: 502, headers: corsHeaders });
      }
    }

    // 9) Validação conforme o modo
    if (isAuto) {
      const cats = ['exercicio', 'alimento', 'composicao', 'peso', 'exame_lab', 'desconhecido'];
      const cat = cats.includes(parsed.categoria) ? parsed.categoria : 'desconhecido';
      // Sanitiza exames: só itens com nome e valor numérico
      let exameLab = null;
      if (cat === 'exame_lab' && parsed.exame_lab && Array.isArray(parsed.exame_lab.itens)) {
        exameLab = {
          data_coleta: parsed.exame_lab.data_coleta || null,
          itens: parsed.exame_lab.itens
            .filter(i => i && i.nome && typeof i.valor === 'number' && isFinite(i.valor))
            .slice(0, 25)
        };
      }
      return new Response(JSON.stringify({
        auto: {
          categoria: cat,
          exercicio: cat === 'exercicio' ? (parsed.exercicio || null) : null,
          alimento: cat === 'alimento' ? (parsed.alimento || null) : null,
          composicao: cat === 'composicao' ? (parsed.composicao || null) : null,
          peso: cat === 'peso' ? (parsed.peso || null) : null,
          exame_lab: exameLab
        }
      }), { status: 200, headers: corsHeaders });
    }
    if (isBio) {
      const m = parsed.medidas || parsed || {};
      const limpa = {};
      // Faixas sãs por campo — descarta lixo/alucinação
      const faixas = {
        peso: [20, 500], gordura_pct: [1, 70], massa_gordura: [1, 300],
        massa_muscular: [5, 150], agua_corporal: [10, 100],
        gordura_visceral: [1, 60], tmb: [500, 6000], imc: [8, 90]
      };
      Object.keys(faixas).forEach(k => {
        const v = parseFloat(m[k]);
        if (!isNaN(v) && v >= faixas[k][0] && v <= faixas[k][1]) {
          limpa[k] = k === 'tmb' ? Math.round(v) : v;
        }
      });
      // Repassa a fonte detectada (inbody/xiaomi/outro) — validada contra lista
      if (['inbody', 'xiaomi', 'outro'].includes(m.fonte)) limpa.fonte = m.fonte;
      return new Response(JSON.stringify({ medidas: limpa }), { headers: corsHeaders });
    }

    if (isFood) {
      const a = parsed.alimento || parsed || {};
      const out = {};
      if (a.descricao && typeof a.descricao === 'string') out.descricao = a.descricao.slice(0, 200);
      const cal = parseInt(a.calorias);
      if (!isNaN(cal) && cal > 0 && cal < 10000) out.calorias = cal;
      const pg = parseInt(a.peso_g);
      if (!isNaN(pg) && pg > 0 && pg < 5000) out.peso_g = pg;
      return new Response(JSON.stringify({ alimento: Object.keys(out).length ? out : null }), { headers: corsHeaders });
    }

    if (isExerc) {
      const e = parsed.exercicio || parsed || {};
      const out = {};
      const tiposOk = ['caminhada', 'corrida', 'bicicleta', 'musculacao', 'natacao', 'funcional', 'yoga', 'esporte', 'outro'];
      if (tiposOk.includes(e.tipo)) out.tipo = e.tipo;
      const dur = parseInt(e.duracao_min);
      if (!isNaN(dur) && dur > 0 && dur <= 600) out.duracao_min = dur;
      const cal = parseInt(e.calorias);
      if (!isNaN(cal) && cal > 0 && cal < 10000) out.calorias = cal;
      if (['leve', 'moderada', 'intensa'].includes(e.intensidade)) out.intensidade = e.intensidade;
      return new Response(JSON.stringify({ exercicio: Object.keys(out).length ? out : null }), { headers: corsHeaders });
    }

    // modo peso (padrão) — preserva tua validação original
    if (!parsed.registros || !Array.isArray(parsed.registros)) {
      parsed.registros = [];
    }
    parsed.registros = parsed.registros.filter(r =>
      r && typeof r.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      typeof r.peso === 'number' &&
      r.peso > 20 && r.peso < 500
    );

    return new Response(JSON.stringify(parsed), { headers: corsHeaders });

  } catch (e) {
    console.error('[OCR] erro inesperado:', e);
    return new Response(JSON.stringify({ error: 'Erro interno: ' + e.message }), {
      status: 500, headers: corsHeaders
    });
  }
}

// CORS preflight
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
