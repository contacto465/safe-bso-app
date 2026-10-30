import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { ESTADOS_COTIZACION } from '@/lib/cotizacion-calculo';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Cotizaciones' };

export default async function Cotizaciones({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string }> }) {
  const f = await searchParams;
  await requerirSesion();
  const supabase = await createClient();
  let q = supabase.from('cotizaciones').select('id, consecutivo, version, tipo, estado, total, fecha_emision, fecha_vencimiento, clientes(nombres, apellidos)')
    .order('creado_en', { ascending: false }).limit(300);
  if (f.estado && ESTADOS_COTIZACION[f.estado]) q = q.eq('estado', f.estado);
  if (f.q) q = q.ilike('consecutivo', `%${f.q.replace(/[%,()]/g, '')}%`);
  const { data } = await q;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const filtros = [['', 'Todas'], ['borrador', 'Borradores'], ['enviada', 'Enviadas'], ['por_reenviar', 'Por reenviar'], ['aceptada', 'Aceptadas'], ['rechazada', 'No aceptadas']];

  return (
    <>
      <Encabezado titulo="Cotizaciones y prefacturas" descripcion="Vigencia de 3 días. Al vencer se actualizan solas con los precios vigentes y quedan por reenviar."
        acciones={<Link href="/cotizaciones/nueva" className="btn-primario">Nueva cotización</Link>} />
      <div className="tarjeta space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {filtros.map(([v, t]) => (
            <Link key={v} href={v ? `/cotizaciones?estado=${v}` : '/cotizaciones'} className={`rounded-full px-3 py-1.5 text-sm font-bold ${(f.estado ?? '') === v ? 'bg-marca text-white' : 'bg-superficie-2 text-suave'}`}>{t}</Link>
          ))}
          <form className="ml-auto flex gap-2">
            <label className="sr-only" htmlFor="q">Buscar consecutivo</label>
            <input id="q" name="q" defaultValue={f.q} placeholder="Buscar consecutivo" className="campo w-56" />
            <button className="btn-secundario">Buscar</button>
          </form>
        </div>
        {!data?.length ? <Vacio>No hay cotizaciones. <Link href="/cotizaciones/nueva" className="font-bold underline">Crea la primera</Link></Vacio> : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[760px]">
              <thead><tr><th>Consecutivo</th><th>Cliente</th><th>Estado</th><th>Vence</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {data.map((c) => {
                  const cl = c.clientes as unknown as { nombres: string; apellidos: string };
                  const vencida = c.estado === 'enviada' && c.fecha_vencimiento < hoy;
                  const e = ESTADOS_COTIZACION[c.estado];
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/cotizaciones/${c.id}`} className="font-bold text-info underline">{c.consecutivo}</Link><span className="block text-xs text-suave">{c.tipo === 'prefactura' ? 'Prefactura' : 'Cotización'} · v{c.version}</span></td>
                      <td>{cl.nombres} {cl.apellidos}</td>
                      <td><Insignia tono={vencida ? 'alerta' : e.tono}>{vencida ? 'Vencida' : e.texto}</Insignia></td>
                      <td>{new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-CO')}</td>
                      <td className="text-right font-bold">{formatoMoneda(Number(c.total))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
