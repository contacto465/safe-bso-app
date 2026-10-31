import 'server-only';
import { createClient } from './supabase/server';

export type Servicio = {
  id: string;
  tipo: 'principal' | 'adicional' | 'tercero';
  nombre: string;
  abreviatura: string;
  descripcion: string | null;
  incluye: string | null;
  tiempo_estimado?: string | null;
  categoria_id: string | null;
  moneda: string;
  precio: number;
  iva_pct: number;
  forma_pago_id: string | null;
  beneficiario: string | null;
  recargo_gestion: number;
  activo: boolean;
};
export type CostoServicio = { id?: string; tipo: 'fijo' | 'variable'; concepto: string; valor: number };
export type FormaPago = { id: string; nombre: string; descripcion: string | null; cuotas: { numero: number; porcentaje: number; dias: number; descripcion?: string }[]; activa: boolean };
export type Categoria = { id: string; nombre: string; tipo_proceso: string | null; activa: boolean };
export type MedioPago = { id: string; nombre: string; tipo: string; comision_pct: number; valor_fijo: number; iva_sobre_comision: boolean; activo: boolean };

export async function parametrosPrecio() {
  const supabase = await createClient();
  const { data } = await supabase.from('configuracion').select('clave, valor')
    .in('clave', ['iva_pct', 'fondo_incentivos_pct', 'comision_plataformas_pct']);
  const v = (k: string, d: number) => Number(data?.find((x) => x.clave === k)?.valor ?? d);
  return { ivaPct: v('iva_pct', 19), fondoPct: v('fondo_incentivos_pct', 10), comisionPct: v('comision_plataformas_pct', 3) };
}

export async function listasCatalogo() {
  const supabase = await createClient();
  const [formas, categorias, medios, adicionales] = await Promise.all([
    supabase.from('formas_pago').select('*').eq('activa', true).order('nombre').returns<FormaPago[]>(),
    supabase.from('categorias_servicio').select('*').eq('activa', true).order('orden').order('nombre').returns<Categoria[]>(),
    supabase.from('medios_pago').select('id, nombre, tipo, comision_pct, valor_fijo, iva_sobre_comision, activo').eq('activo', true).order('orden').returns<MedioPago[]>(),
    supabase.from('servicios').select('id, nombre, abreviatura, tipo, precio, moneda').in('tipo', ['adicional', 'tercero']).eq('activo', true).order('nombre'),
  ]);
  return {
    formas: formas.data ?? [],
    categorias: categorias.data ?? [],
    medios: medios.data ?? [],
    adicionales: (adicionales.data ?? []) as Pick<Servicio, 'id' | 'nombre' | 'abreviatura' | 'tipo' | 'precio' | 'moneda'>[],
  };
}
