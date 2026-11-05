import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { antiguedad, fecha, hoyBogota } from '@/lib/formato';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Abonos y cartera' };
const GRUPOS = ['Al día', '1–30 días', '31–60 días', '61–90 días', 'Más de 90 días'];

export default async function Cartera({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const f = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  const mes = f.mes && /^\d{4}-\d{2}$/.test(f.mes) ? f.mes : hoyBogota().slice(0, 7);
  const [a, m] = mes.split('-').map(Number);
  const fin = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  const [{ data: cartera }, { data: abonos }] = await Promise.all([
    supabase.from('ventas_saldo').select('id, numero, cliente_id, oficina_id, saldo, proxima_cuota').eq('estado', 'activa').gt('saldo', 0).order('proxima_cuota'),
    supabase.from('abonos').select('id, venta_id, oficina_id, fecha, valor, a_honorarios, a_terceros, medio, fondo_incentivos, estado')
      .gte('fecha', `${mes}-01`).lt('fecha', fin).eq('estado', 'activo').order('fecha', { ascending: false }),
  ]);
  const ventasIds = [...new Set((abonos ?? []).map((x) => x.venta_id))];
  const { data: ventasAb } = ventasIds.length ? await supabase.from('ventas').select('id, numero, cliente_id').in('id', ventasIds) : { data: [] };
  const clienteIds = [...new Set([...(cartera ?? []).map((x) => x.cliente_id), ...(ventasAb ?? []).map((x) => x.cliente_id)])];
  const { data: cls } = clienteIds.length ? await supabase.from('clientes').select('id, nombres, apellidos').in('id', clienteIds) : { data: [] };
  const nombre = (id: string) => { const c = cls?.find((x) => x.id === id); return c ? `${c.nombres} ${c.apellidos}` : ''; };
  const oficina = (id: string) => s.oficinas.find((o) => o.id === id)?.codigo ?? '';

  const conAnt = (cartera ?? []).map((v) => ({ ...v, ant: antiguedad(v.proxima_cuota) }));
  const porGrupo = GRUPOS.map((g) => ({ g, total: conAnt.filter((v) => v.ant.grupo === g).reduce((x, v) => x + Number(v.saldo), 0) }));
  const totalCartera = conAnt.reduce((x, v) => x + Number(v.saldo), 0);
  const rec = (abonos ?? []).reduce((x, v) => ({ total: x.total + Number(v.valor), hon: x.hon + Number(v.a_honorarios), ter: x.ter + Number(v.a_terceros), fondo: x.fondo + Number(v.fondo_incentivos) }), { total: 0, hon: 0, ter: 0, fondo: 0 });
  const porMedio = Object.entries((abonos ?? []).reduce<Record<string, number>>((x, v) => ({ ...x, [v.medio ?? 'Sin medio']: (x[v.medio ?? 'Sin medio'] ?? 0) + Number(v.valor) }), {}));

  return (
    <>
      <Encabezado titulo="Abonos y cartera" descripcion="Lo que nos deben los clientes por antigüedad, y lo recibido en el mes. Los abonos se registran desde cada venta."
        acciones={<Link href="/ventas?estado=activa" className="btn-secundario">Ventas con saldo</Link>} />
      <div className="space-y-5">
        <section className="tarjeta space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-extrabold">Cartera por cobrar</h2>
            <p className="text-2xl font-extrabold">{formatoMoneda(totalCartera)}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            {porGrupo.map(({ g, total }) => (
              <div key={g} className={`rounded-xl p-3 ${g === 'Al día' ? 'bg-ok-fondo' : total > 0 ? 'bg-peligro-fondo' : 'bg-superficie-2'}`}>
                <p className="text-xs font-bold text-suave">{g}</p>
                <p className="font-extrabold">{formatoMoneda(total)}</p>
              </div>
            ))}
          </div>
          {!conAnt.length ? <Vacio>No hay saldos por cobrar.</Vacio> : (
            <div className="overflow-x-auto">
              <table className="tabla min-w-[640px]">
                <thead><tr><th>Venta</th><th>Cliente</th><th>Cuota pendiente</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {conAnt.map((v) => (
                    <tr key={v.id}>
                      <td><Link href={`/ventas/${v.id}`} className="font-bold text-info underline">{v.numero}</Link><span className="block text-xs text-suave">{oficina(v.oficina_id)}</span></td>
                      <td>{nombre(v.cliente_id)}</td>
                      <td>{fecha(v.proxima_cuota)} <Insignia tono={v.ant.tono}>{v.ant.texto}</Insignia></td>
                      <td className="text-right font-bold">{formatoMoneda(Number(v.saldo))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="tarjeta space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">Recibido en el mes</h2>
            <form className="flex gap-2">
              <label className="sr-only" htmlFor="mes">Mes</label>
              <input id="mes" name="mes" type="month" defaultValue={mes} className="campo w-44" />
              <button className="btn-secundario">Ver</button>
            </form>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {[['Total recibido', rec.total], ['A honorarios', rec.hon], ['A terceros (embajadas)', rec.ter], ...(s.veCostos ? [['Fondo 10% causado', rec.fondo]] : [])].map(([t, x]) => (
              <div key={String(t)} className="rounded-xl bg-superficie-2 p-3"><p className="text-xs font-bold text-suave">{String(t)}</p><p className="font-extrabold">{formatoMoneda(Number(x))}</p></div>
            ))}
          </div>
          {porMedio.length > 0 && <p className="text-sm text-suave">Por medio: {porMedio.map(([k, x]) => `${k} ${formatoMoneda(x)}`).join(' · ')}</p>}
          {!abonos?.length ? <Vacio>No hay abonos en {mes}.</Vacio> : (
            <div className="overflow-x-auto">
              <table className="tabla min-w-[640px]">
                <thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Medio</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {abonos.map((x) => {
                    const v = ventasAb?.find((y) => y.id === x.venta_id);
                    return (
                      <tr key={x.id}>
                        <td>{fecha(x.fecha)}</td>
                        <td><Link href={`/ventas/${x.venta_id}`} className="font-bold text-info underline">{v?.numero}</Link></td>
                        <td>{v ? nombre(v.cliente_id) : ''}</td>
                        <td>{x.medio ?? '—'}</td>
                        <td className="text-right font-bold">{formatoMoneda(Number(x.valor))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
