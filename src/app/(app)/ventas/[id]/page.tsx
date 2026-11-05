import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { ESTADOS_VENTA, fecha, hoyBogota } from '@/lib/formato';
import { Aviso, Encabezado, Insignia, Vacio } from '@/components/ui';
import { FormAbono, BotonAnularAbono, BotonAnularVenta } from './cliente';

export const metadata: Metadata = { title: 'Venta' };
const n = (v: unknown) => Number(v ?? 0);

export default async function VerVenta({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ creada?: string }> }) {
  const { id } = await params;
  const { creada } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requerirSesion();
  const supabase = await createClient();
  const { data: v } = await supabase.from('ventas_saldo').select('*').eq('id', id).maybeSingle();
  if (!v) notFound();
  const [{ data: cl }, { data: cot }, { data: cuotas }, { data: abonos }, { data: medios }] = await Promise.all([
    supabase.from('clientes').select('id, nombres, apellidos').eq('id', v.cliente_id).single(),
    v.cotizacion_id ? supabase.from('cotizaciones').select('id, consecutivo').eq('id', v.cotizacion_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('venta_cuotas').select('*').eq('venta_id', id).order('numero'),
    supabase.from('abonos').select('*').eq('venta_id', id).order('fecha').order('creado_en'),
    supabase.from('medios_pago').select('id, nombre, comision_pct').eq('activo', true).order('orden'),
  ]);
  if (!cl) notFound();
  const oficina = s.oficinas.find((o) => o.id === v.oficina_id)?.nombre ?? '';
  const e = ESTADOS_VENTA[v.estado];
  const hoy = hoyBogota();

  // Estado de cada cuota: se cubren en orden con lo pagado
  const lista = cuotas ?? [];
  const plan = lista.map((c, i) => {
    const antes = lista.slice(0, i).reduce((a, x) => a + n(x.valor), 0);
    const cubierto = Math.max(0, Math.min(n(v.pagado) - antes, n(c.valor)));
    const estado = cubierto >= n(c.valor) ? 'Pagada' : cubierto > 0 ? 'Pago parcial' : c.fecha < hoy ? 'Vencida' : 'Pendiente';
    return { ...c, cubierto, estado };
  });
  const tono = (x: string) => (x === 'Pagada' ? 'ok' : x === 'Vencida' ? 'peligro' : x === 'Pago parcial' ? 'alerta' : 'gris') as 'ok' | 'peligro' | 'alerta' | 'gris';

  return (
    <>
      <Encabezado titulo={v.numero} migas={[{ href: '/ventas', texto: 'Ventas' }]}
        descripcion={`${cl.nombres} ${cl.apellidos} · ${v.descripcion} · ${oficina}`}
        acciones={<Insignia tono={e.tono}>{e.texto}</Insignia>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {creada && <Aviso tipo="ok">Venta registrada. Registra aquí los abonos que el cliente ya pagó.</Aviso>}
          {v.estado === 'anulada' && <Aviso tipo="alerta">Venta anulada: {v.motivo_anulacion}</Aviso>}

          <section className="grid gap-3 sm:grid-cols-3">
            {[['Total', v.total], ['Recibido', v.pagado], ['Saldo', v.saldo]].map(([t, x]) => (
              <div key={String(t)} className="tarjeta">
                <p className="text-xs font-bold uppercase tracking-wide text-suave">{String(t)}</p>
                <p className={`mt-1 text-2xl font-extrabold ${t === 'Saldo' && n(x) > 0 ? 'text-alerta' : ''}`}>{formatoMoneda(n(x))}</p>
              </div>
            ))}
          </section>

          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Plan de pagos</h2>
            <div className="overflow-x-auto">
              <table className="tabla min-w-[560px]">
                <thead><tr><th>#</th><th>Concepto</th><th>Fecha</th><th className="text-right">Valor</th><th className="text-right">Cubierto</th><th>Estado</th></tr></thead>
                <tbody>
                  {plan.map((c) => (
                    <tr key={c.id}>
                      <td>{c.numero}</td><td>{c.descripcion}</td><td>{fecha(c.fecha)}</td>
                      <td className="text-right">{formatoMoneda(n(c.valor))}</td><td className="text-right">{formatoMoneda(c.cubierto)}</td>
                      <td><Insignia tono={tono(c.estado)}>{c.estado}</Insignia></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Abonos</h2>
            {!abonos?.length ? <Vacio>Aún no hay abonos.</Vacio> : (
              <div className="overflow-x-auto">
                <table className="tabla min-w-[760px]">
                  <thead><tr><th>Fecha</th><th>Medio</th><th className="text-right">Valor</th><th className="text-right">A honorarios</th><th className="text-right">A terceros</th>{s.veCostos && <th className="text-right">Fondo 10%</th>}<th></th></tr></thead>
                  <tbody>
                    {abonos.map((a) => (
                      <tr key={a.id} className={a.estado === 'anulado' ? 'opacity-60' : ''}>
                        <td>{fecha(a.fecha)}{a.referencia && <span className="block text-xs text-suave">Ref. {a.referencia}</span>}</td>
                        <td>{a.medio ?? '—'}{a.cuenta && <span className="block text-xs text-suave">{a.cuenta}</span>}</td>
                        <td className={`text-right font-bold ${a.estado === 'anulado' ? 'line-through' : ''}`}>{formatoMoneda(n(a.valor))}</td>
                        <td className="text-right">{formatoMoneda(n(a.a_honorarios))}</td>
                        <td className="text-right">{formatoMoneda(n(a.a_terceros))}</td>
                        {s.veCostos && <td className="text-right">{formatoMoneda(n(a.fondo_incentivos))}</td>}
                        <td>{a.estado === 'anulado'
                          ? <span className="text-xs text-suave">Anulado: {a.motivo_anulacion}</span>
                          : s.veCostos && <BotonAnularAbono id={a.id} ventaId={v.id} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {v.estado === 'activa' && <FormAbono ventaId={v.id} saldo={n(v.saldo)} hoy={hoy} medios={(medios ?? []).map((m) => ({ id: m.id, nombre: m.nombre }))} />}
          <section className="tarjeta space-y-2 text-sm">
            <h2 className="text-base font-extrabold">Detalle</h2>
            <p>Fecha de venta: <b>{fecha(v.fecha)}</b></p>
            <p>Aplicantes: <b>{v.aplicantes}</b></p>
            <p>Honorarios: <b>{formatoMoneda(n(v.honorarios))}</b>{n(v.descuento) > 0 && <> (descuento {formatoMoneda(n(v.descuento))})</>}</p>
            <p>Pagos a terceros: <b>{formatoMoneda(n(v.terceros))}</b> <span className="text-suave">(recibido {formatoMoneda(n(v.pagado_terceros))})</span></p>
            {v.forma_pago && <p>Forma de pago: {v.forma_pago}</p>}
            {v.vendedor && <p>Vendedor: {v.vendedor}</p>}
            {v.referido_por && <p>Referido por: {v.referido_por}</p>}
            {s.veCostos && v.empresa_id === null && <p>Fondo 10% causado: <b>{formatoMoneda(n(v.fondo_incentivos))}</b></p>}
            {v.notas && <p className="text-suave">{v.notas}</p>}
            <p><Link href={`/clientes/${cl.id}`} className="font-semibold text-info underline">Ficha del cliente</Link>
              {cot && <> · <Link href={`/cotizaciones/${cot.id}`} className="font-semibold text-info underline">Cotización {cot.consecutivo}</Link></>}</p>
          </section>
          {s.veCostos && v.estado !== 'anulada' && <BotonAnularVenta id={v.id} />}
        </aside>
      </div>
    </>
  );
}
