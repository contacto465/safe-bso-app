'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { calcularCotizacion, type ServicioCot, type ItemCot, type Cuota } from '@/lib/cotizacion-calculo';
import { formatoMoneda } from '@/lib/precios';
import { guardarCotizacion } from './acciones';
import { crearClienteRapido } from '../clientes/acciones';

type ClienteOpt = { id: string; nombre: string; empresa_id: string | null; oficina_id: string };
type Props = {
  oficinas: { id: string; nombre: string }[];
  clientes: ClienteOpt[];
  servicios: ServicioCot[];
  sugeridos: Record<string, string[]>; // principal → adicionales
  formas: Record<string, Cuota[]>;
  topes: { personas: number; empresas: number };
  trmUsd: number | null;
  inicial?: { id: string; oficina_id: string; cliente_id: string; tipo: string; notas: string | null; tasas: Record<string, number>; items: ItemCot[] };
  clienteInicial?: string;
};

export function EditorCotizacion(p: Props) {
  const ini = p.inicial;
  const [oficina, setOficina] = useState(ini?.oficina_id ?? p.clientes.find((c) => c.id === p.clienteInicial)?.oficina_id ?? p.oficinas[0]?.id);
  const [clientes, setClientes] = useState(p.clientes);
  const [cliente, setCliente] = useState(ini?.cliente_id ?? p.clienteInicial ?? '');
  const [tipo, setTipo] = useState(ini?.tipo ?? 'cotizacion');
  const [notas, setNotas] = useState(ini?.notas ?? '');
  const [items, setItems] = useState<ItemCot[]>(ini?.items ?? []);
  const [tasas, setTasas] = useState<Record<string, number>>({ USD: p.trmUsd ?? 0, CAD: 0, EUR: 0, ...(ini?.tasas ?? {}) });
  const [aNombreEmpresa, setANombreEmpresa] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const mapa = useMemo(() => new Map(p.servicios.map((s) => [s.id, s])), [p.servicios]);
  const cli = clientes.find((c) => c.id === cliente);
  const esEmpresa = !!cli?.empresa_id;
  const tope = esEmpresa ? p.topes.empresas : p.topes.personas;
  const principal = items.map((i) => mapa.get(i.servicio_id)).find((s) => s?.tipo === 'principal') ?? mapa.get(items[0]?.servicio_id);
  const cuotas = principal?.forma_pago_id ? p.formas[principal.forma_pago_id] : null;
  const calc = calcularCotizacion(items, mapa, tasas, tope, cuotas ?? null);
  const monedas = [...new Set(items.map((i) => mapa.get(i.servicio_id)!.moneda).filter((m) => m !== 'COP'))];
  const sugerencias = [...new Set(items.flatMap((i) => p.sugeridos[i.servicio_id] ?? []))]
    .filter((id) => !items.some((i) => i.servicio_id === id) && mapa.has(id));
  const resultados = buscar.trim().length < 1 ? [] : p.servicios.filter((s) =>
    `${s.nombre} ${s.abreviatura}`.toLowerCase().includes(buscar.toLowerCase()) && !items.some((i) => i.servicio_id === s.id)).slice(0, 8);

  const agregar = (id: string) => { setItems([...items, { servicio_id: id, cantidad: 1, descuento_tipo: 'pct', descuento_valor: 0 }]); setBuscar(''); };
  const cambiar = (i: number, cambios: Partial<ItemCot>) => setItems(items.map((x, j) => (j === i ? { ...x, ...cambios } : x)));

  function guardar() {
    setError(null);
    if (!cliente) return setError('Elige el cliente.');
    if (!items.length) return setError('Agrega al menos un servicio.');
    if (calc.errores.length) return setError(calc.errores[0]);
    iniciar(async () => {
      const r = await guardarCotizacion({
        id: ini?.id, oficina_id: oficina, cliente_id: cliente, tipo, notas, a_nombre_de_empresa: aNombreEmpresa,
        tasas: Object.fromEntries(Object.entries(tasas).filter(([m, v]) => v > 0 && monedas.includes(m))),
        items: items.map((i) => ({ ...i, recargo_gestion: i.recargo_gestion })),
      });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <section className="tarjeta grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="tipo">Documento</label>
            <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo">
              <option value="cotizacion">Cotización</option><option value="prefactura">Prefactura</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="oficina">Oficina</label>
            <select id="oficina" value={oficina} onChange={(e) => setOficina(e.target.value)} disabled={!!ini} className="campo">
              {p.oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="etiqueta" htmlFor="cliente">Cliente</label>
            <div className="flex flex-wrap gap-2">
              <select id="cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} className="campo min-w-60 flex-1">
                <option value="">Elige…</option>
                {clientes.filter((c) => c.oficina_id === oficina).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn-secundario" onClick={() => setNuevoCliente(!nuevoCliente)}>{nuevoCliente ? 'Cerrar' : 'Cliente nuevo'}</button>
            </div>
            {esEmpresa && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={aNombreEmpresa} onChange={(e) => setANombreEmpresa(e.target.checked)} disabled={!!ini} className="size-4" />
                Emitir a nombre de la empresa (descuento máximo {p.topes.empresas}%)
              </label>
            )}
          </div>
          {nuevoCliente && (
            <form className="grid gap-2 rounded-xl bg-superficie-2 p-3 sm:col-span-3 sm:grid-cols-2"
              action={async (fd) => {
                fd.set('oficina_id', oficina); fd.set('documento_tipo', 'CC');
                const r = await crearClienteRapido(fd);
                if (r?.error) return setError(r.error);
                const nombre = `${fd.get('nombres')} ${fd.get('apellidos')}`;
                setClientes([{ id: r!.id!, nombre, empresa_id: null, oficina_id: oficina }, ...clientes]);
                setCliente(r!.id!); setNuevoCliente(false);
              }}>
              <input name="nombres" required placeholder="Nombres" aria-label="Nombres" className="campo" />
              <input name="apellidos" required placeholder="Apellidos" aria-label="Apellidos" className="campo" />
              <input name="celular" placeholder="Celular / WhatsApp" aria-label="Celular" className="campo" />
              <input name="correo" type="email" placeholder="Correo" aria-label="Correo" className="campo" />
              <button className="btn-primario sm:col-span-2">Crear cliente</button>
            </form>
          )}
        </section>

        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">Servicios</h2>
          <div className="relative">
            <label className="sr-only" htmlFor="buscar-servicio">Agregar servicio</label>
            <input id="buscar-servicio" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Escribe para agregar un servicio (nombre o abreviatura)…" className="campo" autoComplete="off" />
            {resultados.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-borde bg-superficie shadow-lg">
                {resultados.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => agregar(s.id)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-superficie-2">
                      <span><b>{s.nombre}</b> <span className="text-suave">· {s.abreviatura} · {s.tipo === 'tercero' ? 'Pago a tercero' : s.tipo}</span></span>
                      <span>{formatoMoneda(s.precio, s.moneda)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.servicios.length === 0 && <p className="text-sm text-alerta">El catálogo está vacío. <Link className="underline" href="/catalogo/nuevo">Crea primero un servicio</Link>.</p>}

          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="tabla min-w-[700px]">
                <thead><tr><th>Servicio</th><th className="w-20">Cant.</th><th className="w-48">Descuento</th><th className="text-right">Total</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => {
                    const s = mapa.get(it.servicio_id)!;
                    const l = calc.lineas[i];
                    return (
                      <tr key={it.servicio_id}>
                        <td>
                          <b>{s.nombre}</b> <span className="text-suave">· {s.abreviatura}</span>
                          <span className="block text-xs text-suave">
                            {formatoMoneda(s.precio, s.moneda)}{s.moneda !== 'COP' && ` × TRM`}{s.tipo === 'tercero' ? ' · pago a tercero, sin descuento' : ''}
                          </span>
                          {s.tipo === 'tercero' && (
                            <label className="mt-1 flex items-center gap-2 text-xs">Recargo de gestión ({s.moneda})
                              <input type="number" min="0" step="any" className="campo w-28 py-1" style={{ minHeight: 32 }}
                                value={it.recargo_gestion ?? s.recargo_gestion} onChange={(e) => cambiar(i, { recargo_gestion: Number(e.target.value) })} />
                            </label>
                          )}
                        </td>
                        <td><input aria-label="Cantidad" type="number" min="1" step="1" value={it.cantidad} onChange={(e) => cambiar(i, { cantidad: Math.max(1, Number(e.target.value)) })} className="campo" /></td>
                        <td>
                          {s.tipo === 'tercero' ? <span className="text-suave">—</span> : (
                            <div className="flex gap-1">
                              <input aria-label="Descuento" type="number" min="0" step="any" value={it.descuento_valor || ''} placeholder="0"
                                onChange={(e) => cambiar(i, { descuento_valor: Number(e.target.value) })} className={`campo ${l?.descuentoPct > tope ? 'border-peligro' : ''}`} />
                              <select aria-label="Tipo de descuento" value={it.descuento_tipo} onChange={(e) => cambiar(i, { descuento_tipo: e.target.value as 'pct' | 'valor' })} className="campo w-20">
                                <option value="pct">%</option><option value="valor">$</option>
                              </select>
                            </div>
                          )}
                        </td>
                        <td className="text-right font-bold">{formatoMoneda(l?.total ?? 0)}</td>
                        <td><button type="button" aria-label={`Quitar ${s.nombre}`} className="btn-secundario px-3" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {sugerencias.length > 0 && (
            <div className="rounded-xl bg-info-fondo p-3">
              <p className="mb-2 text-sm font-bold text-info">Adicionales sugeridos</p>
              <div className="flex flex-wrap gap-2">
                {sugerencias.map((id) => { const s = mapa.get(id)!; return (
                  <button key={id} type="button" onClick={() => agregar(id)} className="rounded-full border border-info/30 bg-superficie px-3 py-1.5 text-sm font-semibold text-info">
                    + {s.nombre} · {formatoMoneda(s.precio, s.moneda)}
                  </button>
                ); })}
              </div>
            </div>
          )}

          {monedas.length > 0 && (
            <div className="flex flex-wrap gap-3 rounded-xl bg-alerta-fondo p-3">
              {monedas.map((m) => (
                <label key={m} className="text-sm font-semibold text-alerta">TRM {m} (pesos por 1 {m})
                  <input type="number" min="0" step="any" value={tasas[m] || ''} onChange={(e) => setTasas({ ...tasas, [m]: Number(e.target.value) })} className="campo mt-1 w-40" />
                </label>
              ))}
              {monedas.includes('USD') && p.trmUsd && <p className="self-end text-xs text-alerta">TRM oficial de hoy: {formatoMoneda(p.trmUsd)}</p>}
            </div>
          )}
        </section>

        <section className="tarjeta">
          <label className="etiqueta" htmlFor="notas">Notas para el cliente</label>
          <textarea id="notas" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} className="campo" />
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Resumen">
        <section className="tarjeta space-y-2 text-sm">
          <h2 className="text-base font-extrabold">Resumen</h2>
          <div className="flex justify-between"><span className="text-suave">Honorarios</span><span>{formatoMoneda(calc.subtotalHonorarios)}</span></div>
          <div className="flex justify-between"><span className="text-suave">Descuento ({calc.descuentoPct}% · máx. {tope}%)</span><span className={calc.descuentoPct > tope ? 'font-bold text-peligro' : 'text-peligro'}>−{formatoMoneda(calc.descuento)}</span></div>
          <div className="flex justify-between"><span className="text-suave">Pagos a terceros</span><span>{formatoMoneda(calc.terceros)}</span></div>
          <div className="flex justify-between border-t border-borde pt-2 text-lg font-extrabold"><span>Total</span><span>{formatoMoneda(calc.total)}</span></div>
          {calc.cronograma.length > 0 && calc.total > 0 && (
            <div className="space-y-1 border-t border-borde pt-2">
              <p className="etiqueta">Forma de pago {principal?.forma_pago_id ? '' : '(el servicio no tiene; pago total)'}</p>
              {calc.cronograma.map((c) => (
                <div key={c.numero} className="flex justify-between gap-2"><span>{c.descripcion} · {c.fecha.toLocaleDateString('es-CO')}</span><b>{formatoMoneda(c.valor)}</b></div>
              ))}
            </div>
          )}
          {calc.errores.length > 0 && <ul className="list-disc pl-5 text-xs font-semibold text-peligro">{calc.errores.map((e) => <li key={e}>{e}</li>)}</ul>}
          {error && <p role="alert" className="rounded-lg bg-peligro-fondo px-3 py-2 font-semibold text-peligro">{error}</p>}
          <button type="button" onClick={guardar} disabled={pendiente} className="btn-primario w-full">{pendiente ? 'Guardando…' : ini ? 'Guardar cambios' : 'Crear cotización'}</button>
          <p className="text-xs text-suave">Se guarda como borrador. Desde la siguiente pantalla la envías al cliente.</p>
        </section>
      </aside>
    </div>
  );
}
