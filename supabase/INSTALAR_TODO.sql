-- SAFE BSO MIGRATION · instalación completa de la base de datos (fase 1)
-- Pegar todo en Supabase → SQL Editor → Run. Solo una vez.

-- ===== supabase/migrations/20261030000001_nucleo_seguridad.sql =====
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

-- ===== supabase/migrations/20261030000002_catalogo.sql =====
-- =====================================================================
-- Migración 2: catálogo de servicios, costos, formas de pago,
-- medios de pago (tarifas) y consecutivos
-- =====================================================================
-- Decisiones de Mauro (30/10/2026):
--   * Solo administradores crean y editan servicios.
--   * Tres tipos: principal, adicional y pago a tercero.
--   * Cada servicio tiene costos fijos y variables, abreviatura y su propia forma de pago.
--   * Pagos a terceros pueden llevar recargo de gestión (varía).
--   * Comisión de plataformas por defecto: 3%, incluida en el pago del cliente.
--   * Consecutivo: CIUDAD-DÍA JULIANO-ABREVIATURA (ej. BOG-303-VA).
-- =====================================================================

create table public.categorias_servicio (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  tipo_proceso  text,                     -- enlace con el Control de procesos
  orden         int not null default 0,
  activa        boolean not null default true
);

-- Forma de pago: cronograma en porcentajes y días desde la aceptación
-- cuotas = [{"numero":1,"porcentaje":50,"dias":0,"descripcion":"Anticipo"}, ...]
create table public.formas_pago (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,
  descripcion  text,
  cuotas       jsonb not null,
  activa       boolean not null default true,
  constraint formas_pago_cuotas_array check (jsonb_typeof(cuotas) = 'array' and jsonb_array_length(cuotas) > 0)
);

create or replace function app.validar_forma_pago() returns trigger
language plpgsql as $$
declare
  v_total numeric;
begin
  select coalesce(sum((c ->> 'porcentaje')::numeric), 0) into v_total
  from jsonb_array_elements(new.cuotas) c;
  if v_total <> 100 then
    raise exception 'Los porcentajes de la forma de pago "%" deben sumar 100%% (suman %)', new.nombre, v_total
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger formas_pago_validar before insert or update on public.formas_pago
  for each row execute function app.validar_forma_pago();

create table public.servicios (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null check (tipo in ('principal', 'adicional', 'tercero')),
  nombre           text not null,
  abreviatura      text not null unique check (abreviatura ~ '^[A-Z0-9]{1,6}$'),
  descripcion      text,
  incluye          text,
  categoria_id     uuid references public.categorias_servicio (id),
  moneda           text not null default 'COP' check (moneda in ('COP', 'USD', 'CAD', 'EUR')),
  precio           numeric(14, 2) not null default 0 check (precio >= 0),   -- precio al cliente, IVA incluido
  iva_pct          numeric(5, 2)  not null default 19 check (iva_pct between 0 and 100),
  forma_pago_id    uuid references public.formas_pago (id),
  -- solo pagos a terceros
  beneficiario     text,
  recargo_gestion  numeric(14, 2) not null default 0 check (recargo_gestion >= 0),
  activo           boolean not null default true,
  creado_por       uuid references public.perfiles (id) default auth.uid(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  -- Un pago a tercero no lleva IVA (no es ingreso de SAFE BSO)
  constraint servicios_tercero_sin_iva check (tipo <> 'tercero' or iva_pct = 0),
  constraint servicios_recargo_solo_tercero check (tipo = 'tercero' or recargo_gestion = 0)
);
create index servicios_tipo on public.servicios (tipo) where activo;

create table public.servicio_costos (
  id           uuid primary key default gen_random_uuid(),
  servicio_id  uuid not null references public.servicios (id) on delete cascade,
  tipo         text not null check (tipo in ('fijo', 'variable')),
  concepto     text not null,
  valor        numeric(14, 2) not null check (valor >= 0),
  orden        int not null default 0
);
create index servicio_costos_servicio on public.servicio_costos (servicio_id);

-- Adicionales ligados a servicios principales (sugeridos al cotizar)
create table public.servicio_adicionales (
  principal_id  uuid not null references public.servicios (id) on delete cascade,
  adicional_id  uuid not null references public.servicios (id) on delete cascade,
  sugerido      boolean not null default true,
  orden         int not null default 0,
  primary key (principal_id, adicional_id),
  check (principal_id <> adicional_id)
);

create or replace function app.validar_adicional() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select tipo from servicios where id = new.principal_id) <> 'principal' then
    raise exception 'Solo se pueden ligar adicionales a un servicio principal' using errcode = 'P0001';
  end if;
  if (select tipo from servicios where id = new.adicional_id) not in ('adicional', 'tercero') then
    raise exception 'Solo se pueden ligar servicios adicionales o pagos a terceros' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger servicio_adicionales_validar before insert or update on public.servicio_adicionales
  for each row execute function app.validar_adicional();

