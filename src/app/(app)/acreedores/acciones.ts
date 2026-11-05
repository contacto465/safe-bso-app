'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirCostos } from '@/lib/auth';

export type Resultado = { error?: string; ok?: boolean };

const opcional = z.string().trim().optional();
const deudaEsquema = z.object({
  id: opcional,
  acreedor: z.string().trim().min(2, 'Escribe el acreedor'),
  tipo: z.enum(['Banco', 'Tarjeta de crédito', 'Socio', 'Particular', 'Proveedor', 'Leasing', 'Otro']),
  documento: opcional, concepto: opcional, fecha_prestamo: opcional, valor_original: opcional,
  fecha_corte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de corte'),
  saldo_inicial: z.coerce.number().min(0, 'El saldo no puede ser negativo'),
  tasa_pct: z.coerce.number().min(0).default(0),
  tasa_periodo: z.enum(['Mensual', 'Anual', 'Sin interés']),
  cuota_valor: opcional, cuotas_restantes: opcional, proxima_fecha: opcional,
  asignacion: z.enum(['oficina', 'repartida', 'general']),
  oficina_id: opcional,
  reparto: z.array(z.object({ oficina_id: z.string().uuid(), pct: z.coerce.number() })).default([]),
  soporte: opcional, notas: opcional,
});

export async function guardarDeuda(datos: unknown): Promise<Resultado> {
  await requerirCostos();
  const r = deudaEsquema.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0].message };
  const p = { ...r.data, reparto: r.data.reparto.filter((x) => x.pct > 0) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guardar_deuda', { p });
  if (error) return { error: mensajeError(error) };
  revalidatePath('/acreedores');
  redirect(`/acreedores/${data}?guardada=1`);
}

const pagoEsquema = z.object({
  deuda_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida'),
  capital: z.coerce.number().min(0),
  intereses: z.coerce.number().min(0),
  otros: z.coerce.number().min(0),
  oficina_pago_id: z.string().uuid().or(z.literal('')).optional(),
  medio: opcional, cuenta: opcional, referencia: opcional, notas: opcional,
});

const limpiar = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) =>
  [k, ['capital', 'intereses', 'otros'].includes(k) ? String(v).replace(/[.\s$]/g, '').replace(',', '.') || '0' : v]));

export async function registrarPagoDeuda(_: Resultado | null, fd: FormData): Promise<Resultado> {
  await requerirCostos();
  const r = pagoEsquema.safeParse(limpiar(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  if (r.data.capital + r.data.intereses + r.data.otros <= 0) return { error: 'Escribe el abono a capital y/o los intereses' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('registrar_pago_deuda', { p: r.data });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/acreedores/${r.data.deuda_id}`);
  revalidatePath('/acreedores');
  return { ok: true };
}

export async function anularPagoDeuda(id: string, deudaId: string, motivo: string): Promise<Resultado> {
  await requerirCostos();
  const supabase = await createClient();
  const { error } = await supabase.rpc('anular_pago_deuda', { p_id: id, p_motivo: motivo });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/acreedores/${deudaId}`);
  revalidatePath('/acreedores');
  return { ok: true };
}
