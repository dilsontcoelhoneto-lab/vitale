// =====================================================
// VITALE — Envio de e-mail transacional
// Cloudflare Pages Function (runtime Workers)
// Endpoint: POST /api/email
// =====================================================
// Fecha a pendência do P1b: avisar o usuário quando a conta dele é
// acessada de um aparelho novo.
//
// DECISÃO DE SEGURANÇA IMPORTANTE
// Um endpoint de envio de e-mail exposto na internet é, por padrão,
// um relay aberto: qualquer um dispara mensagem em nome do seu domínio,
// sua reputação de envio vai para o lixo e seus e-mails legítimos passam
// a cair em spam. Para evitar isso, aqui:
//
//   1. Exige o access token do Supabase no header Authorization.
//   2. Valida o token contra o próprio Supabase (GET /auth/v1/user).
//   3. Envia SOMENTE para o e-mail do usuário autenticado —
//      o destinatário nunca vem do corpo da requisição.
//   4. Só aceita tipos de mensagem de uma lista fechada.
//
// Ou seja: quem chama só consegue mandar e-mail para si mesmo, com um
// dos textos previstos. Não dá para usar como disparador de spam.

const TIPOS = {
  dispositivo_novo: {
    assunto: 'Novo acesso à sua conta VITALE',
    corpo: (d) => ({
      titulo: 'Acesso de um aparelho novo',
      linhas: [
        `Sua conta VITALE foi acessada a partir de <strong>${esc(d.rotulo || 'um aparelho desconhecido')}</strong>.`,
        `Data: <strong>${esc(d.quando || new Date().toLocaleString('pt-BR'))}</strong>.`,
        'Se foi você, não precisa fazer nada.',
        'Se não foi, troque sua senha agora e use "Encerrar todas as sessões" em Configurações → Segurança.'
      ],
      acao: { texto: 'Abrir minha conta', url: 'https://vitale.acacianegocios.com.br/app.html' }
    })
  }
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Template HTML sóbrio: sem imagem externa, sem rastreador, sem emoji.
// E-mail de segurança que parece marketing é ignorado.
function montarHtml({ titulo, linhas, acao }) {
  return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#F4F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E8;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFEFB;border:1px solid #E4DFD4;border-radius:14px">
        <tr><td style="padding:26px 28px 0">
          <p style="margin:0;font-size:12px;letter-spacing:2.5px;color:#8A8578;text-transform:uppercase">VITALE</p>
          <h1 style="margin:10px 0 0;font-size:21px;line-height:1.3;color:#1C1B18;font-weight:600">${esc(titulo)}</h1>
        </td></tr>
        <tr><td style="padding:16px 28px 0">
          ${linhas.map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#3A3833">${l}</p>`).join('')}
        </td></tr>
        ${acao ? `<tr><td style="padding:10px 28px 4px">
          <a href="${esc(acao.url)}" style="display:inline-block;background:#C79A35;color:#1C1B18;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px">${esc(acao.texto)}</a>
        </td></tr>` : ''}
        <tr><td style="padding:22px 28px 26px">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8578;border-top:1px solid #E4DFD4;padding-top:16px">
            Você recebeu este aviso porque ele é essencial à segurança da sua conta —
            não é comunicação de marketing e não pode ser desativado.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.RESEND_API_KEY) {
      // Falha silenciosa e explícita: o app não deve quebrar por causa
      // de um aviso de e-mail não configurado.
      return new Response(JSON.stringify({ ok: false, motivo: 'email_nao_configurado' }),
        { status: 200, headers: cors });
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'nao_autenticado' }), { status: 401, headers: cors });
    }

    // Valida o token no Supabase e descobre QUEM é o usuário.
    // O destinatário sai daqui — nunca do corpo da requisição.
    const rUser = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY }
    });
    if (!rUser.ok) {
      return new Response(JSON.stringify({ error: 'token_invalido' }), { status: 401, headers: cors });
    }
    const user = await rUser.json();
    const destino = user?.email;
    if (!destino) {
      return new Response(JSON.stringify({ error: 'usuario_sem_email' }), { status: 400, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const def = TIPOS[body.tipo];
    if (!def) {
      return new Response(JSON.stringify({ error: 'tipo_invalido' }), { status: 400, headers: cors });
    }

    const conteudo = def.corpo(body.dados || {});
    const rEnvio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE || 'VITALE <nao-responda@vitale.acacianegocios.com.br>',
        to: [destino],
        subject: def.assunto,
        html: montarHtml(conteudo)
      })
    });

    if (!rEnvio.ok) {
      const detalhe = await rEnvio.text();
      console.error('[EMAIL] Resend recusou:', rEnvio.status, detalhe);
      return new Response(JSON.stringify({ ok: false, motivo: 'falha_no_envio' }),
        { status: 200, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: cors });

  } catch (e) {
    console.error('[EMAIL] erro:', e);
    return new Response(JSON.stringify({ ok: false, motivo: 'erro_interno' }),
      { status: 200, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
}