-- Precio distinto por oficina (opcional; si no hay fila se usa servicios.precio)
create table public.servicio_precios_oficina (
  servicio_id  uuid not null references public.servicios (id) on delete cascade,
  oficina_id   uuid not null references public.oficinas (id) on delete cascade,
  precio       numeric(14, 2) not null check (precio >= 0),
  primary key (servicio_id, oficina_id)
);

-- Medios de pago y su comisión (incluida en el pago del cliente)
create table public.medios_pago (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null unique,
  tipo                text not null check (tipo in ('plataforma', 'transferencia', 'efectivo', 'datafono', 'internacional', 'otro')),
  comision_pct        numeric(6, 3) not null default 0 check (comision_pct >= 0),
  valor_fijo          numeric(14, 2) not null default 0 check (valor_fijo >= 0),
  iva_sobre_comision  boolean not null default false,
  monedas             text[] not null default array['COP'],
  oficina_id          uuid references public.oficinas (id),     -- null = todas
  instrucciones       text,                                     -- se imprime en la cotización
  activo              boolean not null default true,
  orden               int not null default 0
);

-- Consecutivos: CIUDAD-DÍA JULIANO-ABREVIATURA; si se repite el mismo día, sufijo -02, -03…
create table public.consecutivos (
  prefijo  text primary key,
  ultimo   int not null default 0
);

create or replace function app.siguiente_consecutivo(p_oficina uuid, p_abreviatura text, p_fecha date default current_date)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
  v_prefijo text;
  v_n int;
begin
  if not app.puede_ver_oficina(p_oficina) then
    raise exception 'No tienes acceso a esta oficina' using errcode = '42501';
  end if;
  select codigo into v_codigo from oficinas where id = p_oficina;
  if v_codigo is null then
    raise exception 'Oficina no encontrada' using errcode = 'P0002';
  end if;
  v_prefijo := v_codigo || '-' || lpad(extract(doy from p_fecha)::int::text, 3, '0') || '-' || upper(p_abreviatura);
  insert into consecutivos (prefijo, ultimo) values (v_prefijo, 1)
  on conflict (prefijo) do update set ultimo = consecutivos.ultimo + 1
  returning ultimo into v_n;
  return case when v_n = 1 then v_prefijo else v_prefijo || '-' || lpad(v_n::text, 2, '0') end;
end $$;

-- Mantener actualizado_en
create or replace function app.tocar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
create trigger servicios_tocar before update on public.servicios
  for each row execute function app.tocar_actualizado();

-- Auditoría
create trigger auditar after insert or update or delete on public.categorias_servicio for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.formas_pago          for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.servicios            for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.servicio_costos      for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.servicio_precios_oficina for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.medios_pago          for each row execute function app.auditar();

-- RLS
alter table public.categorias_servicio      enable row level security;
alter table public.formas_pago              enable row level security;
alter table public.servicios                enable row level security;
alter table public.servicio_costos          enable row level security;
alter table public.servicio_adicionales     enable row level security;
alter table public.servicio_precios_oficina enable row level security;
alter table public.medios_pago              enable row level security;
alter table public.consecutivos             enable row level security;   -- sin políticas: solo vía función

