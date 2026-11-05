-- SAFE BSO MIGRATION · instalación completa (solo para un proyecto NUEVO)

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

-- ===== supabase/migrations/20261030000005_clientes_cotizaciones.sql =====
-- =====================================================================
-- Migración 5 (fase 2): clientes, empresas y cotizaciones / prefacturas
-- Reglas de Mauro:
--   * Consecutivo CIUDAD-DÍA JULIANO-ABREVIATURA-CLIENTE (abreviatura del servicio principal).
--   * Descuento máximo 30% (40% para empresas), solo sobre honorarios, por línea y sobre el total.
--   * Pagos a terceros: sin IVA, sin descuento; su recargo de gestión es honorario.
--   * Forma de pago tomada del servicio principal; cronograma con fechas.
--   * Vigencia 3 días. Al vencer se actualiza (precios del catálogo, nueva versión) pero NO se envía:
--     queda «por reenviar» hasta que alguien oprima Reenviar.
--   * El cliente responde desde una página pública con enlace único (sin entrar a la app).
-- =====================================================================

create or replace function app.hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

insert into public.configuracion (clave, valor, descripcion) values
  ('terminos_cotizacion', to_jsonb('Los honorarios no incluyen las tarifas de embajadas o entidades, que se cobran aparte según su valor oficial. Si el cliente desiste dentro de las 48 horas siguientes al pago, se devuelve el 100% del anticipo. Las tarifas ya pagadas a embajadas o entidades no son reembolsables. La aprobación de visas y trámites depende exclusivamente de la autoridad competente.'::text),
   'Términos y condiciones que aparecen en las cotizaciones'),
  ('whatsapp_empresa', to_jsonb('573242492396'::text), 'WhatsApp para el botón «Continuar chat» de las cotizaciones (con indicativo, sin +)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Empresas (clientes corporativos)
-- ---------------------------------------------------------------------
create table public.empresas (
  id                 uuid primary key default gen_random_uuid(),
  oficina_id         uuid not null references public.oficinas (id),
  razon_social       text not null,
  nit                text,
  pais               text,
  sector             text,
  contacto_nombre    text,
  contacto_correo    text,
  contacto_celular   text,
  notas              text,
  activa             boolean not null default true,
  creado_por         uuid references public.perfiles (id) default auth.uid(),
  creado_en          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes (una sola base; cada oficina ve solo los suyos)
-- ---------------------------------------------------------------------
create table public.clientes (
  id                 uuid primary key default gen_random_uuid(),
  oficina_id         uuid not null references public.oficinas (id),
  nombres            text not null,
  apellidos          text not null,
  documento_tipo     text check (documento_tipo in ('CC', 'CE', 'PA', 'PPT', 'NIT', 'OTRO')),
  documento          text,
  correo             text,
  celular            text,
  pais               text,
  ciudad             text,
  empresa_id         uuid references public.empresas (id),   -- beneficiario de una empresa
  referido_por       text,
  -- Control de procesos (el cliente entra al embudo al registrarse)
  categoria          text,
  tipo_proceso       text,
  estado_proceso     text not null default 'Registrado',
  fecha_inicio       date not null default app.hoy(),
  notas              text,
  creado_por         uuid references public.perfiles (id) default auth.uid(),
  creado_en          timestamptz not null default now()
);
create index clientes_oficina on public.clientes (oficina_id);
create index clientes_busqueda on public.clientes (lower(nombres || ' ' || apellidos));

-- ---------------------------------------------------------------------
-- Cotizaciones y prefacturas
-- ---------------------------------------------------------------------
create table public.cotizaciones (
  id                    uuid primary key default gen_random_uuid(),
  oficina_id            uuid not null references public.oficinas (id),
  tipo                  text not null default 'cotizacion' check (tipo in ('cotizacion', 'prefactura')),
  consecutivo           text not null unique,
  version               int not null default 1,
  cliente_id            uuid not null references public.clientes (id),
  empresa_id            uuid references public.empresas (id),
  estado                text not null default 'borrador'
                        check (estado in ('borrador', 'enviada', 'por_reenviar', 'aceptada', 'rechazada', 'anulada')),
  fecha_emision         date not null default app.hoy(),
  vigencia_dias         int not null default 3,
  fecha_vencimiento     date not null,
  tasas                 jsonb not null default '{}'::jsonb,       -- {"USD": 3950, "CAD": 2900}
  tope_descuento_pct    numeric(5, 2) not null,
  subtotal_honorarios   numeric(14, 2) not null default 0,
  descuento_total       numeric(14, 2) not null default 0,
  descuento_pct         numeric(6, 2) not null default 0,
  total_honorarios      numeric(14, 2) not null default 0,
  iva_incluido          numeric(14, 2) not null default 0,
  total_terceros        numeric(14, 2) not null default 0,
  total                 numeric(14, 2) not null default 0,
  forma_pago_id         uuid references public.formas_pago (id),
  cronograma            jsonb not null default '[]'::jsonb,
  notas                 text,
  token_publico         uuid not null unique default gen_random_uuid(),
  enviada_en            timestamptz,
  actualizada_en        timestamptz,
  respondida_en         timestamptz,
  respuesta_comentario  text,
  creado_por            uuid references public.perfiles (id) default auth.uid(),
  creado_en             timestamptz not null default now()
);
create index cotizaciones_oficina on public.cotizaciones (oficina_id, creado_en desc);
create index cotizaciones_cliente on public.cotizaciones (cliente_id);

create table public.cotizacion_items (
  id                uuid primary key default gen_random_uuid(),
  cotizacion_id     uuid not null references public.cotizaciones (id) on delete cascade,
  orden             int not null default 0,
  servicio_id       uuid not null references public.servicios (id),
  tipo              text not null check (tipo in ('honorario', 'tercero')),
  es_principal      boolean not null default false,
  descripcion       text not null,
  incluye           text,
  cantidad          numeric(10, 2) not null default 1 check (cantidad > 0),
  moneda            text not null default 'COP',
  precio_unitario   numeric(14, 2) not null check (precio_unitario >= 0),   -- en la moneda del ítem
  recargo_gestion   numeric(14, 2) not null default 0 check (recargo_gestion >= 0),
  tasa              numeric(14, 4) not null default 1,
  iva_pct           numeric(5, 2) not null default 0,
  descuento_tipo    text not null default 'pct' check (descuento_tipo in ('pct', 'valor')),
  descuento_valor   numeric(14, 2) not null default 0 check (descuento_valor >= 0),
  -- calculados (COP)
  bruto             numeric(14, 2) not null default 0,
  recargo           numeric(14, 2) not null default 0,
  descuento         numeric(14, 2) not null default 0,
  descuento_pct     numeric(6, 2) not null default 0,
  total             numeric(14, 2) not null default 0
);
create index cotizacion_items_cot on public.cotizacion_items (cotizacion_id);

create table public.cotizacion_versiones (
  id             bigserial primary key,
  cotizacion_id  uuid not null references public.cotizaciones (id) on delete cascade,
  version        int not null,
  motivo         text not null,
  datos          jsonb not null,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now()
);

-- =====================================================================
-- Cálculo: recalcula líneas, totales, topes, cronograma y vigencia
-- =====================================================================
create or replace function app.recalcular_cotizacion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
  v_bruto_hon numeric; v_recargo numeric; v_desc numeric; v_terceros numeric; v_iva numeric;
  v_forma uuid; v_cuotas jsonb; v_total numeric; v_acum numeric := 0; v_crono jsonb := '[]'::jsonb;
  r record; v_n int; v_i int := 0; v_valor numeric;
begin
  select * into c from cotizaciones where id = p_id;

  -- Tasa de cambio por ítem
  update cotizacion_items i set tasa = case when i.moneda = 'COP' then 1
                                          else coalesce((c.tasas ->> i.moneda)::numeric, 0) end
  where i.cotizacion_id = p_id;
  if exists (select 1 from cotizacion_items where cotizacion_id = p_id and tasa = 0) then
    raise exception 'Falta la tasa de cambio (TRM) para: %',
      (select string_agg(distinct moneda, ', ') from cotizacion_items where cotizacion_id = p_id and tasa = 0)
      using errcode = 'P0001';
  end if;

  -- Líneas
  update cotizacion_items set
    bruto = round(cantidad * precio_unitario * tasa, 0),
    recargo = case when tipo = 'tercero' then round(cantidad * recargo_gestion * tasa, 0) else 0 end
  where cotizacion_id = p_id;
  update cotizacion_items set
    descuento = case when tipo = 'tercero' or bruto = 0 then 0
                     when descuento_tipo = 'pct' then round(bruto * descuento_valor / 100, 0)
                     else least(descuento_valor, bruto) end
  where cotizacion_id = p_id;
  update cotizacion_items set
    descuento_pct = case when bruto > 0 then round(descuento / bruto * 100, 2) else 0 end,
    total = bruto + recargo - descuento
  where cotizacion_id = p_id;

  -- Tope por línea
  select descripcion, descuento_pct into r from cotizacion_items
  where cotizacion_id = p_id and descuento_pct > c.tope_descuento_pct limit 1;
  if found then
    raise exception 'El descuento de "%" (%%%) supera el máximo permitido (%%%)', r.descripcion, r.descuento_pct, c.tope_descuento_pct
      using errcode = 'P0001';
  end if;

  select coalesce(sum(bruto) filter (where tipo = 'honorario'), 0),
         coalesce(sum(recargo), 0),
         coalesce(sum(descuento), 0),
         coalesce(sum(bruto) filter (where tipo = 'tercero'), 0),
         coalesce(sum(round((bruto - descuento) - (bruto - descuento) / (1 + iva_pct / 100), 0)) filter (where tipo = 'honorario'), 0)
    into v_bruto_hon, v_recargo, v_desc, v_terceros, v_iva
  from cotizacion_items where cotizacion_id = p_id;

  -- Tope sobre el total
  if v_bruto_hon > 0 and v_desc / v_bruto_hon * 100 > c.tope_descuento_pct then
    raise exception 'El descuento total supera el máximo permitido (%%%)', c.tope_descuento_pct using errcode = 'P0001';
  end if;

  v_total := v_bruto_hon + v_recargo - v_desc + v_terceros;

  -- Forma de pago: la del servicio principal (o la del primer ítem que tenga)
  select s.forma_pago_id into v_forma
  from cotizacion_items i join servicios s on s.id = i.servicio_id
  where i.cotizacion_id = p_id and s.forma_pago_id is not null
  order by i.es_principal desc, i.orden limit 1;
  select cuotas into v_cuotas from formas_pago where id = v_forma;
  if v_cuotas is null then
    v_cuotas := '[{"numero":1,"porcentaje":100,"dias":0,"descripcion":"Pago total"}]'::jsonb;
  end if;
  v_n := jsonb_array_length(v_cuotas);
  for r in select x from jsonb_array_elements(v_cuotas) x order by (x ->> 'numero')::int loop
    v_i := v_i + 1;
    v_valor := case when v_i = v_n then v_total - v_acum else round(v_total * (r.x ->> 'porcentaje')::numeric / 100, 0) end;
    v_acum := v_acum + v_valor;
    v_crono := v_crono || jsonb_build_object(
      'numero', v_i, 'porcentaje', (r.x ->> 'porcentaje')::numeric, 'dias', (r.x ->> 'dias')::int,
      'descripcion', coalesce(r.x ->> 'descripcion', 'Pago ' || v_i), 'valor', v_valor,
      'fecha', c.fecha_emision + (r.x ->> 'dias')::int);
  end loop;

  update cotizaciones set
    subtotal_honorarios = v_bruto_hon + v_recargo,
    descuento_total = v_desc,
    descuento_pct = case when v_bruto_hon > 0 then round(v_desc / v_bruto_hon * 100, 2) else 0 end,
    total_honorarios = v_bruto_hon + v_recargo - v_desc,
    iva_incluido = v_iva,
    total_terceros = v_terceros,
    total = v_total,
    forma_pago_id = v_forma,
    cronograma = v_crono,
    fecha_vencimiento = fecha_emision + vigencia_dias
  where id = p_id;
end $$;

-- Copia de la versión actual (antes de cambiarla)
create or replace function app.guardar_version(p_id uuid, p_motivo text) returns void
language sql security definer set search_path = public as $$
  insert into cotizacion_versiones (cotizacion_id, version, motivo, datos)
  select c.id, c.version, p_motivo,
         to_jsonb(c) || jsonb_build_object('items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.orden), '[]') from cotizacion_items i where i.cotizacion_id = c.id))
  from cotizaciones c where c.id = p_id
$$;

-- =====================================================================
-- Crear o editar (desde la app; respeta RLS y permisos)
-- =====================================================================
create or replace function public.guardar_cotizacion(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_oficina uuid := (p ->> 'oficina_id')::uuid;
  v_cliente clientes%rowtype;
  v_tope numeric;
  v_abrev text;
  v_estado text;
  v_nombres text; v_apellidos text;
  it jsonb; v_ord int := 0; s servicios%rowtype;
begin
  if not app.habilitado() then
    raise exception 'No tienes acceso' using errcode = '42501';
  end if;
  if not app.puede_ver_oficina(v_oficina) then
    raise exception 'No tienes acceso a esta oficina' using errcode = '42501';
  end if;
  select * into v_cliente from clientes where id = (p ->> 'cliente_id')::uuid;
  if v_cliente.id is null then
    raise exception 'Elige el cliente' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then
    raise exception 'Agrega al menos un servicio' using errcode = 'P0001';
  end if;

  v_tope := case when v_cliente.empresa_id is not null or nullif(p ->> 'empresa_id', '') is not null
                 then app.config_num('tope_descuento_empresas_pct') else app.config_num('tope_descuento_pct') end;

  if v_id is null then
    -- Abreviatura del servicio principal (o del primero)
    select s2.abreviatura into v_abrev
    from jsonb_array_elements(p -> 'items') with ordinality x(e, o)
    join servicios s2 on s2.id = (x.e ->> 'servicio_id')::uuid
    order by (s2.tipo = 'principal') desc, x.o limit 1;
    if v_cliente.empresa_id is not null and coalesce((p ->> 'a_nombre_de_empresa')::boolean, false) then
      select split_part(razon_social, ' ', 1), split_part(razon_social, ' ', 2) into v_nombres, v_apellidos
      from empresas where id = v_cliente.empresa_id;
    else
      v_nombres := v_cliente.nombres; v_apellidos := v_cliente.apellidos;
    end if;

    insert into cotizaciones (oficina_id, tipo, consecutivo, cliente_id, empresa_id, vigencia_dias,
                              fecha_vencimiento, tasas, tope_descuento_pct, notas)
    values (v_oficina, coalesce(p ->> 'tipo', 'cotizacion'),
            app.siguiente_consecutivo(v_oficina, v_abrev, v_nombres, v_apellidos, app.hoy()),
            v_cliente.id, coalesce(nullif(p ->> 'empresa_id', '')::uuid, v_cliente.empresa_id),
            coalesce(app.config_num('vigencia_cotizacion_dias'), 3)::int,
            app.hoy() + coalesce(app.config_num('vigencia_cotizacion_dias'), 3)::int,
            coalesce(p -> 'tasas', '{}'), v_tope, nullif(p ->> 'notas', ''))
    returning id into v_id;
  else
    select estado into v_estado from cotizaciones where id = v_id;
    if v_estado is null then
      raise exception 'Cotización no encontrada' using errcode = 'P0002';
    end if;
    if v_estado in ('aceptada', 'rechazada', 'anulada') then
      raise exception 'Una cotización %  no se puede editar', v_estado using errcode = 'P0001';
    end if;
    -- Si ya se envió, cada cambio genera una nueva versión
    if v_estado in ('enviada', 'por_reenviar') then
      perform app.guardar_version(v_id, 'Edición');
      update cotizaciones set version = version + 1, estado = 'borrador' where id = v_id;
    end if;
    update cotizaciones set
      tipo = coalesce(p ->> 'tipo', tipo), cliente_id = v_cliente.id,
      empresa_id = coalesce(nullif(p ->> 'empresa_id', '')::uuid, v_cliente.empresa_id),
      tasas = coalesce(p -> 'tasas', tasas), tope_descuento_pct = v_tope, notas = nullif(p ->> 'notas', ''),
      fecha_emision = app.hoy()
    where id = v_id;
    delete from cotizacion_items where cotizacion_id = v_id;
  end if;

  for it in select e from jsonb_array_elements(p -> 'items') e loop
    v_ord := v_ord + 1;
    select * into s from servicios where id = (it ->> 'servicio_id')::uuid and activo;
    if s.id is null then
      raise exception 'Uno de los servicios no existe o está inactivo' using errcode = 'P0001';
    end if;
    insert into cotizacion_items (cotizacion_id, orden, servicio_id, tipo, es_principal, descripcion, incluye,
                                  cantidad, moneda, precio_unitario, recargo_gestion, iva_pct,
                                  descuento_tipo, descuento_valor)
    values (v_id, v_ord, s.id, case when s.tipo = 'tercero' then 'tercero' else 'honorario' end, s.tipo = 'principal',
            coalesce(nullif(it ->> 'descripcion', ''), s.nombre), s.incluye,
            coalesce((it ->> 'cantidad')::numeric, 1), s.moneda,
            coalesce((it ->> 'precio_unitario')::numeric, s.precio),
            case when s.tipo = 'tercero' then coalesce((it ->> 'recargo_gestion')::numeric, s.recargo_gestion) else 0 end,
            s.iva_pct,
            coalesce(it ->> 'descuento_tipo', 'pct'),
            case when s.tipo = 'tercero' then 0 else coalesce((it ->> 'descuento_valor')::numeric, 0) end);
  end loop;

  perform app.recalcular_cotizacion(v_id);
  return v_id;
end $$;

-- Enviar / reenviar: marca como enviada desde hoy (el envío por correo llega en la fase 5)
create or replace function public.enviar_cotizacion(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from cotizaciones where id = p_id;   -- RLS: solo si puede verla
  if v_estado is null then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
  if v_estado not in ('borrador', 'enviada', 'por_reenviar') then
    raise exception 'Una cotización % no se puede enviar', v_estado using errcode = 'P0001';
  end if;
  update cotizaciones set estado = 'enviada', enviada_en = now(), fecha_emision = app.hoy(),
         fecha_vencimiento = app.hoy() + vigencia_dias
  where id = p_id;
  perform app.recalcular_cotizacion(p_id);
end $$;

-- Actualizar una cotización (precios vigentes del catálogo, nueva versión). No la envía.
create or replace function app.actualizar_cotizacion(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.guardar_version(p_id, p_motivo);
  update cotizacion_items i set
    precio_unitario = s.precio,
    recargo_gestion = case when i.tipo = 'tercero' then s.recargo_gestion else 0 end,
    iva_pct = s.iva_pct, moneda = s.moneda
  from servicios s where s.id = i.servicio_id and i.cotizacion_id = p_id;
  update cotizaciones set version = version + 1, estado = 'por_reenviar', actualizada_en = now(),
         fecha_emision = app.hoy()
  where id = p_id;
  perform app.recalcular_cotizacion(p_id);
end $$;

create or replace function public.actualizar_cotizacion(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from cotizaciones where id = p_id and estado in ('enviada', 'por_reenviar', 'borrador')) then
    raise exception 'Esta cotización no se puede actualizar' using errcode = 'P0001';
  end if;
  perform app.actualizar_cotizacion(p_id, 'Actualización manual de precios');
end $$;

-- Tarea diaria: actualiza las cotizaciones enviadas que vencieron (no las reenvía)
create or replace function app.actualizar_vencidas() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from cotizaciones where estado = 'enviada' and fecha_vencimiento < app.hoy() loop
    begin
      perform app.actualizar_cotizacion(r.id, 'Vencida: actualización automática');
      n := n + 1;
    exception when others then
      -- si una falla (ej. falta TRM) se deja para revisión manual
      null;
    end;
  end loop;
  return n;
end $$;

create or replace function public.anular_cotizacion(p_id uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  update cotizaciones set estado = 'anulada', respuesta_comentario = 'Anulada: ' || p_motivo
  where id = p_id and estado not in ('aceptada', 'anulada');
  if not found then raise exception 'Esta cotización no se puede anular' using errcode = 'P0001'; end if;
end $$;

-- =====================================================================
-- Página pública del cliente (sin iniciar sesión; solo con el enlace único)
-- =====================================================================
create or replace function public.cotizacion_publica(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'consecutivo', c.consecutivo, 'tipo', c.tipo, 'version', c.version, 'estado', c.estado,
    'fecha_emision', c.fecha_emision, 'fecha_vencimiento', c.fecha_vencimiento,
    'vigente', c.estado = 'enviada' and c.fecha_vencimiento >= app.hoy(),
    'subtotal_honorarios', c.subtotal_honorarios, 'descuento_total', c.descuento_total,
    'total_honorarios', c.total_honorarios, 'iva_incluido', c.iva_incluido,
    'total_terceros', c.total_terceros, 'total', c.total, 'cronograma', c.cronograma, 'tasas', c.tasas,
    'notas', c.notas,
    'cliente', jsonb_build_object('nombre', cl.nombres || ' ' || cl.apellidos, 'documento', cl.documento),
    'empresa', (select jsonb_build_object('razon_social', e.razon_social, 'nit', e.nit) from empresas e where e.id = c.empresa_id),
    'oficina', jsonb_build_object('nombre', o.nombre, 'ciudad', o.ciudad, 'direccion', o.direccion, 'telefono', o.telefono, 'correo', o.correo),
    'emisor', (select jsonb_build_object('razon_social', razon_social, 'nit', nit) from empresa where id = 1),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'descripcion', i.descripcion, 'incluye', i.incluye, 'tipo', i.tipo, 'cantidad', i.cantidad,
                'moneda', i.moneda, 'precio_unitario', i.precio_unitario, 'bruto', i.bruto, 'recargo', i.recargo,
                'descuento', i.descuento, 'total', i.total) order by i.tipo, i.orden), '[]')
              from cotizacion_items i where i.cotizacion_id = c.id),
    'medios_pago', (select coalesce(jsonb_agg(jsonb_build_object('nombre', m.nombre, 'instrucciones', m.instrucciones) order by m.orden), '[]')
                    from medios_pago m where m.activo and (m.oficina_id is null or m.oficina_id = c.oficina_id)),
    'terminos', (select valor #>> '{}' from configuracion where clave = 'terminos_cotizacion'),
    'whatsapp', (select valor #>> '{}' from configuracion where clave = 'whatsapp_empresa')
  )
  from cotizaciones c
  join clientes cl on cl.id = c.cliente_id
  join oficinas o on o.id = c.oficina_id
  where c.token_publico = p_token and c.estado <> 'borrador' and c.estado <> 'anulada'
$$;

create or replace function public.responder_cotizacion(p_token uuid, p_accion text, p_comentario text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare c cotizaciones%rowtype;
begin
  select * into c from cotizaciones where token_publico = p_token for update;
  if c.id is null or c.estado in ('borrador', 'anulada') then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if c.estado in ('aceptada', 'rechazada') then
    return c.estado;   -- ya respondida
  end if;
  if c.estado <> 'enviada' or c.fecha_vencimiento < app.hoy() then
    raise exception 'Esta cotización venció. Tu asesor te enviará una versión actualizada.' using errcode = 'P0001';
  end if;
  if p_accion not in ('aceptar', 'rechazar') then
    raise exception 'Acción no válida' using errcode = 'P0001';
  end if;
  update cotizaciones set estado = case when p_accion = 'aceptar' then 'aceptada' else 'rechazada' end,
         respondida_en = now(), respuesta_comentario = left(nullif(trim(p_comentario), ''), 1000)
  where id = c.id;
  return case when p_accion = 'aceptar' then 'aceptada' else 'rechazada' end;
end $$;

grant execute on function public.cotizacion_publica(uuid) to anon, authenticated;
grant execute on function public.responder_cotizacion(uuid, text, text) to anon, authenticated;
grant execute on function public.guardar_cotizacion(jsonb), public.enviar_cotizacion(uuid),
  public.actualizar_cotizacion(uuid), public.anular_cotizacion(uuid, text) to authenticated;
revoke execute on function app.actualizar_vencidas() from public, authenticated;

-- =====================================================================
-- Seguridad por oficina y auditoría
-- =====================================================================
alter table public.empresas             enable row level security;
alter table public.clientes             enable row level security;
alter table public.cotizaciones         enable row level security;
alter table public.cotizacion_items     enable row level security;
alter table public.cotizacion_versiones enable row level security;

create policy oficina on public.empresas for all to authenticated
  using (app.puede_ver_oficina(oficina_id)) with check (app.puede_ver_oficina(oficina_id));
create policy oficina on public.clientes for all to authenticated
  using (app.puede_ver_oficina(oficina_id)) with check (app.puede_ver_oficina(oficina_id));
create policy oficina on public.cotizaciones for all to authenticated
  using (app.puede_ver_oficina(oficina_id)) with check (app.puede_ver_oficina(oficina_id));
create policy oficina on public.cotizacion_items for all to authenticated
  using (exists (select 1 from cotizaciones c where c.id = cotizacion_id and app.puede_ver_oficina(c.oficina_id)))
  with check (exists (select 1 from cotizaciones c where c.id = cotizacion_id and app.puede_ver_oficina(c.oficina_id)));
create policy oficina on public.cotizacion_versiones for select to authenticated
  using (exists (select 1 from cotizaciones c where c.id = cotizacion_id and app.puede_ver_oficina(c.oficina_id)));

create trigger auditar after insert or update or delete on public.empresas     for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.clientes     for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.cotizaciones for each row execute function app.auditar();

grant execute on all functions in schema app to authenticated;
revoke execute on function app.actualizar_vencidas() from authenticated;

-- Tarea programada diaria (6:00 a. m. Bogotá = 11:00 UTC). Si pg_cron no está disponible, se omite.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('actualizar-cotizaciones-vencidas', '0 11 * * *', 'select app.actualizar_vencidas()');
exception when others then
  raise notice 'pg_cron no disponible: active la extensión pg_cron en Supabase y ejecute cron.schedule manualmente';
end $$;

-- ===== supabase/migrations/20261031000006_tiempo_estimado.sql =====
-- =====================================================================
-- Migración 6: tiempo estimado de cada servicio (ficha de costeo del catálogo)
-- =====================================================================
alter table public.servicios add column if not exists tiempo_estimado text;

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
    insert into servicios (tipo, nombre, abreviatura, descripcion, incluye, tiempo_estimado, categoria_id, moneda, precio,
                           iva_pct, forma_pago_id, beneficiario, recargo_gestion, activo)
    values (v_tipo, p ->> 'nombre', upper(p ->> 'abreviatura'), nullif(p ->> 'descripcion', ''),
            nullif(p ->> 'incluye', ''), nullif(p ->> 'tiempo_estimado', ''), nullif(p ->> 'categoria_id', '')::uuid, coalesce(p ->> 'moneda', 'COP'),
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
      tiempo_estimado = nullif(p ->> 'tiempo_estimado', ''),
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

-- ===== supabase/migrations/20261104000007_ventas_abonos_acreedores.sql =====
-- =====================================================================
-- Migración 7: ventas, plan de pagos, abonos (cartera) y acreedores
-- Reglas de Mauro:
--   * Una venta nace de una cotización aceptada o se registra a mano (o por carga inicial).
--   * Abonos parciales: se cubren primero los honorarios y luego los pagos a terceros (P9).
--   * Fondo 10%: (honorarios cobrados − comisión del medio) / (1 + IVA) × 10%, por abono; 0 en ventas a empresas.
--   * Un abono no se borra: se anula con motivo (auditoría).
--   * Deudas de la empresa: saldo inicial a la fecha de corte; cada deuda la asume una oficina,
--     se reparte por porcentaje o es general (solo la ve quien ve todo).
--   * Pagos de deudas: el capital baja el saldo (no es gasto); los intereses son gasto financiero.
-- =====================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('fecha_corte', 'null'::jsonb, 'Fecha desde la que el sistema lleva las cuentas (saldos iniciales)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------
create table public.ventas (
  id                  uuid primary key default gen_random_uuid(),
  oficina_id          uuid not null references public.oficinas (id),
  numero              text not null unique,
  referencia_externa  text,                                   -- N.º usado en la carga inicial
  cliente_id          uuid not null references public.clientes (id),
  empresa_id          uuid references public.empresas (id),
  cotizacion_id       uuid unique references public.cotizaciones (id),
  servicio_id         uuid references public.servicios (id),
  descripcion         text not null,
  fecha               date not null default app.hoy(),
  aplicantes          int not null default 1 check (aplicantes > 0),
  honorarios          numeric(14, 2) not null default 0 check (honorarios >= 0),   -- ya con descuento, IVA incluido
  descuento           numeric(14, 2) not null default 0 check (descuento >= 0),
  iva_pct             numeric(5, 2) not null default 19,
  terceros            numeric(14, 2) not null default 0 check (terceros >= 0),     -- derechos consulares (COP)
  total               numeric(14, 2) generated always as (honorarios + terceros) stored,
  forma_pago          text,
  vendedor            text,
  referido_por        text,
  estado              text not null default 'activa' check (estado in ('activa', 'pagada', 'anulada')),
  origen              text not null default 'manual' check (origen in ('cotizacion', 'manual', 'carga_inicial')),
  motivo_anulacion    text,
  notas               text,
  creado_por          uuid references public.perfiles (id) default auth.uid(),
  creado_en           timestamptz not null default now()
);
create index ventas_oficina on public.ventas (oficina_id, fecha desc);
create index ventas_cliente on public.ventas (cliente_id);

-- Plan de pagos (cuotas). El estado de cada cuota se calcula con lo pagado.
create table public.venta_cuotas (
  id           uuid primary key default gen_random_uuid(),
  venta_id     uuid not null references public.ventas (id) on delete cascade,
  numero       int not null,
  descripcion  text not null,
  fecha        date not null,
  valor        numeric(14, 2) not null check (valor >= 0),
  unique (venta_id, numero)
);

-- Abonos de los clientes
create table public.abonos (
  id                 uuid primary key default gen_random_uuid(),
  venta_id           uuid not null references public.ventas (id),
  oficina_id         uuid not null references public.oficinas (id),
  fecha              date not null default app.hoy(),
  valor              numeric(14, 2) not null check (valor > 0),
  a_honorarios       numeric(14, 2) not null default 0,
  a_terceros         numeric(14, 2) not null default 0,
  medio_id           uuid references public.medios_pago (id),
  medio              text,
  cuenta             text,
  referencia         text,
  recibido_por       text,
  comision_medio     numeric(14, 2) not null default 0,
  fondo_incentivos   numeric(14, 2) not null default 0,
  estado             text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion   text,
  notas              text,
  creado_por         uuid references public.perfiles (id) default auth.uid(),
  creado_en          timestamptz not null default now(),
  check (a_honorarios + a_terceros = valor)
);
create index abonos_venta on public.abonos (venta_id);
create index abonos_oficina on public.abonos (oficina_id, fecha desc);

-- Saldos por venta (respeta la seguridad de quien consulta)
create view public.ventas_saldo with (security_invoker = on) as
select v.*,
       coalesce(a.pag_hon, 0) as pagado_honorarios,
       coalesce(a.pag_ter, 0) as pagado_terceros,
       coalesce(a.pag_hon, 0) + coalesce(a.pag_ter, 0) as pagado,
       case when v.estado = 'anulada' then 0
            else v.total - coalesce(a.pag_hon, 0) - coalesce(a.pag_ter, 0) end as saldo,
       coalesce(a.fondo, 0) as fondo_incentivos,
       a.ultimo_abono,
       (select min(c.fecha) from venta_cuotas c
         where c.venta_id = v.id
           and (select coalesce(sum(c2.valor), 0) from venta_cuotas c2 where c2.venta_id = v.id and c2.numero <= c.numero)
               > coalesce(a.pag_hon, 0) + coalesce(a.pag_ter, 0)) as proxima_cuota
from ventas v
left join lateral (
  select sum(a_honorarios) pag_hon, sum(a_terceros) pag_ter, sum(fondo_incentivos) fondo, max(fecha) ultimo_abono
  from abonos where venta_id = v.id and estado = 'activo'
) a on true;

-- ---------------------------------------------------------------------
-- Funciones de ventas y abonos
-- ---------------------------------------------------------------------
create or replace function app.actualizar_estado_venta(p_venta uuid) returns void
language sql security definer set search_path = public as $$
  update ventas v set estado = case when s.saldo <= 0 then 'pagada' else 'activa' end
  from (select v2.total - coalesce((select sum(valor) from abonos where venta_id = v2.id and estado = 'activo'), 0) as saldo
        from ventas v2 where v2.id = p_venta) s
  where v.id = p_venta and v.estado <> 'anulada'
$$;

create or replace function app.crear_cuotas(p_venta uuid, p_cuotas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; r jsonb; n int := 0; acum numeric := 0; tot int;
begin
  select * into v from ventas where id = p_venta;
  if v.id is null or not app.puede_ver_oficina(v.oficina_id) then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  delete from venta_cuotas where venta_id = p_venta;
  if p_cuotas is null or jsonb_array_length(p_cuotas) = 0 then
    insert into venta_cuotas (venta_id, numero, descripcion, fecha, valor) values (p_venta, 1, 'Pago total', v.fecha, v.total);
    return;
  end if;
  tot := jsonb_array_length(p_cuotas);
  for r in select e from jsonb_array_elements(p_cuotas) e loop
    n := n + 1;
    insert into venta_cuotas (venta_id, numero, descripcion, fecha, valor)
    values (p_venta, n, coalesce(nullif(r ->> 'descripcion', ''), 'Pago ' || n),
            coalesce(nullif(r ->> 'fecha', '')::date, v.fecha),
            case when n = tot then v.total - acum else (r ->> 'valor')::numeric end);
    acum := acum + coalesce((r ->> 'valor')::numeric, 0);
  end loop;
  if (select sum(valor) from venta_cuotas where venta_id = p_venta) <> v.total
     or exists (select 1 from venta_cuotas where venta_id = p_venta and valor < 0) then
    raise exception 'Las cuotas no suman el total de la venta' using errcode = 'P0001';
  end if;
end $$;

-- Venta manual (o de carga inicial). p: oficina_id, cliente_id, servicio_id?, descripcion?, fecha?, aplicantes?,
-- honorarios, descuento?, terceros?, forma_pago?, vendedor?, referido_por?, notas?, cuotas?[], origen?, referencia_externa?
create or replace function public.crear_venta(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; v_oficina uuid := (p ->> 'oficina_id')::uuid; c clientes%rowtype; s servicios%rowtype;
  v_fecha date := coalesce(nullif(p ->> 'fecha', '')::date, app.hoy());
  v_origen text := coalesce(nullif(p ->> 'origen', ''), 'manual');
begin
  if not app.habilitado() or not app.puede_ver_oficina(v_oficina) then
    raise exception 'No tienes acceso a esta oficina' using errcode = '42501';
  end if;
  if v_origen not in ('manual', 'carga_inicial') then
    raise exception 'Origen no válido' using errcode = 'P0001';
  end if;
  select * into c from clientes where id = (p ->> 'cliente_id')::uuid;
  if c.id is null then raise exception 'Elige el cliente' using errcode = 'P0001'; end if;
  if nullif(p ->> 'servicio_id', '') is not null then
    select * into s from servicios where id = (p ->> 'servicio_id')::uuid;
  end if;
  if coalesce((p ->> 'honorarios')::numeric, 0) + coalesce((p ->> 'terceros')::numeric, 0) <= 0 then
    raise exception 'La venta debe tener un valor' using errcode = 'P0001';
  end if;
  insert into ventas (oficina_id, numero, referencia_externa, cliente_id, empresa_id, servicio_id, descripcion, fecha,
                      aplicantes, honorarios, descuento, iva_pct, terceros, forma_pago, vendedor, referido_por, origen, notas)
  values (v_oficina,
          app.siguiente_consecutivo(v_oficina, coalesce(s.abreviatura, 'VTA'), c.nombres, c.apellidos, v_fecha),
          nullif(p ->> 'referencia_externa', ''), c.id, c.empresa_id, s.id,
          coalesce(nullif(p ->> 'descripcion', ''), s.nombre, 'Venta'), v_fecha,
          coalesce(nullif(p ->> 'aplicantes', '')::int, 1),
          coalesce((p ->> 'honorarios')::numeric, 0), coalesce(nullif(p ->> 'descuento', '')::numeric, 0),
          coalesce(s.iva_pct, app.config_num('iva_pct'), 19),
          coalesce(nullif(p ->> 'terceros', '')::numeric, 0),
          nullif(p ->> 'forma_pago', ''), nullif(p ->> 'vendedor', ''),
          coalesce(nullif(p ->> 'referido_por', ''), c.referido_por), v_origen, nullif(p ->> 'notas', ''))
  returning id into v_id;
  perform app.crear_cuotas(v_id, p -> 'cuotas');
  return v_id;
end $$;

-- Venta desde una cotización aceptada (toma totales y cronograma)
create or replace function public.venta_desde_cotizacion(p_cotizacion uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare q cotizaciones%rowtype; v_id uuid; v_serv uuid; v_desc text; v_aplic int;
begin
  select * into q from cotizaciones where id = p_cotizacion;   -- RLS
  if q.id is null then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
  if q.estado <> 'aceptada' then raise exception 'Solo una cotización aceptada se convierte en venta' using errcode = 'P0001'; end if;
  select id into v_id from ventas where cotizacion_id = q.id;
  if v_id is not null then return v_id; end if;
  select i.servicio_id, i.descripcion, greatest(1, i.cantidad::int) into v_serv, v_desc, v_aplic
  from cotizacion_items i where i.cotizacion_id = q.id order by i.es_principal desc, i.orden limit 1;
  insert into ventas (oficina_id, numero, cliente_id, empresa_id, cotizacion_id, servicio_id, descripcion, fecha, aplicantes,
                      honorarios, descuento, iva_pct, terceros, forma_pago, origen)
  values (q.oficina_id, q.consecutivo, q.cliente_id, q.empresa_id, q.id, v_serv, v_desc, app.hoy(), v_aplic,
          q.total_honorarios, q.descuento_total, coalesce(app.config_num('iva_pct'), 19), q.total_terceros,
          (select nombre from formas_pago where id = q.forma_pago_id), 'cotizacion')
  returning id into v_id;
  perform app.crear_cuotas(v_id, (select jsonb_agg(jsonb_build_object(
      'descripcion', x ->> 'descripcion', 'fecha', (app.hoy() + (x ->> 'dias')::int)::text, 'valor', x ->> 'valor'))
    from jsonb_array_elements(q.cronograma) x));
  return v_id;
end $$;

-- Registrar abono. p: venta_id, valor, fecha?, aplica_a? ('honorarios'|'terceros'), medio_id?, medio?, cuenta?, referencia?, recibido_por?, notas?
create or replace function public.registrar_abono(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v ventas_saldo%rowtype; v_valor numeric := (p ->> 'valor')::numeric; v_hon numeric; v_ter numeric;
  v_falta_hon numeric; m medios_pago%rowtype; v_com numeric := 0; v_fondo numeric := 0; v_id uuid;
begin
  select * into v from ventas_saldo where id = (p ->> 'venta_id')::uuid;   -- RLS
  if v.id is null then raise exception 'Venta no encontrada' using errcode = 'P0002'; end if;
  if v.estado = 'anulada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Escribe el valor del abono' using errcode = 'P0001'; end if;
  if v_valor > v.saldo then
    raise exception 'El abono (%) supera el saldo de la venta (%)', to_char(v_valor, 'FM999G999G999'), to_char(v.saldo, 'FM999G999G999')
      using errcode = 'P0001';
  end if;
  v_falta_hon := v.honorarios - v.pagado_honorarios;
  if p ->> 'aplica_a' = 'terceros' then
    v_ter := least(v_valor, v.terceros - v.pagado_terceros); v_hon := v_valor - v_ter;
  else
    v_hon := least(v_valor, v_falta_hon); v_ter := v_valor - v_hon;     -- primero honorarios (P9)
  end if;
  if nullif(p ->> 'medio_id', '') is not null then
    select * into m from medios_pago where id = (p ->> 'medio_id')::uuid;
    v_com := round(v_valor * coalesce(m.comision_pct, 0) / 100 + coalesce(m.valor_fijo, 0), 0);
  end if;
  if v.empresa_id is null then
    v_fondo := round(greatest(v_hon - v_com, 0) / (1 + v.iva_pct / 100) * coalesce(app.config_num('fondo_incentivos_pct'), 10) / 100, 0);
  end if;
  insert into abonos (venta_id, oficina_id, fecha, valor, a_honorarios, a_terceros, medio_id, medio, cuenta, referencia,
                      recibido_por, comision_medio, fondo_incentivos, notas)
  values (v.id, v.oficina_id, coalesce(nullif(p ->> 'fecha', '')::date, app.hoy()), v_valor, v_hon, v_ter,
          m.id, coalesce(nullif(p ->> 'medio', ''), m.nombre), nullif(p ->> 'cuenta', ''), nullif(p ->> 'referencia', ''),
          nullif(p ->> 'recibido_por', ''), v_com, v_fondo, nullif(p ->> 'notas', ''))
  returning id into v_id;
  perform app.actualizar_estado_venta(v.id);
  return v_id;
end $$;

create or replace function public.anular_abono(p_id uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
declare v_venta uuid;
begin
  if not app.ve_costos() then raise exception 'Solo Admin o Finanzas pueden anular abonos' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  update abonos set estado = 'anulado', motivo_anulacion = p_motivo where id = p_id and estado = 'activo'
  returning venta_id into v_venta;
  if v_venta is null then raise exception 'Abono no encontrado o ya anulado' using errcode = 'P0001'; end if;
  perform app.actualizar_estado_venta(v_venta);
end $$;

create or replace function public.anular_venta(p_id uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not app.ve_costos() then raise exception 'Solo Admin o Finanzas pueden anular ventas' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  if exists (select 1 from abonos where venta_id = p_id and estado = 'activo') then
    raise exception 'Primero anula los abonos de esta venta (o registra una devolución)' using errcode = 'P0001';
  end if;
  update ventas set estado = 'anulada', motivo_anulacion = p_motivo where id = p_id and estado <> 'anulada';
  if not found then raise exception 'Venta no encontrada o ya anulada' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Acreedores: deudas de la empresa y sus pagos
-- ---------------------------------------------------------------------
create table public.deudas (
  id                uuid primary key default gen_random_uuid(),
  acreedor          text not null,
  tipo              text not null default 'Banco'
                    check (tipo in ('Banco', 'Tarjeta de crédito', 'Socio', 'Particular', 'Proveedor', 'Leasing', 'Otro')),
  documento         text,
  concepto          text,
  fecha_prestamo    date,
  valor_original    numeric(14, 2),
  fecha_corte       date not null default app.hoy(),
  saldo_inicial     numeric(14, 2) not null check (saldo_inicial >= 0),
  tasa_pct          numeric(7, 4) not null default 0 check (tasa_pct >= 0),
  tasa_periodo      text not null default 'Mensual' check (tasa_periodo in ('Mensual', 'Anual', 'Sin interés')),
  cuota_valor       numeric(14, 2),
  cuotas_restantes  int,
  proxima_fecha     date,
  asignacion        text not null default 'oficina' check (asignacion in ('oficina', 'repartida', 'general')),
  soporte           text,
  notas             text,
  estado            text not null default 'activa' check (estado in ('activa', 'pagada', 'anulada')),
  creado_por        uuid references public.perfiles (id) default auth.uid(),
  creado_en         timestamptz not null default now()
);

-- Qué parte asume cada oficina (oficina = 100%, repartida = porcentajes, general = sin filas)
create table public.deuda_reparto (
  deuda_id    uuid not null references public.deudas (id) on delete cascade,
  oficina_id  uuid not null references public.oficinas (id),
  pct         numeric(6, 2) not null check (pct > 0 and pct <= 100),
  primary key (deuda_id, oficina_id)
);

create table public.deuda_pagos (
  id                uuid primary key default gen_random_uuid(),
  deuda_id          uuid not null references public.deudas (id),
  fecha             date not null default app.hoy(),
  capital           numeric(14, 2) not null default 0 check (capital >= 0),
  intereses         numeric(14, 2) not null default 0 check (intereses >= 0),
  otros             numeric(14, 2) not null default 0 check (otros >= 0),
  total             numeric(14, 2) generated always as (capital + intereses + otros) stored,
  oficina_pago_id   uuid references public.oficinas (id),
  medio             text,
  cuenta            text,
  referencia        text,
  notas             text,
  estado            text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion  text,
  creado_por        uuid references public.perfiles (id) default auth.uid(),
  creado_en         timestamptz not null default now(),
  check (capital + intereses + otros > 0)
);
create index deuda_pagos_deuda on public.deuda_pagos (deuda_id, fecha desc);

create or replace function app.puede_ver_deuda(p_deuda uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.ve_costos() and (
    app.ve_todo()
    or exists (select 1 from deuda_reparto r where r.deuda_id = p_deuda and app.puede_ver_oficina(r.oficina_id)))
$$;

create view public.deudas_saldo with (security_invoker = on) as
select d.*,
       coalesce(p.capital, 0) as capital_pagado,
       coalesce(p.intereses, 0) as intereses_pagados,
       greatest(d.saldo_inicial - coalesce(p.capital, 0), 0) as saldo,
       p.ultimo_pago,
       (select coalesce(jsonb_agg(jsonb_build_object('oficina_id', r.oficina_id, 'codigo', o.codigo, 'pct', r.pct) order by o.codigo), '[]')
          from deuda_reparto r join oficinas o on o.id = r.oficina_id where r.deuda_id = d.id) as reparto
from deudas d
left join lateral (
  select sum(capital) capital, sum(intereses) intereses, max(fecha) ultimo_pago
  from deuda_pagos where deuda_id = d.id and estado = 'activo'
) p on true;

-- Crear o editar deuda. p: id?, acreedor, tipo?, documento?, concepto?, fecha_prestamo?, valor_original?, fecha_corte?,
-- saldo_inicial, tasa_pct?, tasa_periodo?, cuota_valor?, cuotas_restantes?, proxima_fecha?, asignacion,
-- oficina_id? (si asignación = oficina), reparto? [{oficina_id, pct}] (si repartida), soporte?, notas?
create or replace function public.guardar_deuda(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_asig text := coalesce(p ->> 'asignacion', 'oficina'); r jsonb; v_suma numeric := 0;
begin
  if not app.ve_costos() then raise exception 'Solo Admin o Finanzas manejan acreedores' using errcode = '42501'; end if;
  if coalesce(trim(p ->> 'acreedor'), '') = '' then raise exception 'Escribe el acreedor' using errcode = 'P0001'; end if;
  if v_asig = 'general' and not app.ve_todo() then
    raise exception 'Solo quien ve todas las oficinas puede registrar deudas generales' using errcode = '42501';
  end if;
  if v_asig = 'oficina' then
    if nullif(p ->> 'oficina_id', '') is null then raise exception 'Elige la oficina que asume la deuda' using errcode = 'P0001'; end if;
    if not app.puede_ver_oficina((p ->> 'oficina_id')::uuid) then raise exception 'No tienes acceso a esa oficina' using errcode = '42501'; end if;
  elsif v_asig = 'repartida' then
    for r in select e from jsonb_array_elements(coalesce(p -> 'reparto', '[]')) e loop
      if not app.puede_ver_oficina((r ->> 'oficina_id')::uuid) then raise exception 'No tienes acceso a una de las oficinas' using errcode = '42501'; end if;
      v_suma := v_suma + (r ->> 'pct')::numeric;
    end loop;
    if v_suma <> 100 then raise exception 'Los porcentajes del reparto deben sumar 100%% (suman %%%)', v_suma using errcode = 'P0001'; end if;
  end if;

  if v_id is null then
    insert into deudas (acreedor, saldo_inicial) values (trim(p ->> 'acreedor'), 0) returning id into v_id;
  elsif not app.puede_ver_deuda(v_id) then
    raise exception 'Deuda no encontrada' using errcode = 'P0002';
  end if;
  update deudas set
    acreedor = trim(p ->> 'acreedor'), tipo = coalesce(nullif(p ->> 'tipo', ''), 'Banco'),
    documento = nullif(p ->> 'documento', ''), concepto = nullif(p ->> 'concepto', ''),
    fecha_prestamo = nullif(p ->> 'fecha_prestamo', '')::date, valor_original = nullif(p ->> 'valor_original', '')::numeric,
    fecha_corte = coalesce(nullif(p ->> 'fecha_corte', '')::date, app.hoy()),
    saldo_inicial = coalesce(nullif(p ->> 'saldo_inicial', '')::numeric, 0),
    tasa_pct = coalesce(nullif(p ->> 'tasa_pct', '')::numeric, 0),
    tasa_periodo = coalesce(nullif(p ->> 'tasa_periodo', ''), 'Mensual'),
    cuota_valor = nullif(p ->> 'cuota_valor', '')::numeric, cuotas_restantes = nullif(p ->> 'cuotas_restantes', '')::int,
    proxima_fecha = nullif(p ->> 'proxima_fecha', '')::date, asignacion = v_asig,
    soporte = nullif(p ->> 'soporte', ''), notas = nullif(p ->> 'notas', '')
  where id = v_id;
  delete from deuda_reparto where deuda_id = v_id;
  if v_asig = 'oficina' then
    insert into deuda_reparto values (v_id, (p ->> 'oficina_id')::uuid, 100);
  elsif v_asig = 'repartida' then
    insert into deuda_reparto select v_id, (e ->> 'oficina_id')::uuid, (e ->> 'pct')::numeric
    from jsonb_array_elements(p -> 'reparto') e;
  end if;
  return v_id;
end $$;

create or replace function app.actualizar_estado_deuda(p_deuda uuid) returns void
language sql security definer set search_path = public as $$
  update deudas d set estado = case when d.saldo_inicial - coalesce((select sum(capital) from deuda_pagos
                                    where deuda_id = d.id and estado = 'activo'), 0) <= 0 then 'pagada' else 'activa' end
  where d.id = p_deuda and d.estado <> 'anulada'
$$;

-- Registrar pago de una deuda. p: deuda_id, fecha?, capital, intereses?, otros?, oficina_pago_id?, medio?, cuenta?, referencia?, notas?
create or replace function public.registrar_pago_deuda(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare d deudas_saldo%rowtype; v_id uuid; v_cap numeric := coalesce(nullif(p ->> 'capital', '')::numeric, 0);
begin
  select * into d from deudas_saldo where id = (p ->> 'deuda_id')::uuid;
  if d.id is null or not app.puede_ver_deuda(d.id) then raise exception 'Deuda no encontrada' using errcode = 'P0002'; end if;
  if d.estado = 'anulada' then raise exception 'La deuda está anulada' using errcode = 'P0001'; end if;
  if v_cap > d.saldo then
    raise exception 'El abono a capital (%) supera el saldo de la deuda (%)', to_char(v_cap, 'FM999G999G999'), to_char(d.saldo, 'FM999G999G999')
      using errcode = 'P0001';
  end if;
  if nullif(p ->> 'oficina_pago_id', '') is not null and not app.puede_ver_oficina((p ->> 'oficina_pago_id')::uuid) then
    raise exception 'No tienes acceso a esa oficina' using errcode = '42501';
  end if;
  insert into deuda_pagos (deuda_id, fecha, capital, intereses, otros, oficina_pago_id, medio, cuenta, referencia, notas)
  values (d.id, coalesce(nullif(p ->> 'fecha', '')::date, app.hoy()), v_cap,
          coalesce(nullif(p ->> 'intereses', '')::numeric, 0), coalesce(nullif(p ->> 'otros', '')::numeric, 0),
          nullif(p ->> 'oficina_pago_id', '')::uuid, nullif(p ->> 'medio', ''), nullif(p ->> 'cuenta', ''),
          nullif(p ->> 'referencia', ''), nullif(p ->> 'notas', ''))
  returning id into v_id;
  perform app.actualizar_estado_deuda(d.id);
  return v_id;
end $$;

create or replace function public.anular_pago_deuda(p_id uuid, p_motivo text) returns void
language plpgsql security invoker set search_path = public as $$
declare v_deuda uuid;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  select deuda_id into v_deuda from deuda_pagos where id = p_id and estado = 'activo';
  if v_deuda is null or not app.puede_ver_deuda(v_deuda) then raise exception 'Pago no encontrado o ya anulado' using errcode = 'P0001'; end if;
  update deuda_pagos set estado = 'anulado', motivo_anulacion = p_motivo where id = p_id;
  perform app.actualizar_estado_deuda(v_deuda);
end $$;

-- ---------------------------------------------------------------------
-- Carga inicial (Excel CARGA-INICIAL-SAFE-BSO.xlsx), todo o nada
-- p: { fecha_corte, deudas:[...], pagos_deudas:[{acreedor,...}], ventas:[{ref, oficina, nombres, apellidos, documento,
--      celular, correo, servicio, ...}], abonos:[{ref, ...}] }
-- ---------------------------------------------------------------------
create or replace function public.importar_carga_inicial(p jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; v_id uuid; v_of uuid; v_cli uuid; v_serv uuid; n_d int := 0; n_pd int := 0; n_v int := 0; n_a int := 0; n_c int := 0;
  mapa_deudas jsonb := '{}'; mapa_ventas jsonb := '{}'; v_fila int;
begin
  if not app.es_admin() then raise exception 'Solo un administrador puede hacer la carga inicial' using errcode = '42501'; end if;
  if nullif(p ->> 'fecha_corte', '') is not null and app.es_admin_general() then
    update configuracion set valor = to_jsonb(p ->> 'fecha_corte') where clave = 'fecha_corte';
  end if;

  v_fila := 1;
  for r in select e from jsonb_array_elements(coalesce(p -> 'deudas', '[]')) e loop
    v_fila := v_fila + 1;
    begin
      v_id := public.guardar_deuda(r || jsonb_build_object(
        'fecha_corte', coalesce(nullif(r ->> 'fecha_corte', ''), p ->> 'fecha_corte'),
        'oficina_id', (select id from oficinas where codigo = r ->> 'oficina'),
        'reparto', (select coalesce(jsonb_agg(x), '[]') from (
            select jsonb_build_object('oficina_id', (select id from oficinas where codigo = 'BOG'), 'pct', (r ->> 'pct_bog')::numeric) x
            where coalesce((r ->> 'pct_bog')::numeric, 0) > 0
            union all
            select jsonb_build_object('oficina_id', (select id from oficinas where codigo = 'BAQ'), 'pct', (r ->> 'pct_baq')::numeric)
            where coalesce((r ->> 'pct_baq')::numeric, 0) > 0) t)));
    exception when others then
      raise exception 'Hoja Deudas, fila %: %', v_fila, sqlerrm using errcode = 'P0001';
    end;
    mapa_deudas := mapa_deudas || jsonb_build_object(lower(trim(r ->> 'acreedor')), v_id);
    n_d := n_d + 1;
  end loop;

  v_fila := 1;
  for r in select e from jsonb_array_elements(coalesce(p -> 'pagos_deudas', '[]')) e loop
    v_fila := v_fila + 1;
    v_id := coalesce((mapa_deudas ->> lower(trim(r ->> 'acreedor')))::uuid,
                     (select id from deudas where lower(acreedor) = lower(trim(r ->> 'acreedor')) and estado <> 'anulada' limit 1));
    if v_id is null then
      raise exception 'Hoja Pagos de deudas, fila %: no encuentro la deuda de «%»', v_fila, r ->> 'acreedor' using errcode = 'P0001';
    end if;
    begin
      perform public.registrar_pago_deuda(r || jsonb_build_object('deuda_id', v_id,
        'oficina_pago_id', (select id from oficinas where codigo = r ->> 'oficina')));
    exception when others then
      raise exception 'Hoja Pagos de deudas, fila %: %', v_fila, sqlerrm using errcode = 'P0001';
    end;
    n_pd := n_pd + 1;
  end loop;

  v_fila := 1;
  for r in select e from jsonb_array_elements(coalesce(p -> 'ventas', '[]')) e loop
    v_fila := v_fila + 1;
    select id into v_of from oficinas where codigo = coalesce(nullif(r ->> 'oficina', ''), 'BOG');
    if v_of is null then raise exception 'Hoja Ventas, fila %: oficina no válida', v_fila using errcode = 'P0001'; end if;
    -- Cliente: se busca por correo, documento o celular en esa oficina; si no existe se crea
    select id into v_cli from clientes
    where oficina_id = v_of and (
      (nullif(r ->> 'correo', '') is not null and lower(correo) = lower(r ->> 'correo'))
      or (nullif(r ->> 'documento', '') is not null and documento = r ->> 'documento')
      or (nullif(regexp_replace(coalesce(r ->> 'celular', ''), '\D', '', 'g'), '') is not null
          and regexp_replace(coalesce(celular, ''), '\D', '', 'g') = regexp_replace(r ->> 'celular', '\D', '', 'g')))
    limit 1;
    if v_cli is null then
      if coalesce(trim(r ->> 'nombres'), '') = '' or coalesce(trim(r ->> 'apellidos'), '') = '' then
        raise exception 'Hoja Ventas, fila %: faltan nombres y apellidos del cliente', v_fila using errcode = 'P0001';
      end if;
      insert into clientes (oficina_id, nombres, apellidos, documento, correo, celular, referido_por, estado_proceso, fecha_inicio)
      values (v_of, trim(r ->> 'nombres'), trim(r ->> 'apellidos'), nullif(r ->> 'documento', ''), nullif(r ->> 'correo', ''),
              nullif(r ->> 'celular', ''), nullif(r ->> 'referido_por', ''), coalesce(nullif(r ->> 'estado_proceso', ''), 'Registrado'),
              coalesce(nullif(r ->> 'fecha', '')::date, app.hoy()))
      returning id into v_cli;
      n_c := n_c + 1;
    end if;
    select id into v_serv from servicios where abreviatura = upper(trim(coalesce(r ->> 'servicio', '')));
    begin
      v_id := public.crear_venta(r || jsonb_build_object('oficina_id', v_of, 'cliente_id', v_cli, 'servicio_id', v_serv,
        'origen', 'carga_inicial', 'referencia_externa', r ->> 'ref',
        'descripcion', coalesce(nullif(r ->> 'descripcion', ''), (select nombre from servicios where id = v_serv), 'Servicio ' || coalesce(r ->> 'servicio', ''))));
    exception when others then
      raise exception 'Hoja Ventas, fila %: %', v_fila, sqlerrm using errcode = 'P0001';
    end;
    if nullif(r ->> 'ref', '') is not null then
      mapa_ventas := mapa_ventas || jsonb_build_object(r ->> 'ref', v_id);
    end if;
    n_v := n_v + 1;
  end loop;

  v_fila := 1;
  for r in select e from jsonb_array_elements(coalesce(p -> 'abonos', '[]')) e loop
    v_fila := v_fila + 1;
    v_id := coalesce((mapa_ventas ->> (r ->> 'ref'))::uuid,
                     (select id from ventas where referencia_externa = r ->> 'ref' order by creado_en desc limit 1));
    if v_id is null then
      raise exception 'Hoja Abonos, fila %: no encuentro la venta N.º %', v_fila, r ->> 'ref' using errcode = 'P0001';
    end if;
    begin
      perform public.registrar_abono(r || jsonb_build_object('venta_id', v_id));
    exception when others then
      raise exception 'Hoja Abonos, fila %: %', v_fila, sqlerrm using errcode = 'P0001';
    end;
    n_a := n_a + 1;
  end loop;

  return jsonb_build_object('deudas', n_d, 'pagos_deudas', n_pd, 'ventas', n_v, 'clientes_nuevos', n_c, 'abonos', n_a);
end $$;

grant execute on function public.crear_venta(jsonb), public.venta_desde_cotizacion(uuid), public.registrar_abono(jsonb),
  public.anular_abono(uuid, text), public.anular_venta(uuid, text), public.guardar_deuda(jsonb),
  public.registrar_pago_deuda(jsonb), public.anular_pago_deuda(uuid, text), public.importar_carga_inicial(jsonb) to authenticated;
grant select on public.ventas_saldo, public.deudas_saldo to authenticated;

-- =====================================================================
-- Seguridad y auditoría
-- =====================================================================
alter table public.ventas         enable row level security;
alter table public.venta_cuotas   enable row level security;
alter table public.abonos         enable row level security;
alter table public.deudas         enable row level security;
alter table public.deuda_reparto  enable row level security;
alter table public.deuda_pagos    enable row level security;

-- Ventas y abonos: por oficina. No se borran (solo se anulan).
create policy ver on public.ventas for select to authenticated using (app.puede_ver_oficina(oficina_id));
create policy crear on public.ventas for insert to authenticated with check (app.puede_ver_oficina(oficina_id));
create policy editar on public.ventas for update to authenticated
  using (app.puede_ver_oficina(oficina_id)) with check (app.puede_ver_oficina(oficina_id));
create policy oficina on public.venta_cuotas for select to authenticated
  using (exists (select 1 from ventas v where v.id = venta_id and app.puede_ver_oficina(v.oficina_id)));
create policy ver on public.abonos for select to authenticated using (app.puede_ver_oficina(oficina_id));
create policy crear on public.abonos for insert to authenticated with check (app.puede_ver_oficina(oficina_id));
create policy editar on public.abonos for update to authenticated
  using (app.ve_costos() and app.puede_ver_oficina(oficina_id)) with check (app.puede_ver_oficina(oficina_id));

-- Acreedores: solo Admin y Finanzas; cada oficina ve solo las deudas que asume; las generales solo quien ve todo
create policy ver on public.deudas for select to authenticated using (app.puede_ver_deuda(id) or (creado_por = auth.uid() and app.ve_costos()));
create policy crear on public.deudas for insert to authenticated with check (app.ve_costos());
create policy editar on public.deudas for update to authenticated
  using (app.puede_ver_deuda(id) or (creado_por = auth.uid() and app.ve_costos())) with check (app.ve_costos());
create policy ver on public.deuda_reparto for select to authenticated using (app.puede_ver_deuda(deuda_id));
create policy escribir on public.deuda_reparto for all to authenticated
  using (app.ve_costos() and app.puede_ver_oficina(oficina_id)) with check (app.ve_costos() and app.puede_ver_oficina(oficina_id));
create policy ver on public.deuda_pagos for select to authenticated using (app.puede_ver_deuda(deuda_id));
create policy crear on public.deuda_pagos for insert to authenticated with check (app.puede_ver_deuda(deuda_id));
create policy editar on public.deuda_pagos for update to authenticated
  using (app.puede_ver_deuda(deuda_id)) with check (app.puede_ver_deuda(deuda_id));

create trigger auditar after insert or update or delete on public.ventas      for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.abonos      for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.deudas      for each row execute function app.auditar();
create trigger auditar after insert or update or delete on public.deuda_pagos for each row execute function app.auditar();

grant execute on all functions in schema app to authenticated;
revoke execute on function app.actualizar_vencidas() from authenticated;
