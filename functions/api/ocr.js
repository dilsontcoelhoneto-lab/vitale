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
//
// v2 (2026-07-14):
//   - Bioimpedância agora extrai a DATA do relatório (com regra
//     explícita pro formato americano MM/DD/YYYY dos apps Xiaomi/EN)
//   - Modo AUTO passou a sanitizar composicao e peso (antes devolvia
//     o JSON da IA sem validação de faixas — risco de alucinação)

// ---- Helpers de sanitização (compartilhados entre modos) ----

// Faixas sãs por campo — descarta lixo/alucinação
const FAIXAS_COMPOSICAO = {
  peso: [20, 500], gordura_pct: [1, 70], massa_gordura: [1, 300],
  massa_muscular: [5, 150], agua_corporal: [10, 100],
  gordura_visceral: [1, 60], tmb: [500, 6000], imc: [8, 90]
};

// Valida "YYYY-MM-DD": data real, não-futura (tolerância 1 dia por fuso),
// não mais antiga que 3 anos. Devolve a string ou null.
function sanitizaData(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dt = new Date(d + 'T12:00:00Z');
  if (isNaN(dt.getTime())) return null;
  const agora = Date.now();
  if (dt.getTime() > agora + 86400000) return null;            // futura
  if (dt.getTime() < agora - 3 * 365 * 86400000) return null;  // > 3 anos
  return d;
}

// Sanitiza o objeto de composição corporal vindo da IA
function sanitizaComposicao(m) {
  if (!m || typeof m !== 'object') return null;
  const limpa = {};
  Object.keys(FAIXAS_COMPOSICAO).forEach(k => {
    const v = parseFloat(m[k]);
    if (!isNaN(v) && v >= FAIXAS_COMPOSICAO[k][0] && v <= FAIXAS_COMPOSICAO[k][1]) {
      limpa[k] = k === 'tmb' ? Math.round(v) : v;
    }
  });
  if (['inbody', 'xiaomi', 'outro'].includes(m.fonte)) limpa.fonte = m.fonte;
  const dataOk = sanitizaData(m.data);
  if (dataOk) limpa.data = dataOk;
  return Object.keys(limpa).length ? limpa : null;
}

// Sanitiza registros de peso vindos da IA
function sanitizaRegistrosPeso(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(r =>
    r && typeof r.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    typeof r.peso === 'number' &&
    r.peso > 20 && r.peso < 500
  ).slice(0, 60);
}

// Instrução de data compartilhada (bioimpedância). Ponto crítico: apps em
// inglês usam MM/DD/YYYY — "07/06/2026" no Mi Fitness EN é 6 de julho, não
// 7 de junho. Datas ambíguas (dia ≤ 12) só se resolvem pelo idioma da UI.
const INSTRUCAO_DATA_BIO = `- data: data do relatório/pesagem se estiver visível na imagem (ex: perto do nome do usuário ou no topo). ATENÇÃO CRÍTICA: apps em inglês (Xiaomi/Mi Fitness, Zepp, InBody EN) usam formato americano MM/DD/YYYY — "07/14/2026 07:24" significa 14 de julho de 2026. Apps em português usam DD/MM/YYYY. Decida pelo idioma da interface na imagem. Converta SEMPRE para "YYYY-MM-DD". Se não houver data visível, use null — NUNCA chute.`;

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
2. refeicoes: cada refeição/comida citada → {"tipo":"cafe|almoco|jantar|lanche","descricao":"...","calorias":estimativa realista,"proteina_g":estimativa de proteína em gramas,"data":"YYYY-MM-DD"}
3. pesos: cada pesagem citada ("pesei 90", "tô com 88,4 hoje") → {"peso":num em kg,"data":"YYYY-MM-DD"} — só se o número for claramente um peso corporal (30 a 400 kg).
4. doses: cada dose de medicação GLP-1 citada ("tomei a dose de 7,5", "apliquei mounjaro 5mg") → {"medicamento":"nome ou null","dose":"texto ex 7,5 mg","data":"YYYY-MM-DD"}.
5. eventos: contexto relevante para saúde (viagem, estresse, festa, comeu mal, dormiu pouco, doença, efeito colateral) → {"descricao":"frase curta em 3ª pessoa","data":"YYYY-MM-DD ou null"}
6. resposta: UMA resposta curta (máx 2 frases), acolhedora e direta, em pt-BR, como um coach — reconheça o que foi feito sem julgar excessos.

