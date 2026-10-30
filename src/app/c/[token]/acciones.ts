'use server';
import { createClient } from '@/lib/supabase/server';

export async function responder(token: string, accion: 'aceptar' | 'rechazar', comentario?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: 'Enlace no válido' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('responder_cotizacion', { p_token: token, p_accion: accion, p_comentario: comentario ?? null });
  if (error) return { error: error.message };
  return { estado: data as string };
}
