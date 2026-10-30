'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin } from '@/lib/auth';

const esquema = z.object({
  id: z.string().optional(),
  nombre: z.string().trim().min(2, 'Escribe un nombre'),
  tipo: z.enum(['plataforma', 'transferencia', 'efectivo', 'datafono', 'internacional', 'otro']),
  comision_pct: z.coerce.number().min(0).max(50),
  valor_fijo: z.coerce.number().min(0),
  iva_sobre_comision: z.boolean(),
  monedas: z.array(z.enum(['COP', 'USD', 'CAD', 'EUR'])).min(1, 'Elige al menos una moneda'),
  oficina_id: z.string().optional(),
  instrucciones: z.string().optional(),
  activo: z.boolean(),
});

export async function guardarMedioPago(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requerirAdmin();
  const r = esquema.safeParse({
    id: fd.get('id') || undefined,
    nombre: fd.get('nombre'),
    tipo: fd.get('tipo'),
    comision_pct: fd.get('comision_pct') || 0,
    valor_fijo: fd.get('valor_fijo') || 0,
    iva_sobre_comision: fd.get('iva_sobre_comision') === 'on',
    monedas: fd.getAll('monedas'),
    oficina_id: fd.get('oficina_id') || undefined,
    instrucciones: fd.get('instrucciones') || undefined,
    activo: fd.get('activo') === 'on',
  });
  if (!r.success) return { error: r.error.issues[0].message };
  const { id, oficina_id, ...fila } = r.data;
  const supabase = await createClient();
  const datos = { ...fila, oficina_id: oficina_id ?? null };
  const { error } = id ? await supabase.from('medios_pago').update(datos).eq('id', id) : await supabase.from('medios_pago').insert(datos);
  if (error) return { error: mensajeError(error) };
  revalidatePath('/configuracion/medios-pago');
  return { ok: true };
}
