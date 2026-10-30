'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdminGeneral } from '@/lib/auth';

const txt = z.string().trim().optional().transform((v) => v || null);

export async function guardarEmpresa(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requerirAdminGeneral();
  const r = z.object({
    razon_social: z.string().trim().min(2), nit: txt,
    responsable_iva: z.enum(['si', 'no', '']).transform((v) => (v === '' ? null : v === 'si')),
    color_primario: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')).transform((v) => v || null),
    color_acento: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')).transform((v) => v || null),
    tipografia: txt,
  }).safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: 'Revisa los datos: los colores van en formato #RRGGBB.' };
  const supabase = await createClient();
  const { error } = await supabase.from('empresa').update({ ...r.data, actualizado_en: new Date().toISOString() }).eq('id', 1);
  if (error) return { error: mensajeError(error) };
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function guardarOficina(_: unknown, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requerirAdminGeneral();
  const r = z.object({
    id: z.string().optional(),
    codigo: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'El código son 3 letras (ej. BOG)'),
    nombre: z.string().trim().min(2, 'Escribe el nombre'),
    ciudad: z.string().trim().min(2, 'Escribe la ciudad'),
    direccion: txt, telefono: txt, correo: txt, responsable: txt,
  }).safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  const { id, ...fila } = r.data;
  const supabase = await createClient();
  const { error } = id ? await supabase.from('oficinas').update(fila).eq('id', id) : await supabase.from('oficinas').insert(fila);
  if (error) return { error: mensajeError(error) };
  revalidatePath('/configuracion/oficinas');
  return { ok: true };
}
