'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin } from '@/lib/auth';
import type { CargaInicial } from '@/lib/carga-inicial';

export type ResultadoCarga = { error?: string; resumen?: { deudas: number; pagos_deudas: number; ventas: number; clientes_nuevos: number; abonos: number } };

export async function importarCargaInicial(carga: CargaInicial): Promise<ResultadoCarga> {
  await requerirAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('importar_carga_inicial', { p: carga });
  if (error) return { error: mensajeError(error) };
  for (const r of ['/ventas', '/abonos', '/acreedores', '/clientes']) revalidatePath(r);
  return { resumen: data };
}
