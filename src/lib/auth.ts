import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Rol = 'admin' | 'finanzas' | 'vendedor' | 'operaciones';

export type Perfil = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  ve_todo: boolean;
  activo: boolean;
};

export type Oficina = { id: string; codigo: string; nombre: string; ciudad: string; es_principal: boolean };

export type Sesion = {
  perfil: Perfil;
  oficinas: Oficina[]; // oficinas que puede ver
  esAdmin: boolean;
  esAdminGeneral: boolean; // admin + ve todo: gestiona usuarios y configuración
  veCostos: boolean;
};

// Una sola lectura por petición
export const obtenerSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('id, nombre, correo, rol, ve_todo, activo')
    .eq('id', user.id)
    .maybeSingle<Perfil>();
  if (!perfil || !perfil.activo) return null;
  const { data: oficinas } = await supabase
    .from('oficinas')
    .select('id, codigo, nombre, ciudad, es_principal')
    .eq('activa', true)
    .order('es_principal', { ascending: false })
    .returns<Oficina[]>();
  const esAdmin = perfil.rol === 'admin';
  return {
    perfil,
    oficinas: oficinas ?? [],
    esAdmin,
    esAdminGeneral: esAdmin && perfil.ve_todo,
    veCostos: perfil.rol === 'admin' || perfil.rol === 'finanzas',
  };
});

export async function requerirSesion(): Promise<Sesion> {
  const s = await obtenerSesion();
  if (!s) redirect('/ingreso?motivo=sin-acceso');
  return s;
}

export async function requerirAdmin(): Promise<Sesion> {
  const s = await requerirSesion();
  if (!s.esAdmin) redirect('/?aviso=solo-administradores');
  return s;
}

// Admin o Finanzas (costos, utilidad, acreedores)
export async function requerirCostos(): Promise<Sesion> {
  const s = await requerirSesion();
  if (!s.veCostos) redirect('/?aviso=solo-finanzas');
  return s;
}

export async function requerirAdminGeneral(): Promise<Sesion> {
  const s = await requerirSesion();
  if (!s.esAdminGeneral) redirect('/?aviso=solo-administrador-general');
  return s;
}

// Mensaje legible a partir de un error de Postgres/Supabase
export function mensajeError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return 'Error desconocido';
  if (e.code === '23505') return 'Ya existe un registro con ese valor (por ejemplo, la abreviatura).';
  if (e.code === '42501' || /row-level security/i.test(e.message ?? '')) return 'No tienes permiso para esta acción.';
  if (e.code === '23514') return 'Algún valor no cumple las reglas (revisa IVA, precios o abreviatura).';
  return e.message ?? 'Error desconocido';
}
