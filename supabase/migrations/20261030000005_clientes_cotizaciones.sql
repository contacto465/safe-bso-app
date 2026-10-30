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
