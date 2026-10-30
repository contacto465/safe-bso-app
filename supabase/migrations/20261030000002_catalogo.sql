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
