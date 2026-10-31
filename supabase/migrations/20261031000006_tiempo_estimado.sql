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
