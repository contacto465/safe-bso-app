import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado } from '@/components/ui';
import { FormCliente } from '../form';

export const metadata: Metadata = { title: 'Nuevo cliente' };

export default async function NuevoCliente() {
  const s = await requerirSesion();
  const { data: empresas } = await (await createClient()).from('empresas').select('id, razon_social').eq('activa', true).order('razon_social');
  return (
    <>
      <Encabezado titulo="Nuevo cliente" descripcion="Al registrarse entra al embudo y al Control de procesos." migas={[{ href: '/clientes', texto: 'Clientes' }]} />
      <FormCliente oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))} empresas={empresas ?? []} />
    </>
  );
}
