# VITALE v4 — Coach de Saúde Pessoal

Aplicação web multi-usuário para acompanhamento de jornada de saúde com IA, projeções e relatórios médicos.

## 🚀 Setup rápido

**Abra `docs/install.html` no navegador para o passo-a-passo completo e interativo.**

Esquema resumido:

1. Criar projeto no Supabase, rodar `supabase/schema.sql` no SQL Editor
2. Copiar `SUPABASE_URL` e `SUPABASE_ANON_KEY` do projeto
3. Substituir `COLE_SUA_URL_AQUI` e `COLE_SUA_ANON_KEY_AQUI` em `index.html`, `app.html` e `admin.html`
4. Subir no GitHub
5. Conectar Cloudflare Pages ao repositório
6. Adicionar variável de ambiente `ANTHROPIC_API_KEY` no Cloudflare Pages
7. Apontar subdomínio `vitale.acacianegocios.com.br` (CNAME)
8. Após primeiro signup, promover-se a admin via SQL:
   `update profiles set role='admin' where email='seu@email';`

## 📁 Estrutura

```
vitale/
├── index.html              Landing + login (entrada da app)
├── app.html                App principal (área logada)
├── admin.html              Torre de Comando (admin only)
├── _headers                Cloudflare security headers
├── _redirects              URLs limpas (/app, /admin)
├── assets/
│   ├── css/vitale.css      Design system Luxury Dark
│   └── js/
│       ├── supabase-client.js  Cliente DB + auth helpers
│       ├── feature-flags.js     Sistema de flags com rollout %
│       └── vitale-core.js       Lógica principal do app
├── functions/api/
│   ├── ocr.js              Proxy OCR via Claude (server-side)
│   └── chat.js             Proxy Coach IA
├── supabase/
│   └── schema.sql          DDL completo (tabelas + RLS + flags)
└── docs/
    └── install.html        Manual de instalação interativo
```

## 🎛️ Feature Flags

Todas as 12 funcionalidades existem no código mas só aparecem se a flag estiver `enabled = true` na Torre. Em produção comece com **Fase 1 + 2** (Dashboard, Importar, Histórico, Marcos) e vá liberando após validar bugs.

| Fase | Flag                  | Descrição                              |
| ---- | --------------------- | -------------------------------------- |
| 1    | dashboard             | IMC, peso atual, gráfico, coach (deterministico) |
| 1    | importar_manual       | Adicionar peso por data                |
| 2    | importar_texto        | Colar múltiplas linhas                 |
| 2    | historico             | Tabela completa                        |
| 2    | marcos_imc            | Marcos automáticos por IMC             |
| 3    | coach_ia              | Coach IA (chamada Claude API)          |
| 3    | ocr_imagem            | OCR de screenshot                      |
| 4    | medicacoes            | Agendamento de meds                    |
| 4    | submetas              | Marcos personalizados                  |
| 5    | relatorio_pdf         | PDF para médico                        |
| 5    | backup_json           | Export/import JSON                     |
| 6    | apple_health          | Integração HealthKit (futuro)          |

## ⚠️ Avisos honestos

- **Bugs são esperados** em multi-user. Use as flags para desligar features problemáticas sem derrubar o app.
- **Custo Claude API**: ~$2-5 por usuário ativo/mês com Haiku 4.5 no OCR + Sonnet 4.6 no coach. Monitore na Anthropic Console.
- **Free tier do Cloudflare Pages Functions**: 100.000 invocações/dia. Mais que suficiente para beta privado.
- **Free tier do Supabase**: 500 MB de dados + 50.000 usuários auth. Sem custo até ~200 usuários ativos.

## 📞 Suporte

Erros são logados automaticamente em `error_logs` e aparecem na aba **🐛 ERROS** da Torre.
