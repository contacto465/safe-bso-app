'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin } from '@/lib/auth';

const num = z.coerce.number().min(0, 'No puede ser negativo');

const esquema = z.object({
  id: z.string().optional(),
  tipo: z.enum(['principal', 'adicional', 'tercero']),
  nombre: z.string().trim().min(2, 'Escribe el nombre del servicio'),
  abreviatura: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'Abreviatura: de 1 a 6 letras o números, sin espacios (ej. VA)'),
  descripcion: z.string().optional(),
  incluye: z.string().optional(),
  categoria_id: z.string().optional(),
  moneda: z.enum(['COP', 'USD', 'CAD', 'EUR']),
  precio: num,
  iva_pct: num.max(100),
  forma_pago_id: z.string().optional(),
  beneficiario: z.string().optional(),
  recargo_gestion: num.optional(),
  activo: z.boolean(),
  costos: z.array(z.object({ tipo: z.enum(['fijo', 'variable']), concepto: z.string(), valor: num })),
  adicionales: z.array(z.string().uuid()),
  precios_oficina: z.array(z.object({ oficina_id: z.string().uuid(), precio: z.union([num, z.literal('')]) })),
});

export type EstadoForm = { error?: string; campos?: Record<string, string> } | null;

export async function guardarServicio(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requerirAdmin();
  let datos: unknown;
  try {
    datos = JSON.parse(String(form.get('datos')));
  } catch {
    return { error: 'No se pudieron leer los datos del formulario.' };
  }
  const r = esquema.safeParse(datos);
  if (!r.success) {
    const campos: Record<string, string> = {};
    r.error.issues.forEach((i) => (campos[String(i.path[0])] ??= i.message));
    return { error: 'Revisa los campos marcados.', campos };
  }
  if (r.data.tipo !== 'tercero' && !r.data.forma_pago_id) {
    return { error: 'Cada servicio debe tener su forma de pago.', campos: { forma_pago_id: 'Elige la forma de pago' } };
  }
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('guardar_servicio', { p: r.data });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/catalogo');
  redirect(`/catalogo/${id}?guardado=1`);
}

export async function cambiarEstadoServicio(id: string, activo: boolean) {
  await requerirAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('servicios').update({ activo }).eq('id', id);
  if (error) throw new Error(mensajeError(error));
  revalidatePath('/catalogo');
}
