import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { ESTADOS_COTIZACION } from '@/lib/cotizacion-calculo';
import { Encabezado, Aviso, Insignia, Vacio } from '@/components/ui';
import { FormCliente, type Cliente } from '../form';

export const metadata: Metadata = { title: 'Cliente' };

export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string }> }) {
  const { id } = await params;
  const { guardado } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requerirSesion();
  const supabase = await createClient();
  const [{ data: c }, { data: empresas }, { data: cots }] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', id).maybeSingle<Cliente>(),
    supabase.from('empresas').select('id, razon_social').eq('activa', true).order('razon_social'),
    supabase.from('cotizaciones').select('id, consecutivo, version, estado, total, fecha_emision').eq('cliente_id', id).order('creado_en', { ascending: false }),
  ]);
  if (!c) notFound();
  return (
    <>
      <Encabezado titulo={`${c.nombres} ${c.apellidos}`} descripcion={`${c.estado_proceso}${c.tipo_proceso ? ` · ${c.tipo_proceso}` : ''}`}
        migas={[{ href: '/clientes', texto: 'Clientes' }]}
        acciones={<Link href={`/cotizaciones/nueva?cliente=${c.id}`} className="btn-primario">Nueva cotización</Link>} />
      <div className="space-y-5">
        {guardado && <Aviso tipo="ok">Cliente guardado.</Aviso>}
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">Cotizaciones</h2>
          {!cots?.length ? <Vacio>Aún no tiene cotizaciones.</Vacio> : (
            <ul className="divide-y divide-borde text-sm">
              {cots.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/cotizaciones/${q.id}`} className="font-bold text-info underline">{q.consecutivo} · v{q.version}</Link>
                  <span className="flex items-center gap-3">
                    <Insignia tono={ESTADOS_COTIZACION[q.estado].tono}>{ESTADOS_COTIZACION[q.estado].texto}</Insignia>
                    <b>{formatoMoneda(Number(q.total))}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <FormCliente c={c} oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))} empresas={empresas ?? []} />
      </div>
    </>
  );
}
