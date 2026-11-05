import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirCostos } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatoMoneda } from '@/lib/precios';
import { fecha, hoyBogota, diasEntre } from '@/lib/formato';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Deudas y acreedores' };

type Deuda = {
  id: string; acreedor: string; tipo: string; concepto: string | null; asignacion: string; saldo: number; cuota_valor: number | null;
  proxima_fecha: string | null; intereses_pagados: number; estado: string; tasa_pct: number; tasa_periodo: string;
  reparto: { oficina_id: string; codigo: string; pct: number }[];
};

export default async function Acreedores({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const s = await requerirCostos();
  const supabase = await createClient();
  let q = supabase.from('deudas_saldo').select('id, acreedor, tipo, concepto, asignacion, saldo, cuota_valor, proxima_fecha, intereses_pagados, estado, tasa_pct, tasa_periodo, reparto')
    .neq('estado', 'anulada').order('proxima_fecha', { nullsFirst: false });
  if (ver !== 'todas') q = q.eq('estado', 'activa');
  const { data } = await q.returns<Deuda[]>();
  const deudas = data ?? [];
  const hoy = hoyBogota();

  // Parte de cada oficina (según reparto) y deudas generales
  const partes = s.oficinas.map((o) => ({
    o, total: deudas.reduce((a, d) => a + Number(d.saldo) * (d.reparto.find((r) => r.oficina_id === o.id)?.pct ?? 0) / 100, 0),
  }));
  const generales = deudas.filter((d) => d.asignacion === 'general').reduce((a, d) => a + Number(d.saldo), 0);
  const total = deudas.reduce((a, d) => a + Number(d.saldo), 0);
  const asig = (d: Deuda) => d.asignacion === 'general' ? 'General de la empresa' : d.reparto.map((r) => `${r.codigo} ${Number(r.pct)}%`).join(' · ');

  return (
    <>
      <Encabezado titulo="Deudas y acreedores" descripcion="Lo que la empresa debe. Cada deuda la asume una oficina, se reparte por porcentaje o es general. El capital pagado baja la deuda; los intereses son gasto financiero."
        acciones={<Link href="/acreedores/nueva" className="btn-primario">Registrar deuda</Link>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="tarjeta"><p className="text-xs font-bold uppercase tracking-wide text-suave">Total que se debe</p><p className="mt-1 text-2xl font-extrabold">{formatoMoneda(total)}</p></div>
        {partes.map(({ o, total: t }) => (
          <div key={o.id} className="tarjeta"><p className="text-xs font-bold uppercase tracking-wide text-suave">Asume {o.ciudad}</p><p className="mt-1 text-2xl font-extrabold">{formatoMoneda(t)}</p></div>
        ))}
        {s.perfil.ve_todo && <div className="tarjeta"><p className="text-xs font-bold uppercase tracking-wide text-suave">Generales de la empresa</p><p className="mt-1 text-2xl font-extrabold">{formatoMoneda(generales)}</p></div>}
      </div>
      <div className="tarjeta space-y-4">
        <div className="flex gap-2">
          <Link href="/acreedores" className={`rounded-full px-3 py-1.5 text-sm font-bold ${ver !== 'todas' ? 'bg-marca text-white' : 'bg-superficie-2 text-suave'}`}>Vigentes</Link>
          <Link href="/acreedores?ver=todas" className={`rounded-full px-3 py-1.5 text-sm font-bold ${ver === 'todas' ? 'bg-marca text-white' : 'bg-superficie-2 text-suave'}`}>Incluir pagadas</Link>
        </div>
        {!deudas.length ? <Vacio>No hay deudas registradas. <Link href="/acreedores/nueva" className="font-bold underline">Registra la primera</Link> o cárgalas con el Excel en Configuración → Carga inicial.</Vacio> : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[860px]">
              <thead><tr><th>Acreedor</th><th>Quién la asume</th><th>Tasa</th><th className="text-right">Cuota</th><th>Próximo pago</th><th className="text-right">Intereses pagados</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>
                {deudas.map((d) => {
                  const dias = d.proxima_fecha ? diasEntre(hoy, d.proxima_fecha.slice(0, 10)) : null;
                  return (
                    <tr key={d.id}>
                      <td><Link href={`/acreedores/${d.id}`} className="font-bold text-info underline">{d.acreedor}</Link><span className="block text-xs text-suave">{d.tipo}{d.concepto ? ` · ${d.concepto}` : ''}</span></td>
                      <td>{asig(d)}</td>
                      <td>{d.tasa_periodo === 'Sin interés' ? 'Sin interés' : `${Number(d.tasa_pct)}% ${d.tasa_periodo.toLowerCase()}`}</td>
                      <td className="text-right">{d.cuota_valor ? formatoMoneda(Number(d.cuota_valor)) : '—'}</td>
                      <td>{fecha(d.proxima_fecha)}{dias !== null && d.estado === 'activa' && dias <= 5 && <> <Insignia tono={dias < 0 ? 'peligro' : 'alerta'}>{dias < 0 ? `Vencida ${-dias} d` : dias === 0 ? 'Hoy' : `En ${dias} d`}</Insignia></>}</td>
                      <td className="text-right">{formatoMoneda(Number(d.intereses_pagados))}</td>
                      <td className="text-right font-bold">{d.estado === 'pagada' ? <Insignia tono="ok">Pagada</Insignia> : formatoMoneda(Number(d.saldo))}</td>
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
