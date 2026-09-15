-- Execute todo este arquivo uma única vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  subscription_status text not null default 'free'
    check (subscription_status in ('free', 'active', 'canceled', 'past_due')),
  trial_used boolean not null default false,
  monthly_minutes_used numeric(10,2) not null default 0,
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '1 month'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  minutes numeric(10,2) not null,
  kind text not null check (kind in ('trial', 'subscription')),
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "Perfil próprio somente leitura" on public.profiles;
create policy "Perfil próprio somente leitura"
on public.profiles for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Uso próprio somente leitura" on public.usage_events;
create policy "Uso próprio somente leitura"
on public.usage_events for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.consume_clip_minutes(
  p_user_id uuid,
  p_source_key text,
  p_minutes numeric
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  existing public.usage_events%rowtype;
  rounded_minutes numeric(10,2);
begin
  if p_user_id is null or p_source_key is null or length(trim(p_source_key)) < 8 then
    return jsonb_build_object('allowed', false, 'message', 'Identificação do vídeo inválida.');
  end if;

  rounded_minutes := ceil(greatest(coalesce(p_minutes, 0), 0) * 100) / 100;
  if rounded_minutes <= 0 then
    return jsonb_build_object('allowed', false, 'message', 'Não foi possível identificar a duração do vídeo.');
  end if;

  select * into existing from public.usage_events
  where user_id = p_user_id and source_key = p_source_key;
  if found then
    return jsonb_build_object('allowed', true, 'already_counted', true, 'kind', existing.kind);
  end if;

  insert into public.profiles (user_id, email)
  select p_user_id, coalesce(email, '') from auth.users where id = p_user_id
  on conflict (user_id) do nothing;

  select * into p from public.profiles where user_id = p_user_id for update;

  if p.subscription_status = 'active' then
    if now() >= p.period_end then
      update public.profiles set
        monthly_minutes_used = 0,
        period_start = now(),
        period_end = now() + interval '1 month',
        updated_at = now()
      where user_id = p_user_id
      returning * into p;
    end if;

    if p.monthly_minutes_used + rounded_minutes > 200 then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'monthly_limit',
        'message', 'Seu limite mensal de 200 minutos foi atingido.',
        'remaining', greatest(200 - p.monthly_minutes_used, 0)
      );
    end if;

    update public.profiles set
      monthly_minutes_used = monthly_minutes_used + rounded_minutes,
      updated_at = now()
    where user_id = p_user_id returning * into p;

    insert into public.usage_events (user_id, source_key, minutes, kind)
    values (p_user_id, p_source_key, rounded_minutes, 'subscription');

    return jsonb_build_object(
      'allowed', true,
      'kind', 'subscription',
      'used', p.monthly_minutes_used,
      'remaining', greatest(200 - p.monthly_minutes_used, 0)
    );
  end if;

  if p.trial_used then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'trial_used',
      'message', 'Seu teste grátis já foi utilizado. Assine o plano para continuar.'
    );
  end if;

  if rounded_minutes > 20 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'trial_too_long',
      'message', 'O teste grátis aceita um vídeo de até 20 minutos.'
    );
  end if;

  update public.profiles set trial_used = true, updated_at = now()
  where user_id = p_user_id;

  insert into public.usage_events (user_id, source_key, minutes, kind)
  values (p_user_id, p_source_key, rounded_minutes, 'trial');

  return jsonb_build_object('allowed', true, 'kind', 'trial', 'remaining', 0);
end;
$$;

revoke all on function public.consume_clip_minutes(uuid, text, numeric) from public;
revoke all on function public.consume_clip_minutes(uuid, text, numeric) from anon;
revoke all on function public.consume_clip_minutes(uuid, text, numeric) from authenticated;
grant execute on function public.consume_clip_minutes(uuid, text, numeric) to service_role;

-- Para ativar manualmente uma assinatura enquanto o Mercado Pago não está pronto:
-- update public.profiles set subscription_status = 'active', period_start = now(),
-- period_end = now() + interval '1 month', monthly_minutes_used = 0
-- where email = 'cliente@exemplo.com';