Responda APENAS com JSON puro, sem markdown:
{"resposta":"...","exercicios":[],"refeicoes":[],"pesos":[],"doses":[],"eventos":[]}`;
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
          .map(r => ({ tipo: ['cafe', 'almoco', 'jantar', 'lanche'].includes(r.tipo) ? r.tipo : 'lanche', descricao: String(r.descricao).slice(0, 200), calorias: (r.calorias > 0 && r.calorias < 8000) ? Math.round(r.calorias) : null, proteina_g: (r.proteina_g > 0 && r.proteina_g < 400) ? Math.round(r.proteina_g) : null, data: /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data : hoje })),
        pesos: (Array.isArray(p2.pesos) ? p2.pesos : []).filter(w => w && w.peso > 30 && w.peso < 400).slice(0, 4)
          .map(w => ({ peso: Math.round(parseFloat(w.peso) * 10) / 10, data: /^\d{4}-\d{2}-\d{2}$/.test(w.data || '') ? w.data : hoje })),
        doses: (Array.isArray(p2.doses) ? p2.doses : []).filter(d => d && (d.dose || d.medicamento)).slice(0, 3)
          .map(d => ({ medicamento: d.medicamento ? String(d.medicamento).slice(0, 60) : null, dose: d.dose ? String(d.dose).slice(0, 40) : null, data: /^\d{4}-\d{2}-\d{2}$/.test(d.data || '') ? d.data : hoje })),
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
    const hojeRef = body.hoje || new Date().toISOString().slice(0, 10);

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
3. Se data estiver no formato "ontem", "hoje", "há 2 dias", converta usando a data atual como referência (hoje é ${hojeRef})
4. Se o peso estiver em libras (lbs), converta para kg (1 lb = 0.453592 kg)
5. ATENÇÃO a datas numéricas: apps em INGLÊS usam MM/DD/YYYY (americano); apps em PORTUGUÊS usam DD/MM/YYYY. Decida pelo idioma da interface.

Responda APENAS com JSON puro, sem markdown, sem explicações, no formato exato:
{"registros":[{"date":"YYYY-MM-DD","peso":123.4}]}

Se a imagem NÃO contém dados de peso, responda:
{"registros":[]}

Se a imagem for ilegível ou irrelevante:
{"registros":[],"erro":"motivo curto"}`;

    const promptBio = `Esta imagem é um exame de bioimpedância. Pode ser de uma balança InBody (relatório profissional, fundo branco/cinza, marca "InBody"), de uma balança Xiaomi/Mi (app azul claro, "Relatório de peso" / "Weight report"), ou de outra balança smart. Hoje é ${hojeRef}.

REGRA CRÍTICA: extraia SOMENTE valores que aparecem EXPLICITAMENTE na imagem. NUNCA invente, estime ou calcule valores ausentes. Se um campo não aparece, use null.

Aparelhos usam nomes diferentes para a mesma coisa — mapeie todos para os campos abaixo:
- peso: "Peso" / "Weight" / peso corporal (kg)
- gordura_pct: "PGC" / "Porcentagem de gordura corporal" / "Body fat percentage" / "% gordura" (%)
- massa_gordura: "Massa de Gordura" / "Fat mass" / "Massa gorda" (kg)
- massa_muscular: "Massa Muscular Esquelética" / "Massa de músculo esquelético" / "Muscle mass" / "Massa muscular" (kg) — prefira a ESQUELÉTICA quando houver as duas
- agua_corporal: "Água Corporal Total" / "Body water mass" / "Água corporal" (L ou kg)
- gordura_visceral: "Nível de Gordura Visceral" / "Visceral fat" (número)
- tmb: "Taxa Metabólica Basal" / "TMB" / "BMR" (kcal)
- imc: "IMC" / "BMI" / "Índice de Massa Corporal"
${INSTRUCAO_DATA_BIO}

Também identifique a FONTE do aparelho:
- "inbody" se vir a marca InBody
- "xiaomi" se for app Xiaomi/Mi (tela azul clara, "Relatório de peso" / "Weight report", "Pontuação corporal" / "Body score")
- "outro" se não conseguir identificar

NÃO extraia circunferências (cintura/quadril) — bioimpedância não mede isso com fita.

Responda APENAS com JSON puro, sem markdown:
{"medidas":{"peso":null,"gordura_pct":null,"massa_gordura":null,"massa_muscular":null,"agua_corporal":null,"gordura_visceral":null,"tmb":null,"imc":null,"data":null,"fonte":"inbody|xiaomi|outro"}}`;

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
    const promptAuto = `Você receberá uma imagem enviada por um usuário de app de saúde. Hoje é ${hojeRef}. Primeiro CLASSIFIQUE o que ela é, depois EXTRAIA os dados daquela categoria.
${notaUser ? `\nOBSERVAÇÃO DO USUÁRIO (use para calibrar porção, quantidade ou data — tem prioridade sobre sua estimativa visual): "${notaUser}"\n` : ''}

CATEGORIAS possíveis:
- "exercicio": print de app de treino (Strava, Apple Saúde, Garmin, Nike etc.)
- "alimento": foto de comida/prato/refeição
- "composicao": relatório de bioimpedância (InBody, balança Xiaomi/Mi, similar)
- "peso": screenshot de histórico/registro de peso corporal
- "exame_lab": foto ou print de exame de sangue/laudo laboratorial
- "desconhecido": nada acima

REGRA CRÍTICA: extraia SOMENTE o que aparece EXPLICITAMENTE. NUNCA invente valores. Campos ausentes = null.

REGRA DE DATAS: apps em INGLÊS usam formato americano MM/DD/YYYY ("07/14/2026" = 14 de julho); apps em PORTUGUÊS usam DD/MM/YYYY. Decida pelo idioma da interface na imagem. Converta sempre para YYYY-MM-DD; sem data visível = null.

Extração por categoria:
- exercicio: {"tipo":"caminhada|corrida|bicicleta|musculacao|natacao|funcional|yoga|esporte|outro","duracao_min":null,"calorias":null,"distancia_km":null,"intensidade":"leve|moderada|intensa"}
- alimento: {"descricao":"...","calorias":0,"peso_g":0} (estimativa realista)
- composicao: {"peso":null,"gordura_pct":null,"massa_gordura":null,"massa_muscular":null,"agua_corporal":null,"gordura_visceral":null,"tmb":null,"imc":null,"data":null,"fonte":"inbody|xiaomi|outro"} — "data" é a data do relatório se visível (aplique a REGRA DE DATAS)
- peso: {"registros":[{"date":"YYYY-MM-DD","peso":123.4}]} (converta lbs→kg; "ontem/hoje" pela data atual)
- exame_lab: {"data_coleta":"YYYY-MM-DD ou null","itens":[{"nome":"nome do marcador como aparece","valor":0,"unidade":"..."}]} — extraia até 25 marcadores numéricos visíveis.
  DATA DO EXAME (importante): procure por "Data da coleta", "Coletado em", "Coleta:", "Data do exame", "Atendimento em". PREFIRA sempre a data de COLETA sobre a de emissão/impressão/liberação do laudo. Laudos brasileiros usam DD/MM/AAAA. Se houver várias datas, use a da coleta do material. Se realmente não houver data visível, retorne null — NÃO invente e NÃO use a data de hoje.

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
          data_coleta: sanitizaData(parsed.exame_lab.data_coleta),
          itens: parsed.exame_lab.itens
            .filter(i => i && i.nome && typeof i.valor === 'number' && isFinite(i.valor))
            .slice(0, 25)
        };
      }
      // Sanitiza composicao e peso — ANTES saíam crus da IA (v2)
      let pesoAuto = null;
      if (cat === 'peso' && parsed.peso) {
        const regs = sanitizaRegistrosPeso(parsed.peso.registros);
        pesoAuto = regs.length ? { registros: regs } : null;
      }
      return new Response(JSON.stringify({
        auto: {
          categoria: cat,
          exercicio: cat === 'exercicio' ? (parsed.exercicio || null) : null,
          alimento: cat === 'alimento' ? (parsed.alimento || null) : null,
          composicao: cat === 'composicao' ? sanitizaComposicao(parsed.composicao) : null,
          peso: pesoAuto,
          exame_lab: exameLab
        }
      }), { status: 200, headers: corsHeaders });
    }
    if (isBio) {
      const m = parsed.medidas || parsed || {};
      const limpa = sanitizaComposicao(m) || {};
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
    parsed.registros = sanitizaRegistrosPeso(parsed.registros);

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
