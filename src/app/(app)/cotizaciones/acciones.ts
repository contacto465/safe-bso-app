'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirSesion } from '@/lib/auth';

export async function guardarCotizacion(datos: unknown): Promise<{ error?: string }> {
  await requerirSesion();
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('guardar_cotizacion', { p: datos });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/cotizaciones');
  redirect(`/cotizaciones/${id}?guardada=1`);
}

async function rpc(nombre: string, args: Record<string, unknown>, id: string) {
  await requerirSesion();
  const supabase = await createClient();
  const { error } = await supabase.rpc(nombre, args);
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/cotizaciones/${id}`);
  revalidatePath('/cotizaciones');
  return { ok: true };
}

export async function enviarCotizacion(id: string) { return rpc('enviar_cotizacion', { p_id: id }, id); }
export async function actualizarCotizacion(id: string) { return rpc('actualizar_cotizacion', { p_id: id }, id); }
export async function anularCotizacion(id: string, motivo: string) { return rpc('anular_cotizacion', { p_id: id, p_motivo: motivo }, id); }
