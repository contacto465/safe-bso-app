import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { ESTADOS_VENTA, antiguedad, fecha } from '@/lib/formato';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Ventas' };

type Fila = {
  id: string; numero: string; estado: string; fecha: string; descripcion: string; total: number; pagado: number; saldo: number;
  proxima_cuota: string | null; origen: string; oficina_id: string; cliente_id: string;
};

export default async function Ventas({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string; mes?: string }> }) {
  const f = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  let q = supabase.from('ventas_saldo')
    .select('id, numero, estado, fecha, descripcion, total, pagado, saldo, proxima_cuota, origen, oficina_id, cliente_id')
    .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(500);
  if (f.estado && ESTADOS_VENTA[f.estado]) q = q.eq('estado', f.estado);
  if (f.mes && /^\d{4}-\d{2}$/.test(f.mes)) {
    const [a, m] = f.mes.split('-').map(Number);
    q = q.gte('fecha', `${f.mes}-01`).lt('fecha', m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`);
  }
  if (f.q) q = q.ilike('numero', `%${f.q.replace(/[%,()]/g, '')}%`);
  const { data } = await q.returns<Fila[]>();
  const filas = data ?? [];
  const ids = [...new Set(filas.map((v) => v.cliente_id))];
  const { data: cls } = ids.length ? await supabase.from('clientes').select('id, nombres, apellidos').in('id', ids) : { data: [] };
  const nombre = (id: string) => { const c = cls?.find((x) => x.id === id); return c ? `${c.nombres} ${c.apellidos}` : ''; };
  const vigentes = filas.filter((v) => v.estado !== 'anulada');
  const tot = (k: 'total' | 'pagado' | 'saldo') => vigentes.reduce((a, v) => a + Number(v[k]), 0);
  const oficina = (id: string) => s.oficinas.find((o) => o.id === id)?.codigo ?? '';
  const filtros = [['', 'Todas'], ['activa', 'Con saldo'], ['pagada', 'Pagadas'], ['anulada', 'Anuladas']];
  const conservar = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(f.mes ? { mes: f.mes } : {}), ...extra });
    return `/ventas${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <Encabezado titulo="Ventas" descripcion="Cada venta lleva su plan de pagos y sus abonos. Las cotizaciones aceptadas se convierten en venta con un clic."
        acciones={<Link href="/ventas/nueva" className="btn-primario">Registrar venta</Link>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {([['Vendido', 'total'], ['Recibido', 'pagado'], ['Por cobrar', 'saldo']] as const).map(([t, k]) => (
          <div key={k} className="tarjeta">
            <p className="text-xs font-bold uppercase tracking-wide text-suave">{t}{f.mes ? ` · ${f.mes}` : ''}</p>
            <p className="mt-1 text-2xl font-extrabold">{formatoMoneda(tot(k))}</p>
          </div>
        ))}
      </div>
      <div className="tarjeta space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {filtros.map(([v, t]) => (
            <Link key={v} href={conservar(v ? { estado: v } : {})} className={`rounded-full px-3 py-1.5 text-sm font-bold ${(f.estado ?? '') === v ? 'bg-marca text-white' : 'bg-superficie-2 text-suave'}`}>{t}</Link>
          ))}
          <form className="ml-auto flex flex-wrap gap-2">
            {f.estado && <input type="hidden" name="estado" value={f.estado} />}
            <label className="sr-only" htmlFor="mes">Mes</label>
            <input id="mes" name="mes" type="month" defaultValue={f.mes} className="campo w-44" />
            <label className="sr-only" htmlFor="q">Buscar número</label>
            <input id="q" name="q" defaultValue={f.q} placeholder="Buscar número" className="campo w-48" />
            <button className="btn-secundario">Filtrar</button>
          </form>
        </div>
        {!filas.length ? <Vacio>No hay ventas{f.mes || f.estado || f.q ? ' con ese filtro' : ''}. <Link href="/ventas/nueva" className="font-bold underline">Registra una</Link> o conviértela desde una cotización aceptada.</Vacio> : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[900px]">
              <thead><tr><th>Venta</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th className="text-right">Total</th><th className="text-right">Recibido</th><th className="text-right">Saldo</th><th>Próxima cuota</th></tr></thead>
              <tbody>
                {filas.map((v) => {
                  const e = ESTADOS_VENTA[v.estado];
                  const ant = v.estado === 'activa' ? antiguedad(v.proxima_cuota) : null;
                  return (
                    <tr key={v.id}>
                      <td><Link href={`/ventas/${v.id}`} className="font-bold text-info underline">{v.numero}</Link>
                        <span className="block text-xs text-suave">{oficina(v.oficina_id)} · {v.descripcion}{v.origen === 'carga_inicial' ? ' · carga inicial' : ''}</span></td>
                      <td>{nombre(v.cliente_id)}</td>
                      <td>{fecha(v.fecha)}</td>
                      <td><Insignia tono={e.tono}>{e.texto}</Insignia></td>
                      <td className="text-right">{formatoMoneda(Number(v.total))}</td>
                      <td className="text-right">{formatoMoneda(Number(v.pagado))}</td>
                      <td className="text-right font-bold">{formatoMoneda(Number(v.saldo))}</td>
                      <td>{ant ? <><span className="block text-sm">{fecha(v.proxima_cuota)}</span><Insignia tono={ant.tono}>{ant.texto}</Insignia></> : '—'}</td>
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
