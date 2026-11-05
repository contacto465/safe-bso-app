import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requerirCostos } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { fecha, hoyBogota } from '@/lib/formato';
import { Aviso, Encabezado, Insignia, Vacio } from '@/components/ui';
import { FormDeuda } from '../form';
import { FormPagoDeuda, BotonAnularPago } from './cliente';

export const metadata: Metadata = { title: 'Deuda' };
const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export default async function VerDeuda({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardada?: string; editar?: string }> }) {
  const { id } = await params;
  const { guardada, editar } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requerirCostos();
  const supabase = await createClient();
  const { data: d } = await supabase.from('deudas_saldo').select('*').eq('id', id).maybeSingle();
  if (!d) notFound();
  const { data: pagos } = await supabase.from('deuda_pagos').select('*').eq('deuda_id', id).order('fecha', { ascending: false }).order('creado_en', { ascending: false });
  const reparto = d.reparto as { oficina_id: string; codigo: string; pct: number }[];
  const oficinas = s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }));
  const activos = (pagos ?? []).filter((p) => p.estado === 'activo');
  const totales = activos.reduce((a, p) => ({ cap: a.cap + n(p.capital), int: a.int + n(p.intereses), otros: a.otros + n(p.otros) }), { cap: 0, int: 0, otros: 0 });

  return (
    <>
      <Encabezado titulo={d.acreedor} migas={[{ href: '/acreedores', texto: 'Deudas y acreedores' }]}
        descripcion={`${d.tipo}${d.concepto ? ` · ${d.concepto}` : ''} · ${d.asignacion === 'general' ? 'General de la empresa' : reparto.map((r) => `${r.codigo} ${Number(r.pct)}%`).join(' · ')}`}
        acciones={<Insignia tono={d.estado === 'pagada' ? 'ok' : 'info'}>{d.estado === 'pagada' ? 'Pagada' : 'Vigente'}</Insignia>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {guardada && <Aviso tipo="ok">Deuda guardada.</Aviso>}
          <section className="grid gap-3 sm:grid-cols-4">
            {[['Saldo inicial', d.saldo_inicial], ['Capital pagado', totales.cap], ['Intereses pagados', totales.int], ['Saldo hoy', d.saldo]].map(([k, v]) => (
              <div key={String(k)} className="tarjeta"><p className="text-xs font-bold uppercase tracking-wide text-suave">{String(k)}</p><p className="mt-1 text-xl font-extrabold">{formatoMoneda(n(v))}</p></div>
            ))}
          </section>
          {reparto.length > 1 && (
            <section className="tarjeta text-sm">
              <h2 className="mb-2 text-base font-extrabold">Parte de cada oficina</h2>
              <ul className="space-y-1">{reparto.map((r) => <li key={r.oficina_id}>{r.codigo}: {Number(r.pct)}% → saldo <b>{formatoMoneda(n(d.saldo) * r.pct / 100)}</b>, intereses pagados {formatoMoneda(totales.int * r.pct / 100)}</li>)}</ul>
            </section>
          )}
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Pagos</h2>
            {!pagos?.length ? <Vacio>Aún no hay pagos registrados.</Vacio> : (
              <div className="overflow-x-auto">
                <table className="tabla min-w-[720px]">
                  <thead><tr><th>Fecha</th><th>Medio</th><th className="text-right">Capital</th><th className="text-right">Intereses</th><th className="text-right">Otros</th><th className="text-right">Total</th><th></th></tr></thead>
                  <tbody>
                    {pagos.map((p) => (
                      <tr key={p.id} className={p.estado === 'anulado' ? 'opacity-60' : ''}>
                        <td>{fecha(p.fecha)}{p.referencia && <span className="block text-xs text-suave">Ref. {p.referencia}</span>}</td>
                        <td>{p.medio ?? '—'}{p.cuenta && <span className="block text-xs text-suave">{p.cuenta}</span>}</td>
                        <td className="text-right">{formatoMoneda(n(p.capital))}</td>
                        <td className="text-right">{formatoMoneda(n(p.intereses))}</td>
                        <td className="text-right">{formatoMoneda(n(p.otros))}</td>
                        <td className={`text-right font-bold ${p.estado === 'anulado' ? 'line-through' : ''}`}>{formatoMoneda(n(p.total))}</td>
                        <td>{p.estado === 'anulado' ? <span className="text-xs text-suave">Anulado: {p.motivo_anulacion}</span> : <BotonAnularPago id={p.id} deudaId={d.id} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {editar ? (
            <FormDeuda veTodo={s.perfil.ve_todo} oficinas={oficinas} inicial={{
              id: d.id, acreedor: d.acreedor, tipo: d.tipo, documento: t(d.documento), concepto: t(d.concepto), fecha_prestamo: t(d.fecha_prestamo),
              valor_original: t(d.valor_original), fecha_corte: t(d.fecha_corte), saldo_inicial: t(d.saldo_inicial), tasa_pct: t(d.tasa_pct),
              tasa_periodo: d.tasa_periodo, cuota_valor: t(d.cuota_valor), cuotas_restantes: t(d.cuotas_restantes), proxima_fecha: t(d.proxima_fecha),
              asignacion: d.asignacion, oficina_id: reparto.length === 1 ? reparto[0].oficina_id : '',
              reparto: Object.fromEntries(reparto.map((r) => [r.oficina_id, String(Number(r.pct))])), soporte: t(d.soporte), notas: t(d.notas),
            }} />
          ) : (
            <section className="tarjeta space-y-1 text-sm">
              <h2 className="mb-2 text-base font-extrabold">Condiciones</h2>
              <p>Fecha de corte: <b>{fecha(d.fecha_corte)}</b>{d.fecha_prestamo && <> · Préstamo del {fecha(d.fecha_prestamo)}</>}{d.valor_original && <> por {formatoMoneda(n(d.valor_original))}</>}</p>
              <p>Interés: <b>{d.tasa_periodo === 'Sin interés' ? 'Sin interés' : `${Number(d.tasa_pct)}% ${String(d.tasa_periodo).toLowerCase()}`}</b></p>
              {d.cuota_valor && <p>Cuota: <b>{formatoMoneda(n(d.cuota_valor))}</b>{d.cuotas_restantes !== null && <> · faltan {d.cuotas_restantes}</>} · próximo pago {fecha(d.proxima_fecha)}</p>}
              {d.soporte && <p>Soporte: {d.soporte}</p>}
              {d.notas && <p className="text-suave">{d.notas}</p>}
              <Link href={`/acreedores/${d.id}?editar=1`} className="mt-2 inline-block font-semibold text-info underline">Editar datos de la deuda</Link>
            </section>
          )}
        </div>
        <aside>
          {d.estado === 'activa' && <FormPagoDeuda deudaId={d.id} hoy={hoyBogota()} saldo={n(d.saldo)} cuota={n(d.cuota_valor)} oficinas={oficinas}
            oficinaDefecto={reparto.length === 1 ? reparto[0].oficina_id : (s.oficinas.find((o) => o.es_principal) ?? s.oficinas[0])?.id ?? ''} />}
        </aside>
      </div>
    </>
  );
}
