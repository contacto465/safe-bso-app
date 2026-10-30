-- =====================================================================
-- SAFE BSO MIGRATION · Software contable
-- Migración 1: núcleo, seguridad y aislamiento por oficina
-- =====================================================================
-- Reglas que garantiza la base de datos (no solo la pantalla):
--   * Solo usuarios con perfil ACTIVO y verificación en dos pasos (aal2) leen datos.
--   * Máximo de usuarios activos = configuracion.max_usuarios (3).
--   * Alcance: ve_todo = todas las oficinas y el consolidado;
--     si no, solo las oficinas asignadas en usuario_oficinas.
--   * Solo administradores con ve_todo cambian usuarios, alcances y configuración.
--   * Todo cambio queda en auditoría.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Oficinas
-- ---------------------------------------------------------------------
create table public.oficinas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (codigo ~ '^[A-Z]{3}$'),  -- BOG, BAQ: prefijo del consecutivo
  nombre        text not null,
  ciudad        text not null,
  direccion     text,
  telefono      text,
  correo        text,
  responsable   text,
  es_principal  boolean not null default false,
  activa        boolean not null default true,
  creado_en     timestamptz not null default now()
);
create unique index oficinas_una_principal on public.oficinas (es_principal) where es_principal;

-- Datos de la empresa (mismo NIT para todas las oficinas)
create table public.empresa (
  id              int primary key default 1 check (id = 1),
  razon_social    text not null,
  nit             text,
  responsable_iva boolean,
  logo_url        text,
  color_primario  text,
  color_acento    text,
  tipografia      text,
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfiles de usuario (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  correo      text not null,
  rol         text not null default 'operaciones'
              check (rol in ('admin', 'finanzas', 'vendedor', 'operaciones')),
  ve_todo     boolean not null default false,   -- todas las oficinas + consolidado
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  ultimo_ingreso timestamptz
);

create table public.usuario_oficinas (
  usuario_id  uuid not null references public.perfiles (id) on delete cascade,
  oficina_id  uuid not null references public.oficinas (id) on delete restrict,
  primary key (usuario_id, oficina_id)
);

-- ---------------------------------------------------------------------
-- Configuración (reglas del negocio editables)
-- ---------------------------------------------------------------------
create table public.configuracion (
  clave           text primary key,
  valor           jsonb not null,
  descripcion     text not null,
  actualizado_por uuid references public.perfiles (id),
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          bigserial primary key,
  fecha       timestamptz not null default now(),
  usuario_id  uuid,
  tabla       text not null,
  registro_id text,
  accion      text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  antes       jsonb,
  despues     jsonb
);
create index auditoria_tabla_registro on public.auditoria (tabla, registro_id);
create index auditoria_fecha on public.auditoria (fecha desc);

-- Registro de ingresos
create table public.ingresos (
  id          bigserial primary key,
  usuario_id  uuid not null references public.perfiles (id) on delete cascade,
  fecha       timestamptz not null default now(),
  ip          text,
  agente      text,
  dispositivo_nuevo boolean not null default false
);

-- =====================================================================
-- Funciones de seguridad (security definer: leen perfiles sin RLS)
-- =====================================================================
create or replace function app.mfa_ok() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function app.perfil_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

-- Usuario habilitado para operar: perfil activo + verificación en dos pasos
create or replace function app.habilitado() returns boolean
language sql stable as $$
  select app.perfil_activo() and app.mfa_ok()
$$;

create or replace function app.rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function app.ve_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ve_todo from perfiles where id = auth.uid() and activo), false)
$$;

create or replace function app.es_admin() returns boolean
language sql stable as $$
  select app.habilitado() and app.rol() = 'admin'
$$;

-- Administrador general: admin + ve todo. Único que gestiona usuarios y configuración.
create or replace function app.es_admin_general() returns boolean
language sql stable as $$
  select app.es_admin() and app.ve_todo()
$$;

-- Ve costos y utilidad (los vendedores no)
create or replace function app.ve_costos() returns boolean
language sql stable as $$
  select app.habilitado() and app.rol() in ('admin', 'finanzas')
$$;

