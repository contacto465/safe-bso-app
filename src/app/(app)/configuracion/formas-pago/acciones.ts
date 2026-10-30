'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin } from '@/lib/auth';

const esquema = z.object({
  id: z.string().optional(),
  nombre: z.string().trim().min(2, 'Escribe un nombre'),
  descripcion: z.string().optional(),
  cuotas: z.array(z.object({
    numero: z.number().int().positive(),
    porcentaje: z.number().positive('Cada pago debe tener un porcentaje mayor a 0'),
    dias: z.number().int().min(0),
    descripcion: z.string().optional(),
  })).min(1),
});

export async function guardarFormaPago(datos: unknown): Promise<{ error?: string }> {
  await requerirAdmin();
  const r = esquema.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0].message };
  const total = r.data.cuotas.reduce((a, c) => a + c.porcentaje, 0);
  if (Math.abs(total - 100) > 0.001) return { error: `Los porcentajes deben sumar 100% (suman ${total}%).` };
  const supabase = await createClient();
  const { id, ...fila } = r.data;
  const { error } = id
    ? await supabase.from('formas_pago').update(fila).eq('id', id)
    : await supabase.from('formas_pago').insert(fila);
  if (error) return { error: mensajeError(error) };
  revalidatePath('/configuracion/formas-pago');
  return {};
}

export async function archivarFormaPago(id: string, activa: boolean) {
  await requerirAdmin();
  const supabase = await createClient();
  await supabase.from('formas_pago').update({ activa }).eq('id', id);
  revalidatePath('/configuracion/formas-pago');
}
