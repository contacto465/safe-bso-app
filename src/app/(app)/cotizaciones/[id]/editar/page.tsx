import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { trmDelDia, type ItemCot } from '@/lib/cotizacion-calculo';
import { Encabezado, Aviso } from '@/components/ui';
import { EditorCotizacion } from '../../editor';
import { datosEditor } from '../../datos';

export const metadata: Metadata = { title: 'Editar cotización' };

export default async function EditarCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requerirSesion();
  const supabase = await createClient();
  const { data: c } = await supabase.from('cotizaciones').select('id, consecutivo, estado, oficina_id, cliente_id, tipo, notas, tasas, cotizacion_items(servicio_id, cantidad, descuento_tipo, descuento_valor, recargo_gestion, orden)').eq('id', id).maybeSingle();
  if (!c) notFound();
  if (['aceptada', 'rechazada', 'anulada'].includes(c.estado)) redirect(`/cotizaciones/${id}`);
  const [d, trm] = await Promise.all([datosEditor(), trmDelDia()]);
  const items = ((c.cotizacion_items ?? []) as (ItemCot & { orden: number })[]).sort((a, b) => a.orden - b.orden)
    .map((i) => ({ servicio_id: i.servicio_id, cantidad: Number(i.cantidad), descuento_tipo: i.descuento_tipo, descuento_valor: Number(i.descuento_valor), recargo_gestion: Number(i.recargo_gestion) }));
  return (
    <>
      <Encabezado titulo={`Editar ${c.consecutivo}`} migas={[{ href: '/cotizaciones', texto: 'Cotizaciones' }, { href: `/cotizaciones/${id}`, texto: c.consecutivo }]} />
      {c.estado !== 'borrador' && <div className="mb-4"><Aviso tipo="alerta">Esta cotización ya se envió: al guardar se crea una versión nueva y queda en borrador hasta que la reenvíes.</Aviso></div>}
      <EditorCotizacion oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))} {...d} trmUsd={trm}
        inicial={{ id: c.id, oficina_id: c.oficina_id, cliente_id: c.cliente_id, tipo: c.tipo, notas: c.notas, tasas: c.tasas as Record<string, number>, items }} />
    </>
  );
}
