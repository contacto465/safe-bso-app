'use client';
import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { calcularMargen, formatoMoneda, precioParaMargen, cronograma } from '@/lib/precios';
import { guardarServicio, type EstadoForm } from './acciones';
import type { Servicio, CostoServicio, FormaPago, Categoria, MedioPago } from '@/lib/catalogo';

type Props = {
  servicio?: Servicio;
  costos: CostoServicio[];
  adicionalesSel: string[];
  preciosOficina: { oficina_id: string; precio: number }[];
  oficinas: { id: string; nombre: string }[];
  formas: FormaPago[];
  categorias: Categoria[];
  medios: MedioPago[];
  opcionesAdicionales: { id: string; nombre: string; abreviatura: string; tipo: string; precio: number; moneda: string }[];
  params: { ivaPct: number; fondoPct: number; comisionPct: number };
  veCostos: boolean;
};

const TIPOS = [
  { v: 'principal', t: 'Servicio principal', d: 'Lo que el cliente viene a comprar (ej. Visa Americana).' },
  { v: 'adicional', t: 'Servicio adicional', d: 'Complementa a uno principal o se vende solo (ej. traducción).' },
  { v: 'tercero', t: 'Pago a tercero', d: 'Tarifa de embajada o entidad. No es ingreso, sin IVA ni 10%.' },
] as const;

