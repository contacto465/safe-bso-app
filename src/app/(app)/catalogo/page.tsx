import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parametrosPrecio } from '@/lib/catalogo';
import { calcularMargen, formatoMoneda } from '@/lib/precios';
import { Encabezado, Insignia, Vacio, TIPO_SERVICIO } from '@/components/ui';

export const metadata: Metadata = { title: 'Catálogo de servicios' };

type Fila = {
  id: string; tipo: string; nombre: string; abreviatura: string; moneda: string; precio: number; iva_pct: number;
  activo: boolean; forma_pago_id: string | null; recargo_gestion: number;
  categorias_servicio: { nombre: string } | null; formas_pago: { nombre: string } | null;
  servicio_costos?: { tipo: 'fijo' | 'variable'; valor: number }[];
};

export default async function Catalogo({ searchParams }: {
  searchParams: Promise<{ tipo?: string; q?: string; inactivos?: string; sin_forma?: string }>;
}) {
  const f = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  const params = await parametrosPrecio();

  const columnas = `id, tipo, nombre, abreviatura, moneda, precio, iva_pct, activo, forma_pago_id, recargo_gestion,
    categorias_servicio(nombre), formas_pago(nombre)${s.veCostos ? ', servicio_costos(tipo, valor)' : ''}`;
  let q = supabase.from('servicios').select(columnas).order('tipo').order('nombre');
  if (f.tipo && ['principal', 'adicional', 'tercero'].includes(f.tipo)) q = q.eq('tipo', f.tipo);
  if (!f.inactivos) q = q.eq('activo', true);
  if (f.sin_forma) q = q.is('forma_pago_id', null).neq('tipo', 'tercero');
  if (f.q) q = q.or(`nombre.ilike.%${f.q.replace(/[%,()]/g, '')}%,abreviatura.ilike.%${f.q.replace(/[%,()]/g, '')}%`);
  const { data, error } = await q.returns<Fila[]>();

  const filtro = (k: string, v?: string) => {
    const u = new URLSearchParams(Object.entries(f).filter(([, x]) => x) as [string, string][]);
    if (v) u.set(k, v); else u.delete(k);
    return `/catalogo?${u}`;
  };

  return (
    <>
      <Encabezado
        titulo="Catálogo de servicios"
        descripcion="Servicios principales, adicionales y pagos a terceros, con su precio, forma de pago y margen real."
        acciones={s.esAdmin && (
          <>
            <Link href="/catalogo/importar" className="btn-secundario">Cargar desde archivo</Link>
            <Link href="/catalogo/nuevo" className="btn-primario">Nuevo servicio</Link>
          </>
        )}
      />
      <div className="tarjeta space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {[['', 'Todos'], ['principal', 'Principales'], ['adicional', 'Adicionales'], ['tercero', 'Pagos a terceros']].map(([v, t]) => (
            <Link key={v} href={filtro('tipo', v)} aria-current={(f.tipo ?? '') === v ? 'true' : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${(f.tipo ?? '') === v ? 'bg-marca text-white' : 'bg-superficie-2 text-suave'}`}>{t}</Link>
          ))}
          <form className="ml-auto flex gap-2" action="/catalogo">
            {f.tipo && <input type="hidden" name="tipo" value={f.tipo} />}
            <label className="sr-only" htmlFor="buscar">Buscar</label>
            <input id="buscar" name="q" defaultValue={f.q} placeholder="Buscar nombre o abreviatura" className="campo w-60" />
            <button className="btn-secundario">Buscar</button>
          </form>
          <Link href={filtro('inactivos', f.inactivos ? undefined : '1')} className="text-sm font-semibold text-info underline">
            {f.inactivos ? 'Ocultar inactivos' : 'Ver inactivos'}
          </Link>
        </div>

        {error && <p role="alert" className="text-sm text-peligro">{error.message}</p>}
        {!data?.length ? (
          <Vacio>
            Aún no hay servicios {f.tipo ? 'de este tipo' : ''}.{' '}
            {s.esAdmin && <Link href="/catalogo/importar" className="font-bold underline">Carga tu lista desde un archivo</Link>}
          </Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[820px]">
              <thead>
                <tr>
                  <th>Servicio</th><th>Tipo</th><th>Forma de pago</th><th className="text-right">Precio</th>
                  {s.veCostos && <><th className="text-right">Costos</th><th className="text-right">Utilidad*</th><th className="text-right">Margen*</th></>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((x) => {
                  const m = s.veCostos ? calcularMargen({
                    precio: Number(x.precio), ivaPct: Number(x.iva_pct), comisionPct: params.comisionPct, fondoPct: params.fondoPct,
                    aplicaFondo: x.tipo !== 'tercero', costos: (x.servicio_costos ?? []).map((c) => ({ tipo: c.tipo, valor: Number(c.valor) })),
                  }) : null;
                  const t = TIPO_SERVICIO[x.tipo];
                  return (
                    <tr key={x.id} className={x.activo ? '' : 'opacity-50'}>
                      <td>
                        <span className="font-bold">{x.nombre}</span> <span className="text-suave">· {x.abreviatura}</span>
                        {x.categorias_servicio && <span className="block text-xs text-suave">{x.categorias_servicio.nombre}</span>}
                      </td>
                      <td><Insignia tono={t.tono}>{t.texto}</Insignia></td>
                      <td>{x.tipo === 'tercero' ? <span className="text-suave">—</span> : x.formas_pago?.nombre ?? <Insignia tono="peligro">Falta</Insignia>}</td>
                      <td className="text-right font-semibold">
                        {formatoMoneda(Number(x.precio), x.moneda)}
                        {x.tipo === 'tercero' && Number(x.recargo_gestion) > 0 && <span className="block text-xs text-suave">+ {formatoMoneda(Number(x.recargo_gestion), x.moneda)} gestión</span>}
                      </td>
                      {m && <>
                        <td className="text-right">{formatoMoneda(m.costosFijos + m.costosVariables, x.moneda)}</td>
                        <td className={`text-right font-bold ${m.utilidad < 0 ? 'text-peligro' : ''}`}>{x.tipo === 'tercero' ? '—' : formatoMoneda(m.utilidad, x.moneda)}</td>
                        <td className="text-right">{x.tipo === 'tercero' ? '—' : `${m.margenPct.toLocaleString('es-CO')}%`}</td>
                      </>}
                      <td className="text-right">{s.esAdmin && <Link href={`/catalogo/${x.id}`} className="font-bold text-info underline">Editar</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {s.veCostos && <p className="mt-3 text-xs text-suave">* Utilidad y margen suponiendo pago por plataforma ({params.comisionPct}%) y descontando el fondo del {params.fondoPct}%.</p>}
          </div>
        )}
      </div>
    </>
  );
}
