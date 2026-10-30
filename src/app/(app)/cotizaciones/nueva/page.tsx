import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { trmDelDia } from '@/lib/cotizacion-calculo';
import { Encabezado } from '@/components/ui';
import { EditorCotizacion } from '../editor';
import { datosEditor } from '../datos';

export const metadata: Metadata = { title: 'Nueva cotización' };

export default async function NuevaCotizacion({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const s = await requerirSesion();
  const [d, trm] = await Promise.all([datosEditor(), trmDelDia()]);
  return (
    <>
      <Encabezado titulo="Nueva cotización" migas={[{ href: '/cotizaciones', texto: 'Cotizaciones' }]} />
      <EditorCotizacion oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))} {...d} trmUsd={trm} clienteInicial={cliente} />
    </>
  );
}
