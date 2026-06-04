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

    if (!body.image) {
      return new Response(JSON.stringify({ error: 'Payload inválido — esperado { image, mime }' }), {
        status: 400, headers: corsHeaders
      });
    }
    const { image, mime, modo } = body;
    const mediaType = mime || 'image/jpeg';
    const isBio = modo === 'bioimpedancia';
    const isFood = modo === 'alimento';
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

    // 6) Monta requisição para Claude API
    const claudePayload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: isBio ? promptBio : (isFood ? promptFood : promptPeso) }
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
