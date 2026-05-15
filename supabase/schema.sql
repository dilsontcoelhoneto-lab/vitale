-- =====================================================
-- VITALE v4 — SCHEMA SUPABASE
-- Execute este arquivo COMPLETO no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > Cole tudo > Run)
-- =====================================================

-- =====================================================
-- 1) TABELA: profiles (perfil estendido do usuário)
-- =====================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  altura numeric(3,2) default 1.70 check (altura > 1 and altura < 2.5),
  meta_imc numeric(4,1) default 25.0 check (meta_imc >= 18.5 and meta_imc <= 30),
  role text default 'user' check (role in ('user','admin')),
  status text default 'active' check (status in ('active','suspended','beta')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger: criar profile automaticamente quando usuário se registra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================
-- 2) TABELA: weights (registros de peso)
-- =====================================================
create table if not exists public.weights (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  peso numeric(5,2) not null check (peso > 0 and peso < 500),
  origem text default 'manual' check (origem in ('manual','texto','ocr','import')),
  created_at timestamptz default now(),
  unique(user_id, data)
);

create index if not exists weights_user_data_idx on public.weights(user_id, data desc);

-- =====================================================
-- 3) TABELA: medicacoes (agendamentos)
-- =====================================================
create table if not exists public.medicacoes (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  dose text not null,
  frequencia text not null check (frequencia in ('diario','semanal','especifico')),
  detalhes jsonb not null default '{}'::jsonb,
  ativo boolean default true,
  created_at timestamptz default now()
);

create index if not exists meds_user_idx on public.medicacoes(user_id, ativo);

-- =====================================================
-- 4) TABELA: submetas (marcos personalizados)
-- =====================================================
create table if not exists public.submetas (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  peso_alvo numeric(5,2) not null check (peso_alvo > 0),
  data_alvo date,
  icone text default '🎯',
  atingida boolean default false,
  created_at timestamptz default now()
);

create index if not exists submetas_user_idx on public.submetas(user_id);

-- =====================================================
-- 5) TABELA: feature_flags (Torre de Comando)
-- =====================================================
create table if not exists public.feature_flags (
  id bigserial primary key,
  flag_key text unique not null,
  flag_name text not null,
  descricao text,
  enabled boolean default false,
  fase integer default 1,
  rollout_pct integer default 0 check (rollout_pct >= 0 and rollout_pct <= 100),
  updated_at timestamptz default now()
);

-- Insere flags padrão (todas as fases)
insert into public.feature_flags (flag_key, flag_name, descricao, enabled, fase) values
  ('dashboard',       'Dashboard',              'IMC, peso atual, gráfico, coach',     true,  1),
  ('importar_manual', 'Importar Manual',        'Adicionar peso por data',             true,  1),
  ('importar_texto',  'Importar Texto',         'Colar múltiplas linhas',              true,  2),
  ('historico',       'Histórico Completo',     'Tabela completa de pesos',            true,  2),
  ('marcos_imc',      'Marcos IMC',             'Marcos automáticos por IMC',          true,  2),
  ('coach_ia',        'Coach IA',               'Mensagem personalizada do coach',     false, 3),
  ('ocr_imagem',      'OCR de Imagem',          'Upload screenshot processado pela IA',false, 3),
  ('medicacoes',      'Medicações',             'Agendamento de medicamentos',         false, 4),
  ('submetas',        'Submetas Personalizadas','Marcos com data e ícone',             false, 4),
  ('relatorio_pdf',   'Relatório PDF',          'Geração de PDF para médico',          false, 5),
  ('backup_json',     'Backup JSON',            'Exportar/importar dados em JSON',     false, 5),
  ('apple_health',    'Apple Health',           'Integração HealthKit (iOS)',          false, 6)
on conflict (flag_key) do nothing;

-- =====================================================
-- 6) TABELA: error_logs (logs centralizados)
-- =====================================================
create table if not exists public.error_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  contexto text,
  mensagem text not null,
  stack text,
  user_agent text,
  url text,
  created_at timestamptz default now()
);

create index if not exists errors_recent_idx on public.error_logs(created_at desc);