-- Lectura: cualquier usuario habilitado. Escritura: solo administradores.
create policy ver on public.categorias_servicio  for select to authenticated using (app.habilitado());
create policy admin on public.categorias_servicio for all to authenticated using (app.es_admin()) with check (app.es_admin());
create policy ver on public.formas_pago          for select to authenticated using (app.habilitado());
create policy admin on public.formas_pago        for all to authenticated using (app.es_admin()) with check (app.es_admin());
create policy ver on public.servicios            for select to authenticated using (app.habilitado());
create policy admin on public.servicios          for all to authenticated using (app.es_admin()) with check (app.es_admin());
create policy ver on public.servicio_adicionales for select to authenticated using (app.habilitado());
create policy admin on public.servicio_adicionales for all to authenticated using (app.es_admin()) with check (app.es_admin());
create policy ver on public.servicio_precios_oficina for select to authenticated using (app.puede_ver_oficina(oficina_id));
create policy admin on public.servicio_precios_oficina for all to authenticated using (app.es_admin()) with check (app.es_admin());
create policy ver on public.medios_pago          for select to authenticated
  using (app.habilitado() and (oficina_id is null or app.puede_ver_oficina(oficina_id)));
create policy admin on public.medios_pago        for all to authenticated using (app.es_admin()) with check (app.es_admin());
-- Costos: solo Admin y Finanzas (los vendedores no ven costos ni utilidad)
create policy ver on public.servicio_costos      for select to authenticated using (app.ve_costos());
create policy admin on public.servicio_costos    for all to authenticated using (app.es_admin()) with check (app.es_admin());

grant execute on all functions in schema app to authenticated;

-- Datos iniciales
insert into public.formas_pago (nombre, descripcion, cuotas) values
  ('Contado', 'Pago total al aceptar',
   '[{"numero":1,"porcentaje":100,"dias":0,"descripcion":"Pago total"}]'),
  ('50% anticipo + 50% saldo', 'Anticipo al aceptar y saldo a los 30 días',
   '[{"numero":1,"porcentaje":50,"dias":0,"descripcion":"Anticipo"},{"numero":2,"porcentaje":50,"dias":30,"descripcion":"Saldo"}]');

insert into public.medios_pago (nombre, tipo, comision_pct, orden) values
  ('Plataforma de pagos (tarjeta / PSE)', 'plataforma', 3, 1),
  ('Transferencia bancaria',              'transferencia', 0, 2),
  ('Efectivo',                            'efectivo', 0, 3);

