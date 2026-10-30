'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin, requerirAdminGeneral } from '@/lib/auth';

const LIMITES: Record<string, [number, number]> = {
  max_usuarios: [1, 50], tope_descuento_pct: [0, 100], tope_descuento_empresas_pct: [0, 100],
  vigencia_cotizacion_dias: [1, 365], fondo_incentivos_pct: [0, 100], comision_plataformas_pct: [0, 50],
  iva_pct: [0, 100], devolucion_horas: [0, 720], inactividad_minutos: [5, 480],
};

export async function guardarReglas(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  const s = await requerirAdminGeneral();
  const supabase = await createClient();
  for (const [clave, [min, max]] of Object.entries(LIMITES)) {
    const v = fd.get(clave);
    if (v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return { error: `Valor no válido para ${clave.replaceAll('_', ' ')} (entre ${min} y ${max}).` };
    const { error } = await supabase.from('configuracion')
      .update({ valor: n, actualizado_por: s.perfil.id, actualizado_en: new Date().toISOString() }).eq('clave', clave);
    if (error) return { error: mensajeError(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function crearCategoria(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requerirAdmin();
  const r = z.object({ nombre: z.string().trim().min(2), tipo_proceso: z.string().trim().optional() }).safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: 'Escribe el nombre de la categoría.' };
  const supabase = await createClient();
  const { error } = await supabase.from('categorias_servicio').insert({ nombre: r.data.nombre, tipo_proceso: r.data.tipo_proceso || null });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/configuracion/reglas');
  return { ok: true };
}
