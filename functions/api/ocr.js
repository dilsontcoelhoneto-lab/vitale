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
    if (!body || !body.image) {
      return new Response(JSON.stringify({ error: 'Payload inválido — esperado { image, mime }' }), {
        status: 400, headers: corsHeaders
      });
    }
    const { image, mime, modo } = body;
    const mediaType = mime || 'image/jpeg';
    const isBio = modo === 'bioimpedancia';
 
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
 
    const promptBio = `Esta imagem é a tela de uma balança de bioimpedância ou app de saúde com medidas corporais.
 
Sua tarefa: extraia as medidas visíveis. Circunferências em centímetros; gordura em %.
 
Responda APENAS com JSON puro, sem markdown, sem explicações, no formato exato:
{"medidas":{"peso":null,"gordura_pct":null,"cintura":null,"quadril":null,"abdomen":null,"peito":null,"braco":null,"coxa":null,"pescoco":null}}
 
Use null para o que não aparecer. Não invente valores. Se um valor estiver em libras converta para kg (1 lb = 0.453592 kg).`;
 
    // 6) Monta requisição para Claude API
    const claudePayload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: isBio ? promptBio : promptPeso }
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
      const campos = ['peso', 'gordura_pct', 'cintura', 'quadril', 'abdomen', 'peito', 'braco', 'coxa', 'pescoco'];
      campos.forEach(k => {
        const v = parseFloat(m[k]);
        // Faixas sanas pra evitar lixo: circunferências 10-250cm, gordura 1-70%, peso 20-500
        if (!isNaN(v) && v > 0) {
          if (k === 'gordura_pct' && v <= 70) limpa[k] = v;
          else if (k === 'peso' && v >= 20 && v <= 500) limpa[k] = v;
          else if (k !== 'gordura_pct' && k !== 'peso' && v >= 10 && v <= 250) limpa[k] = v;
        }
      });
      return new Response(JSON.stringify({ medidas: limpa }), { headers: corsHeaders });
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
