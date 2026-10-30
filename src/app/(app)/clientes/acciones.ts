'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirSesion } from '@/lib/auth';

const txt = z.string().trim().optional().transform((v) => v || null);
const esquema = z.object({
  id: z.string().optional(),
  oficina_id: z.string().uuid('Elige la oficina'),
  nombres: z.string().trim().min(2, 'Escribe los nombres'),
  apellidos: z.string().trim().min(2, 'Escribe los apellidos'),
  documento_tipo: z.enum(['CC', 'CE', 'PA', 'PPT', 'NIT', 'OTRO', '']).transform((v) => v || null),
  documento: txt, correo: z.string().trim().email('Correo no válido').or(z.literal('')).transform((v) => v || null),
  celular: txt, pais: txt, ciudad: txt, empresa_id: txt, referido_por: txt,
  categoria: txt, tipo_proceso: txt, estado_proceso: z.string().trim().default('Registrado'), notas: txt,
});

export type EstadoCliente = { error?: string; id?: string } | null;

async function guardar(fd: FormData) {
  await requerirSesion();
  const r = esquema.safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  const { id, ...fila } = r.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from('clientes').update(fila).eq('id', id).select('id').single()
    : supabase.from('clientes').insert(fila).select('id').single();
  const { data, error } = await q;
  if (error) return { error: mensajeError(error) };
  revalidatePath('/clientes');
  return { id: data.id as string };
}

export async function guardarCliente(_: EstadoCliente, fd: FormData): Promise<EstadoCliente> {
  const r = await guardar(fd);
  if (r.error) return r;
  redirect(`/clientes/${r.id}?guardado=1`);
}

// Creación rápida desde el editor de cotizaciones (no redirige)
export async function crearClienteRapido(fd: FormData): Promise<EstadoCliente> {
  return guardar(fd);
}

export async function guardarEmpresa(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requerirSesion();
  const r = z.object({
    id: z.string().optional(), oficina_id: z.string().uuid('Elige la oficina'),
    razon_social: z.string().trim().min(2, 'Escribe la razón social'), nit: txt, pais: txt, sector: txt,
    contacto_nombre: txt, contacto_correo: txt, contacto_celular: txt, notas: txt,
  }).safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  const { id, ...fila } = r.data;
  const supabase = await createClient();
  const { error } = id ? await supabase.from('empresas').update(fila).eq('id', id) : await supabase.from('empresas').insert(fila);
  if (error) return { error: mensajeError(error) };
  revalidatePath('/empresas');
  return { ok: true };
}
