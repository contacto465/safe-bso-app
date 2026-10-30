import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ServicioCot, Cuota } from '@/lib/cotizacion-calculo';

export async function datosEditor() {
  const supabase = await createClient();
  const [{ data: servicios }, { data: ady }, { data: formas }, { data: cfg }, { data: clientes }] = await Promise.all([
    supabase.from('servicios').select('id, tipo, nombre, abreviatura, precio, moneda, iva_pct, recargo_gestion, incluye, forma_pago_id').eq('activo', true).order('nombre'),
    supabase.from('servicio_adicionales').select('principal_id, adicional_id').order('orden'),
    supabase.from('formas_pago').select('id, cuotas'),
    supabase.from('configuracion').select('clave, valor').in('clave', ['tope_descuento_pct', 'tope_descuento_empresas_pct']),
    supabase.from('clientes').select('id, nombres, apellidos, empresa_id, oficina_id').order('creado_en', { ascending: false }).limit(1000),
  ]);
  const sugeridos: Record<string, string[]> = {};
  (ady ?? []).forEach((a) => (sugeridos[a.principal_id] ??= []).push(a.adicional_id));
  const v = (k: string, d: number) => Number(cfg?.find((x) => x.clave === k)?.valor ?? d);
  return {
    servicios: (servicios ?? []).map((s) => ({ ...s, precio: Number(s.precio), iva_pct: Number(s.iva_pct), recargo_gestion: Number(s.recargo_gestion) })) as ServicioCot[],
    sugeridos,
    formas: Object.fromEntries((formas ?? []).map((f) => [f.id, f.cuotas as Cuota[]])),
    topes: { personas: v('tope_descuento_pct', 30), empresas: v('tope_descuento_empresas_pct', 40) },
    clientes: (clientes ?? []).map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, empresa_id: c.empresa_id, oficina_id: c.oficina_id })),
  };
}
