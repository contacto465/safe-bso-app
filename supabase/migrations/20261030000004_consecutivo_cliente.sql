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
