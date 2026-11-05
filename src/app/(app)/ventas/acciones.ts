'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirSesion } from '@/lib/auth';

export type Resultado = { error?: string; ok?: boolean };

const monto = z.coerce.number().min(0, 'No puede ser negativo');
const ventaEsquema = z.object({
  oficina_id: z.string().uuid('Elige la oficina'),
  cliente_id: z.string().uuid('Elige el cliente'),
  servicio_id: z.string().uuid().or(z.literal('')).optional(),
  descripcion: z.string().trim().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida'),
  aplicantes: z.coerce.number().int().min(1, 'Mínimo 1 aplicante'),
  honorarios: monto,
  descuento: monto,
  terceros: monto,
  forma_pago: z.string().trim().optional(),
  vendedor: z.string().trim().optional(),
  referido_por: z.string().trim().optional(),
  notas: z.string().trim().optional(),
  cuotas: z.array(z.object({ descripcion: z.string().trim(), fecha: z.string(), valor: monto })),
});

export async function crearVenta(datos: unknown): Promise<Resultado> {
  await requerirSesion();
  const r = ventaEsquema.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0].message };
  if (r.data.honorarios + r.data.terceros <= 0) return { error: 'Escribe los honorarios o los pagos a terceros' };
  if (r.data.cuotas.length) {
    const suma = r.data.cuotas.reduce((s, c) => s + c.valor, 0);
    if (Math.round(suma) !== Math.round(r.data.honorarios + r.data.terceros)) return { error: 'Las cuotas deben sumar el total de la venta' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('crear_venta', { p: r.data });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/ventas');
  redirect(`/ventas/${data}?creada=1`);
}

export async function ventaDesdeCotizacion(cotizacionId: string): Promise<Resultado> {
  await requerirSesion();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('venta_desde_cotizacion', { p_cotizacion: cotizacionId });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/ventas');
  redirect(`/ventas/${data}?creada=1`);
}

const abonoEsquema = z.object({
  venta_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida'),
  valor: z.coerce.number().positive('Escribe el valor del abono'),
  aplica_a: z.enum(['honorarios', 'terceros']),
  medio_id: z.string().uuid().or(z.literal('')).optional(),
  cuenta: z.string().trim().optional(),
  referencia: z.string().trim().optional(),
  recibido_por: z.string().trim().optional(),
  notas: z.string().trim().optional(),
});

export async function registrarAbono(_: Resultado | null, fd: FormData): Promise<Resultado> {
  await requerirSesion();
  const r = abonoEsquema.safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('registrar_abono', { p: r.data });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/ventas/${r.data.venta_id}`);
  revalidatePath('/ventas');
  revalidatePath('/abonos');
  return { ok: true };
}

export async function anularAbono(id: string, ventaId: string, motivo: string): Promise<Resultado> {
  await requerirSesion();
  const supabase = await createClient();
  const { error } = await supabase.rpc('anular_abono', { p_id: id, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/ventas/${ventaId}`);
  revalidatePath('/abonos');
  return { ok: true };
}

export async function anularVenta(id: string, motivo: string): Promise<Resultado> {
  await requerirSesion();
  const supabase = await createClient();
  const { error } = await supabase.rpc('anular_venta', { p_id: id, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/ventas/${id}`);
  revalidatePath('/ventas');
  return { ok: true };
}
