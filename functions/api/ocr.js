// =====================================================
// VITALE — Proxy OCR
// Cloudflare Pages Function (runtime Workers)
// Endpoint: POST /api/ocr
// =====================================================
// Recebe { image (base64), mime } do frontend autenticado,
// chama a Claude API server-side e devolve { registros: [...] }.
// A chave da API NUNCA sai do servidor.

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS para chamadas same-origin (Cloudflare Pages) — relaxa também para preview URLs
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
      // Tentamos validar via cookie do Supabase também (sessão persistida)
      // mas se nem token nem cookie, rejeita
      const cookieHeader = request.headers.get('Cookie') || '';
      if (!cookieHeader.includes('sb-')) {
        return new Response(JSON.stringify({ error: 'Não autenticado' }), {
          status: 401, headers: corsHeaders
        });
      }
    }

    // 2) Valida payload
    const body = await request.json().catch(() => null);
    if (!body || !body.image) {
      return new Response(JSON.stringify({ error: 'Payload inválido — esperado { image, mime }' }), {
        status: 400, headers: corsHeaders
      });
    }
    const { image, mime } = body;
    const mediaType = mime || 'image/jpeg';

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

    // 5) Monta requisição para Claude API
    const claudePayload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          {
            type: 'text',
            text: `Esta imagem é um screenshot de um app de saúde (Apple Health, Samsung Health, Google Fit, balança smart, etc.) contendo histórico de peso corporal.

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
{"registros":[],"erro":"motivo curto"}`
          }
        ]
      }]
    };

    // 6) Chama Claude
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

    // 7) Limpa markdown se houver e parseia JSON
    const clean = rawText.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'Resposta da IA não pôde ser interpretada',
        raw: clean.slice(0, 300)
      }), { status: 502, headers: corsHeaders });
    }

    // 8) Validação básica do resultado
    if (!parsed.registros || !Array.isArray(parsed.registros)) {
      parsed.registros = [];
    }
    // Filtra registros inválidos
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