export function FormServicio(p: Props) {
  const s = p.servicio;
  const [estado, accion, enviando] = useActionState<EstadoForm, FormData>(guardarServicio, null);
  const [tipo, setTipo] = useState<Servicio['tipo']>(s?.tipo ?? 'principal');
  const [precio, setPrecio] = useState<string>(s ? String(s.precio) : '');
  const [iva, setIva] = useState<string>(String(s?.iva_pct ?? p.params.ivaPct));
  const [moneda, setMoneda] = useState(s?.moneda ?? 'COP');
  const [formaPago, setFormaPago] = useState(s?.forma_pago_id ?? '');
  const [costos, setCostos] = useState<CostoServicio[]>(p.costos.length ? p.costos : [{ tipo: 'fijo', concepto: '', valor: 0 }]);
  const [adicionales, setAdicionales] = useState<string[]>(p.adicionalesSel);
  const [medioSim, setMedioSim] = useState<string>(p.medios.find((m) => m.comision_pct > 0)?.id ?? p.medios[0]?.id ?? '');
  const [margenObj, setMargenObj] = useState('40');

  const esTercero = tipo === 'tercero';
  const ivaNum = esTercero ? 0 : Number(iva) || 0;
  const medio = p.medios.find((m) => m.id === medioSim);
  const parametros = {
    ivaPct: ivaNum,
    costos,
    comisionPct: medio ? Number(medio.comision_pct) : p.params.comisionPct,
    comisionFija: medio ? Number(medio.valor_fijo) : 0,
    ivaSobreComision: medio?.iva_sobre_comision ?? false,
    fondoPct: p.params.fondoPct,
    aplicaFondo: !esTercero,
  };
  const m = calcularMargen({ ...parametros, precio: Number(precio) || 0 });
  // Margen con cada medio de pago, para que el precio cubra la comisión
  const porMedio = useMemo(
    () => p.medios.map((md) => ({
      nombre: md.nombre,
      ...calcularMargen({ ...parametros, precio: Number(precio) || 0, comisionPct: Number(md.comision_pct), comisionFija: Number(md.valor_fijo), ivaSobreComision: md.iva_sobre_comision }),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [precio, iva, costos, tipo, p.medios],
  );
  const forma = p.formas.find((f) => f.id === formaPago);
  const err = (k: string) => estado?.campos?.[k] && <p className="mt-1 text-xs font-semibold text-peligro">{estado.campos[k]}</p>;
  const fmt = (n: number) => formatoMoneda(n, moneda);

  const datos = {
    id: s?.id, tipo, moneda, precio: Number(precio) || 0, iva_pct: ivaNum, forma_pago_id: formaPago || undefined,
    costos: costos.filter((c) => c.concepto.trim()),
    adicionales: tipo === 'principal' ? adicionales : [],
    precios_oficina: [], // precios iguales en todas las oficinas
  };

  return (
    <form
      action={(fd) => {
        const base = Object.fromEntries(['nombre', 'abreviatura', 'descripcion', 'incluye', 'tiempo_estimado', 'categoria_id', 'beneficiario', 'recargo_gestion'].map((k) => [k, String(fd.get(k) ?? '')]));
        const completo = new FormData();
        completo.set('datos', JSON.stringify({
          ...datos, ...base,
          categoria_id: base.categoria_id || undefined,
          recargo_gestion: esTercero ? Number(base.recargo_gestion) || 0 : 0,
          activo: fd.get('activo') === 'on',
        }));
        accion(completo);
      }}
      className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="space-y-5">
        {estado?.error && <p role="alert" className="rounded-xl bg-peligro-fondo px-4 py-3 text-sm font-semibold text-peligro">{estado.error}</p>}

        <fieldset className="tarjeta space-y-3">
          <legend className="sr-only">Tipo</legend>
          <p className="etiqueta">Tipo de ítem</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIPOS.map((t) => (
              <label key={t.v} className={`cursor-pointer rounded-xl border p-3 text-sm ${tipo === t.v ? 'border-marca bg-info-fondo' : 'border-borde'}`}>
                <input type="radio" name="tipo" value={t.v} checked={tipo === t.v} onChange={() => setTipo(t.v)} className="mr-2" />
                <span className="font-bold">{t.t}</span>
                <span className="mt-1 block text-xs text-suave">{t.d}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="tarjeta grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div>
            <label className="etiqueta" htmlFor="nombre">Nombre</label>
            <input id="nombre" name="nombre" defaultValue={s?.nombre} required className="campo" />
            {err('nombre')}
          </div>
          <div>
            <label className="etiqueta" htmlFor="abreviatura">Abreviatura</label>
            <input id="abreviatura" name="abreviatura" defaultValue={s?.abreviatura} required maxLength={6}
              className="campo uppercase" placeholder="VA" aria-describedby="abrev-ayuda" />
            <p id="abrev-ayuda" className="mt-1 text-xs text-suave">Va en el consecutivo: BOG-303-<b>VA</b>-MARIAC</p>
            {err('abreviatura')}
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="descripcion">Descripción</label>
            <textarea id="descripcion" name="descripcion" defaultValue={s?.descripcion ?? ''} rows={2} className="campo" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="incluye">Qué incluye (sale en la cotización)</label>
            <textarea id="incluye" name="incluye" defaultValue={s?.incluye ?? ''} rows={3} className="campo" placeholder="Una línea por cada punto" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="tiempo_estimado">Tiempo estimado</label>
            <input id="tiempo_estimado" name="tiempo_estimado" defaultValue={s?.tiempo_estimado ?? ''} className="campo" placeholder="Ej.: 8 a 12 semanas" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="categoria_id">Categoría</label>
            <select id="categoria_id" name="categoria_id" defaultValue={s?.categoria_id ?? ''} className="campo">
              <option value="">Sin categoría</option>
              {p.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input type="checkbox" name="activo" defaultChecked={s?.activo ?? true} className="size-4" /> Activo
          </label>
        </section>

        <section className="tarjeta grid gap-4 sm:grid-cols-3">
          <h2 className="text-base font-extrabold sm:col-span-3">Precio</h2>
          <div>
            <label className="etiqueta" htmlFor="moneda">Moneda</label>
            <select id="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} className="campo">
              {['COP', 'USD', 'CAD', 'EUR'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="precio">{esTercero ? 'Valor de la tarifa' : 'Precio al cliente (IVA incluido)'}</label>
            <input id="precio" type="number" min="0" step="any" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} required className="campo" />
            {err('precio')}
          </div>
          {!esTercero ? (
            <div>
              <label className="etiqueta" htmlFor="iva">IVA (%)</label>
              <input id="iva" type="number" min="0" max="100" step="any" value={iva} onChange={(e) => setIva(e.target.value)} className="campo" />
            </div>
          ) : (
            <div>
              <label className="etiqueta" htmlFor="recargo_gestion">Recargo de gestión</label>
              <input id="recargo_gestion" name="recargo_gestion" type="number" min="0" step="any" defaultValue={s?.recargo_gestion ?? 0} className="campo" />
              <p className="mt-1 text-xs text-suave">Ingreso de SAFE BSO; se puede ajustar en cada cotización.</p>
            </div>
          )}
          {esTercero && (
            <div className="sm:col-span-3">
              <label className="etiqueta" htmlFor="beneficiario">Beneficiario (embajada o entidad)</label>
              <input id="beneficiario" name="beneficiario" defaultValue={s?.beneficiario ?? ''} className="campo" placeholder="Embajada de los Estados Unidos" />
            </div>
          )}
        </section>

        {!esTercero && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Forma de pago</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1">
                <label className="etiqueta" htmlFor="forma_pago_id">Forma de pago de este servicio</label>
                <select id="forma_pago_id" value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className="campo">
                  <option value="">Elige una…</option>
                  {p.formas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
                {err('forma_pago_id')}
              </div>
              <Link href="/configuracion/formas-pago" className="btn-secundario">Crear otra forma</Link>
            </div>
            {forma && Number(precio) > 0 && (
              <ul className="space-y-1 text-sm">
                {cronograma(Number(precio), forma.cuotas, new Date()).map((c) => (
                  <li key={c.numero} className="flex justify-between gap-3 rounded-lg bg-superficie-2 px-3 py-2">
                    <span>{c.descripcion || `Pago ${c.numero}`} · {c.porcentaje}% · {c.dias === 0 ? 'al aceptar' : `a ${c.dias} días`}</span>
                    <span className="font-bold">{fmt(c.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {p.veCostos && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">{esTercero ? 'Costos de gestión' : 'Costos del servicio'}</h2>
            <p className="text-xs text-suave">Fijos: no dependen del caso (asesor, tiempo de oficina). Variables: cambian con cada caso (formularios, envíos, traducciones).</p>
            <div className="space-y-2">
              {costos.map((c, i) => (
                <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)_130px_auto] gap-2">
                  <select aria-label="Tipo de costo" value={c.tipo} className="campo"
                    onChange={(e) => setCostos(costos.map((x, j) => (j === i ? { ...x, tipo: e.target.value as 'fijo' | 'variable' } : x)))}>
                    <option value="fijo">Fijo</option>
                    <option value="variable">Variable</option>
                  </select>
                  <input aria-label="Concepto" placeholder="Concepto" value={c.concepto} className="campo"
                    onChange={(e) => setCostos(costos.map((x, j) => (j === i ? { ...x, concepto: e.target.value } : x)))} />
                  <input aria-label="Valor" type="number" min="0" step="any" value={c.valor || ''} className="campo"
                    onChange={(e) => setCostos(costos.map((x, j) => (j === i ? { ...x, valor: Number(e.target.value) } : x)))} />
                  <button type="button" aria-label="Quitar costo" className="btn-secundario px-3"
                    onClick={() => setCostos(costos.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-secundario" onClick={() => setCostos([...costos, { tipo: 'variable', concepto: '', valor: 0 }])}>Agregar costo</button>
          </section>
        )}

        {tipo === 'principal' && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Adicionales sugeridos</h2>
            <p className="text-xs text-suave">Al cotizar este servicio aparecerán marcados para agregarlos con un clic.</p>
            {p.opcionesAdicionales.length === 0 ? (
              <p className="text-sm text-suave">Aún no hay servicios adicionales ni pagos a terceros en el catálogo.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {p.opcionesAdicionales.map((a) => (
                  <label key={a.id} className="flex items-start gap-2 rounded-lg border border-borde p-2.5 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4" checked={adicionales.includes(a.id)}
                      onChange={(e) => setAdicionales(e.target.checked ? [...adicionales, a.id] : adicionales.filter((x) => x !== a.id))} />
                    <span>
                      <span className="font-semibold">{a.nombre}</span> <span className="text-suave">({a.abreviatura})</span>
                      <span className="block text-xs text-suave">{a.tipo === 'tercero' ? 'Pago a tercero' : 'Adicional'} · {formatoMoneda(a.precio, a.moneda)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar servicio'}</button>
          <Link href="/catalogo" className="btn-secundario">Cancelar</Link>
        </div>
      </div>

      {p.veCostos && (
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Margen real">
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Margen real</h2>
            <div>
              <label className="etiqueta" htmlFor="medio-sim">Si el cliente paga con</label>
              <select id="medio-sim" value={medioSim} onChange={(e) => setMedioSim(e.target.value)} className="campo">
                {p.medios.map((md) => <option key={md.id} value={md.id}>{md.nombre} ({Number(md.comision_pct)}%)</option>)}
              </select>
            </div>
            <dl className="space-y-1.5 text-sm">
              {[
                ['Precio al cliente', m.precio],
                ...(!esTercero ? [['IVA incluido', -m.iva] as const] : []),
                ['Comisión del medio', -m.comision],
                ['Costos fijos', -m.costosFijos],
                ['Costos variables', -m.costosVariables],
                ...(!esTercero ? [[`Fondo ${p.params.fondoPct}%`, -m.fondo] as const] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-suave">{k}</dt>
                  <dd className={Number(v) < 0 ? 'text-peligro' : 'font-semibold'}>{fmt(Number(v))}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-borde pt-2 text-base">
                <dt className="font-extrabold">Utilidad</dt>
                <dd className={`font-extrabold ${m.utilidad < 0 ? 'text-peligro' : 'text-ok'}`}>{fmt(m.utilidad)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-suave">Margen sobre precio sin IVA</dt>
                <dd className="font-bold">{m.margenPct.toLocaleString('es-CO')}%</dd>
              </div>
            </dl>
            {esTercero && <p className="text-xs text-suave">La tarifa no es ingreso de SAFE BSO; la comisión sobre este valor es una pérdida que se reporta aparte.</p>}
          </section>

          {!esTercero && p.medios.length > 1 && (
            <section className="tarjeta space-y-2">
              <h2 className="text-sm font-extrabold">Utilidad según el medio de pago</h2>
              <ul className="space-y-1 text-sm">
                {porMedio.map((x) => (
                  <li key={x.nombre} className="flex justify-between gap-3">
                    <span className="text-suave">{x.nombre}</span>
                    <span className={x.utilidad < 0 ? 'font-bold text-peligro' : 'font-bold'}>{fmt(x.utilidad)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!esTercero && (
            <section className="tarjeta space-y-2">
              <h2 className="text-sm font-extrabold">¿Qué precio necesito?</h2>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="etiqueta" htmlFor="margen-obj">Margen deseado (%)</label>
                  <input id="margen-obj" type="number" min="0" max="95" value={margenObj} onChange={(e) => setMargenObj(e.target.value)} className="campo" />
                </div>
                <button type="button" className="btn-secundario" onClick={() => setPrecio(String(precioParaMargen(parametros, Number(margenObj) || 0)))}>Usar</button>
              </div>
              <p className="text-xs text-suave">Precio mínimo para ese margen: <b>{fmt(precioParaMargen(parametros, Number(margenObj) || 0))}</b> con el medio elegido arriba.</p>
            </section>
          )}
        </aside>
      )}
    </form>
  );
}
