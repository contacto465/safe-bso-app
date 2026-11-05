-- SAFE BSO MIGRATION · FASE 3: ventas, abonos, cartera, deudas (acreedores) y carga inicial
-- Pegar todo en Supabase → SQL Editor → pestaña nueva (＋) → Run. Solo una vez.
-- Incluye también el tiempo estimado del catálogo (se puede repetir sin problema).

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