-- ===== supabase/migrations/20261030000003_guardar_servicio.sql =====
-- =====================================================================
-- Migración 3: guardado atómico de un servicio con sus costos,
-- adicionales y precios por oficina (todo o nada).
-- Se ejecuta con los permisos del usuario (security invoker): aplica RLS,
-- por lo que solo un administrador puede usarla.
-- =====================================================================
create or replace function public.guardar_servicio(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_tipo text := p ->> 'tipo';
begin
  if not app.es_admin() then
    raise exception 'Solo los administradores pueden crear o editar servicios' using errcode = '42501';
  end if;

  if v_id is null then
    insert into servicios (tipo, nombre, abreviatura, descripcion, incluye, categoria_id, moneda, precio,
                           iva_pct, forma_pago_id, beneficiario, recargo_gestion, activo)
    values (v_tipo, p ->> 'nombre', upper(p ->> 'abreviatura'), nullif(p ->> 'descripcion', ''),
            nullif(p ->> 'incluye', ''), nullif(p ->> 'categoria_id', '')::uuid, coalesce(p ->> 'moneda', 'COP'),
            coalesce((p ->> 'precio')::numeric, 0),
            case when v_tipo = 'tercero' then 0 else coalesce((p ->> 'iva_pct')::numeric, 19) end,
            nullif(p ->> 'forma_pago_id', '')::uuid, nullif(p ->> 'beneficiario', ''),
            case when v_tipo = 'tercero' then coalesce((p ->> 'recargo_gestion')::numeric, 0) else 0 end,
            coalesce((p ->> 'activo')::boolean, true))
    returning id into v_id;
  else
    update servicios set
      tipo = v_tipo, nombre = p ->> 'nombre', abreviatura = upper(p ->> 'abreviatura'),
      descripcion = nullif(p ->> 'descripcion', ''), incluye = nullif(p ->> 'incluye', ''),
      categoria_id = nullif(p ->> 'categoria_id', '')::uuid, moneda = coalesce(p ->> 'moneda', 'COP'),
      precio = coalesce((p ->> 'precio')::numeric, 0),
      iva_pct = case when v_tipo = 'tercero' then 0 else coalesce((p ->> 'iva_pct')::numeric, 19) end,
      forma_pago_id = nullif(p ->> 'forma_pago_id', '')::uuid, beneficiario = nullif(p ->> 'beneficiario', ''),
      recargo_gestion = case when v_tipo = 'tercero' then coalesce((p ->> 'recargo_gestion')::numeric, 0) else 0 end,
      activo = coalesce((p ->> 'activo')::boolean, true)
    where id = v_id;
    if not found then
      raise exception 'Servicio no encontrado' using errcode = 'P0002';
    end if;
  end if;

  -- Costos: se reemplazan completos
  if p ? 'costos' then
    delete from servicio_costos where servicio_id = v_id;
    insert into servicio_costos (servicio_id, tipo, concepto, valor, orden)
    select v_id, c ->> 'tipo', c ->> 'concepto', (c ->> 'valor')::numeric, ord::int
    from jsonb_array_elements(p -> 'costos') with ordinality as t(c, ord)
    where coalesce(c ->> 'concepto', '') <> '';
  end if;

  -- Adicionales sugeridos (solo para servicios principales)
  if p ? 'adicionales' then
    delete from servicio_adicionales where principal_id = v_id;
    if v_tipo = 'principal' then
      insert into servicio_adicionales (principal_id, adicional_id, orden)
      select v_id, (a #>> '{}')::uuid, ord::int
      from jsonb_array_elements(p -> 'adicionales') with ordinality as t(a, ord);
    end if;
  end if;

  -- Precios distintos por oficina (vacío = usa el precio general)
  if p ? 'precios_oficina' then
    delete from servicio_precios_oficina where servicio_id = v_id;
    insert into servicio_precios_oficina (servicio_id, oficina_id, precio)
    select v_id, (x ->> 'oficina_id')::uuid, (x ->> 'precio')::numeric
    from jsonb_array_elements(p -> 'precios_oficina') x
    where nullif(x ->> 'precio', '') is not null;
  end if;

  return v_id;
end $$;

grant execute on function public.guardar_servicio(jsonb) to authenticated;

-- ===== supabase/migrations/20261030000004_consecutivo_cliente.sql =====
-- =====================================================================
-- Migración 4: el consecutivo incluye al cliente (decisión de Mauro, 30/10/2026)
-- Formato: CIUDAD-DÍA JULIANO-ABREVIATURA-NOMBRE+INICIAL DEL APELLIDO
--   ej. María Castro, Visa Americana, Bogotá, 30 de octubre → BOG-303-VA-MARIAC
-- Si el mismo cliente recibe el mismo servicio el mismo día: sufijo -02, -03…
-- =====================================================================

-- Primer nombre + inicial del primer apellido, en mayúsculas y sin tildes
create or replace function app.codigo_cliente(p_nombres text, p_apellidos text) returns text
language sql immutable as $$
  select regexp_replace(
    upper(translate(
      coalesce(split_part(trim(p_nombres), ' ', 1), '') || left(coalesce(trim(p_apellidos), ''), 1),
      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
    '[^A-Z0-9]', '', 'g')
$$;

drop function if exists app.siguiente_consecutivo(uuid, text, date);

create or replace function app.siguiente_consecutivo(
  p_oficina uuid, p_abreviatura text, p_nombres text, p_apellidos text, p_fecha date default current_date)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
  v_cliente text := app.codigo_cliente(p_nombres, p_apellidos);
  v_prefijo text;
  v_n int;
begin
  if not app.puede_ver_oficina(p_oficina) then
    raise exception 'No tienes acceso a esta oficina' using errcode = '42501';
  end if;
  select codigo into v_codigo from oficinas where id = p_oficina;
  if v_codigo is null then
    raise exception 'Oficina no encontrada' using errcode = 'P0002';
  end if;
  if v_cliente = '' then
    raise exception 'Falta el nombre del cliente para el consecutivo' using errcode = 'P0001';
  end if;
  v_prefijo := v_codigo || '-' || lpad(extract(doy from p_fecha)::int::text, 3, '0') || '-'
               || upper(p_abreviatura) || '-' || v_cliente;
  insert into consecutivos (prefijo, ultimo) values (v_prefijo, 1)
  on conflict (prefijo) do update set ultimo = consecutivos.ultimo + 1
  returning ultimo into v_n;
  return case when v_n = 1 then v_prefijo else v_prefijo || '-' || lpad(v_n::text, 2, '0') end;
end $$;

grant execute on all functions in schema app to authenticated;
