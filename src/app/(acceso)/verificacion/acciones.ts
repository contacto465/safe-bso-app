'use server';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

// Registra cada ingreso (quién, cuándo, desde dónde) y marca si es un dispositivo nuevo
export async function registrarIngreso() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const agente = h.get('user-agent');
  const { count } = await supabase
    .from('ingresos')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', user.id)
    .eq('agente', agente ?? '');
  await supabase.from('ingresos').insert({
    usuario_id: user.id,
    ip,
    agente,
    dispositivo_nuevo: (count ?? 0) === 0,
  });
}
