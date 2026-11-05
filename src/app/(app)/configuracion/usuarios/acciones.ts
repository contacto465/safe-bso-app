'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mensajeError, requerirAdminGeneral } from '@/lib/auth';

type Res = { error?: string; ok?: string };

const esquema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre'),
  correo: z.string().trim().toLowerCase().email('Correo no válido'),
  rol: z.enum(['admin', 'finanzas', 'vendedor', 'operaciones']),
  alcance: z.string().min(1, 'Elige el alcance'), // 'todo' o id de oficina
});

async function guardarOficinas(usuarioId: string, alcance: string) {
  const supabase = await createClient();
  await supabase.from('usuario_oficinas').delete().eq('usuario_id', usuarioId);
  if (alcance !== 'todo') {
    const { error } = await supabase.from('usuario_oficinas').insert({ usuario_id: usuarioId, oficina_id: alcance });
    if (error) throw new Error(mensajeError(error));
  }
}

// Invita a un usuario: recibe un correo y con abrir el enlace entra (sin contraseña); luego activa la verificación en dos pasos.
// Después ingresa siempre con «Enviarme el enlace de acceso» en la pantalla de ingreso.
export async function invitarUsuario(_: unknown, fd: FormData): Promise<Res> {
  await requerirAdminGeneral();
  const r = esquema.safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  const supabase = await createClient();

  const [{ count }, { data: max }] = await Promise.all([
    supabase.from('perfiles').select('id', { count: 'exact', head: true }).eq('activo', true),
    supabase.from('configuracion').select('valor').eq('clave', 'max_usuarios').maybeSingle(),
  ]);
  const limite = Number(max?.valor ?? 3);
  if ((count ?? 0) >= limite) return { error: `Ya hay ${limite} usuarios activos. Desactiva uno para invitar a otro.` };

  const admin = createAdminClient();
  const h = await headers();
  const origen = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(r.data.correo, {
    redirectTo: `${origen}/auth/confirmar`,
    data: { nombre: r.data.nombre },
  });
  if (error || !data.user) return { error: error?.message.includes('already') ? 'Ese correo ya tiene una cuenta.' : `No se pudo enviar la invitación: ${error?.message}` };

  const ve_todo = r.data.alcance === 'todo';
  const { error: e2 } = await supabase.from('perfiles').insert({
    id: data.user.id, nombre: r.data.nombre, correo: r.data.correo, rol: r.data.rol, ve_todo,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id); // no deja cuentas a medias
    return { error: mensajeError(e2) };
  }
  try { await guardarOficinas(data.user.id, r.data.alcance); } catch (e) { return { error: (e as Error).message }; }
  revalidatePath('/configuracion/usuarios');
  return { ok: `Invitación enviada a ${r.data.correo}. Con abrir el enlace del correo entra; no necesita contraseña.` };
}

export async function actualizarUsuario(_: unknown, fd: FormData): Promise<Res> {
  const s = await requerirAdminGeneral();
  const id = String(fd.get('id'));
  const r = z.object({ rol: esquema.shape.rol, alcance: esquema.shape.alcance }).safeParse(Object.fromEntries(fd));
  if (!r.success) return { error: r.error.issues[0].message };
  if (id === s.perfil.id && (r.data.rol !== 'admin' || r.data.alcance !== 'todo'))
    return { error: 'No puedes quitarte tus propios permisos de administrador general.' };
  const supabase = await createClient();
  const { error } = await supabase.from('perfiles').update({ rol: r.data.rol, ve_todo: r.data.alcance === 'todo' }).eq('id', id);
  if (error) return { error: mensajeError(error) };
  try { await guardarOficinas(id, r.data.alcance); } catch (e) { return { error: (e as Error).message }; }
  revalidatePath('/configuracion/usuarios');
  return { ok: 'Cambios aplicados de inmediato.' };
}

// Desactivar: deja de ver todo al instante (la base de datos lo bloquea) y no puede volver a ingresar.
export async function cambiarActivo(id: string, activo: boolean): Promise<Res> {
  const s = await requerirAdminGeneral();
  if (id === s.perfil.id) return { error: 'No puedes desactivarte a ti mismo.' };
  const supabase = await createClient();
  const { error } = await supabase.from('perfiles').update({ activo }).eq('id', id);
  if (error) return { error: mensajeError(error) };
  await createAdminClient().auth.admin.updateUserById(id, { ban_duration: activo ? 'none' : '876000h' });
  revalidatePath('/configuracion/usuarios');
  return { ok: activo ? 'Usuario reactivado.' : 'Usuario desactivado. Su información se conserva.' };
}

// Si alguien pierde el celular: borra su verificación en dos pasos para que la active de nuevo al ingresar.
export async function restablecer2FA(id: string): Promise<Res> {
  await requerirAdminGeneral();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id });
  if (error) return { error: error.message };
  for (const f of data.factors) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
  return { ok: 'Verificación restablecida. La configurará de nuevo en su próximo ingreso.' };
}