-- =====================================================
-- 7) TABELA: usage_analytics (estatísticas de uso)
-- =====================================================
create table if not exists public.usage_analytics (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  acao text not null,
  detalhes jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists usage_user_idx on public.usage_analytics(user_id, created_at desc);
create index if not exists usage_acao_idx on public.usage_analytics(acao, created_at desc);

-- =====================================================
-- 8) RLS POLICIES — Cada usuário só vê os próprios dados
-- =====================================================
alter table public.profiles enable row level security;
alter table public.weights enable row level security;
alter table public.medicacoes enable row level security;
alter table public.submetas enable row level security;
alter table public.feature_flags enable row level security;
alter table public.error_logs enable row level security;
alter table public.usage_analytics enable row level security;

-- Profiles: usuário lê/edita o próprio, admin vê todos
drop policy if exists "users_read_own_profile" on public.profiles;
create policy "users_read_own_profile" on public.profiles
  for select using (auth.uid() = id or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "admin_update_any_profile" on public.profiles;
create policy "admin_update_any_profile" on public.profiles
  for update using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Weights: CRUD próprio + admin lê todos
drop policy if exists "users_crud_own_weights" on public.weights;
create policy "users_crud_own_weights" on public.weights
  for all using (auth.uid() = user_id);

drop policy if exists "admin_read_all_weights" on public.weights;
create policy "admin_read_all_weights" on public.weights
  for select using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Medicações
drop policy if exists "users_crud_own_meds" on public.medicacoes;
create policy "users_crud_own_meds" on public.medicacoes
  for all using (auth.uid() = user_id);

-- Submetas
drop policy if exists "users_crud_own_submetas" on public.submetas;
create policy "users_crud_own_submetas" on public.submetas
  for all using (auth.uid() = user_id);

-- Feature flags: TODOS leem (frontend precisa), apenas admin edita
drop policy if exists "everyone_reads_flags" on public.feature_flags;
create policy "everyone_reads_flags" on public.feature_flags
  for select using (true);

drop policy if exists "admin_updates_flags" on public.feature_flags;
create policy "admin_updates_flags" on public.feature_flags
  for update using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

drop policy if exists "admin_inserts_flags" on public.feature_flags;
create policy "admin_inserts_flags" on public.feature_flags
  for insert with check (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Error logs: qualquer um insere (do frontend), apenas admin lê
drop policy if exists "anyone_logs_errors" on public.error_logs;
create policy "anyone_logs_errors" on public.error_logs
  for insert with check (true);

drop policy if exists "admin_reads_errors" on public.error_logs;
create policy "admin_reads_errors" on public.error_logs
  for select using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Usage analytics: usuário insere, admin lê
drop policy if exists "users_log_usage" on public.usage_analytics;
create policy "users_log_usage" on public.usage_analytics
  for insert with check (auth.uid() = user_id);

drop policy if exists "admin_reads_analytics" on public.usage_analytics;
create policy "admin_reads_analytics" on public.usage_analytics
  for select using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- =====================================================
-- 9) VIEWS para admin (estatísticas agregadas)
-- =====================================================
create or replace view public.admin_user_stats as
select
  p.id,
  p.email,
  p.nome,
  p.altura,
  p.role,
  p.status,
  p.created_at as cadastrado_em,
  count(distinct w.id) as total_pesos,
  count(distinct m.id) as total_medicacoes,
  count(distinct s.id) as total_submetas,
  (select peso from public.weights where user_id = p.id order by data desc limit 1) as peso_atual,
  (select peso from public.weights where user_id = p.id order by data asc limit 1) as peso_inicial,
  (select max(created_at) from public.usage_analytics where user_id = p.id) as ultimo_acesso
from public.profiles p
left join public.weights w on w.user_id = p.id
left join public.medicacoes m on m.user_id = p.id
left join public.submetas s on s.user_id = p.id
group by p.id, p.email, p.nome, p.altura, p.role, p.status, p.created_at;

-- =====================================================
-- 10) FUNÇÃO: promover usuário a admin (rode manualmente)
-- =====================================================
-- Para promover você a admin, rode no SQL Editor:
-- update public.profiles set role = 'admin' where email = 'seu.email@gmail.com';

-- =====================================================
-- FIM DO SCHEMA — Tudo configurado!
-- =====================================================