create or replace function app.puede_ver_oficina(p_oficina uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.habilitado() and (
    app.ve_todo()
    or exists (select 1 from usuario_oficinas uo
               where uo.usuario_id = auth.uid() and uo.oficina_id = p_oficina)
  )
$$;

-- Oficinas visibles para el usuario actual (para filtros en pantallas)
create or replace function app.oficinas_visibles() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.id from oficinas o where app.puede_ver_oficina(o.id)
$$;

create or replace function app.config_num(p_clave text) returns numeric
language sql stable security definer set search_path = public as $$
  select (valor #>> '{}')::numeric from configuracion where clave = p_clave
$$;

-- =====================================================================
-- Límite de usuarios activos
-- =====================================================================
create or replace function app.validar_limite_usuarios() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max int := coalesce(app.config_num('max_usuarios'), 3);
  v_activos int;
begin
  if new.activo and (tg_op = 'INSERT' or not old.activo) then
    select count(*) into v_activos from perfiles where activo and id <> new.id;
    if v_activos >= v_max then
      raise exception 'Límite de usuarios alcanzado: solo se permiten % usuarios activos', v_max
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger perfiles_limite
  before insert or update of activo on public.perfiles
  for each row execute function app.validar_limite_usuarios();

-- Un usuario sin ve_todo debe tener al menos una oficina (se valida al asignar)
-- Un usuario no puede quitarse a sí mismo el rol admin ni desactivarse
create or replace function app.proteger_autoedicion() returns trigger
language plpgsql as $$
begin
  if new.id = auth.uid() and (new.activo = false or new.rol <> 'admin' or new.ve_todo = false)
     and old.rol = 'admin' and old.ve_todo then
    raise exception 'No puedes quitarte tus propios permisos de administrador general'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger perfiles_autoedicion
  before update on public.perfiles
  for each row execute function app.proteger_autoedicion();

-- =====================================================================
-- Auditoría genérica
-- =====================================================================
create or replace function app.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  v_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'clave');
  insert into auditoria (usuario_id, tabla, registro_id, accion, antes, despues)
  values (auth.uid(), tg_table_name, v_id, tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger auditar after insert or update or delete on public.oficinas
  for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.empresa
  for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.perfiles
  for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.usuario_oficinas
  for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.configuracion
  for each row execute function app.auditar();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.oficinas         enable row level security;
alter table public.empresa          enable row level security;
alter table public.perfiles         enable row level security;
alter table public.usuario_oficinas enable row level security;
alter table public.configuracion    enable row level security;
alter table public.auditoria        enable row level security;
alter table public.ingresos         enable row level security;

-- Oficinas: cada quien ve las suyas; el admin general las gestiona
create policy oficinas_ver on public.oficinas for select to authenticated
  using (app.puede_ver_oficina(id));
create policy oficinas_admin on public.oficinas for all to authenticated
  using (app.es_admin_general()) with check (app.es_admin_general());

create policy empresa_ver on public.empresa for select to authenticated
  using (app.habilitado());
create policy empresa_admin on public.empresa for all to authenticated
  using (app.es_admin_general()) with check (app.es_admin_general());

-- Perfiles: cada usuario ve el suyo (aunque no haya completado 2FA, para el flujo de ingreso);
-- el admin general ve y gestiona todos
create policy perfiles_propio on public.perfiles for select to authenticated
  using (id = auth.uid());
create policy perfiles_admin on public.perfiles for all to authenticated
  using (app.es_admin_general()) with check (app.es_admin_general());

create policy uo_propio on public.usuario_oficinas for select to authenticated
  using (usuario_id = auth.uid() and app.habilitado());
create policy uo_admin on public.usuario_oficinas for all to authenticated
  using (app.es_admin_general()) with check (app.es_admin_general());

create policy config_ver on public.configuracion for select to authenticated
  using (app.habilitado());
create policy config_admin on public.configuracion for all to authenticated
  using (app.es_admin_general()) with check (app.es_admin_general());

create policy auditoria_admin on public.auditoria for select to authenticated
  using (app.es_admin_general());

create policy ingresos_propio on public.ingresos for insert to authenticated
  with check (usuario_id = auth.uid());
create policy ingresos_admin on public.ingresos for select to authenticated
  using (app.es_admin_general());

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- =====================================================================
-- Datos iniciales (respuestas de Mauro, 30/10/2026)
-- =====================================================================
insert into public.empresa (razon_social) values ('SAFE BSO MIGRATION');

insert into public.oficinas (codigo, nombre, ciudad, direccion, telefono, es_principal) values
  ('BOG', 'Bogotá – Connecta 26', 'Bogotá', 'Centro Empresarial Connecta 26, Av. Calle 26 #92-32', '+57 324 249 2396', true),
  ('BAQ', 'Barranquilla – Américas III', 'Barranquilla', 'Las Américas III', null, false);

insert into public.configuracion (clave, valor, descripcion) values
  ('max_usuarios',             '3',  'Máximo de usuarios activos en la aplicación'),
  ('tope_descuento_pct',       '30', 'Descuento máximo en cotizaciones a personas (%)'),
  ('tope_descuento_empresas_pct', '40', 'Descuento máximo en cotizaciones a empresas (%)'),
  ('vigencia_cotizacion_dias', '3',  'Días de vigencia de una cotización'),
  ('fondo_incentivos_pct',     '10', 'Reserva del fondo de incentivos sobre honorarios antes de IVA y netos de comisión (%)'),
  ('comision_plataformas_pct', '3',  'Comisión por defecto de las plataformas de pago (%)'),
  ('iva_pct',                  '19', 'Tasa de IVA por defecto (%)'),
  ('devolucion_horas',         '48', 'Horas desde el pago en que el cliente puede desistir con devolución del 100% del anticipo'),
  ('inactividad_minutos',      '30', 'Minutos sin actividad antes de cerrar la sesión');
