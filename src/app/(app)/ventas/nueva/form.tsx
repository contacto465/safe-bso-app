'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatoMoneda } from '@/lib/precios';
import { crearVenta } from '../acciones';

type Opcion = { id: string; nombre: string };
type Cuota = { descripcion: string; fecha: string; valor: string };

const sumarDias = (f: string, d: number) => {
  const x = new Date(f + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10);
};

export function FormVenta({ hoy, oficinas, clientes, servicios, clienteInicial }: {
  hoy: string;
  oficinas: Opcion[];
  clientes: (Opcion & { oficina_id: string })[];
  servicios: (Opcion & { precio: number; moneda: string; forma: string })[];
  clienteInicial?: string;
}) {
  const ini = clientes.find((c) => c.id === clienteInicial);
  const [oficina, setOficina] = useState(ini?.oficina_id ?? oficinas[0]?.id ?? '');
  const [cliente, setCliente] = useState(ini?.id ?? '');
  const [buscar, setBuscar] = useState('');
  const [servicio, setServicio] = useState('');
  const [v, setV] = useState({ descripcion: '', fecha: hoy, aplicantes: '1', honorarios: '', descuento: '', terceros: '', forma_pago: '', vendedor: '', referido_por: '', notas: '' });
  const [cuotas, setCuotas] = useState<Cuota[]>([]);
  const [error, setError] = useState('');
  const [pendiente, iniciar] = useTransition();

  const n = (x: string) => Number(String(x).replace(/\./g, '').replace(',', '.')) || 0;
  const total = n(v.honorarios) + n(v.terceros);
  const sumaCuotas = cuotas.reduce((a, c) => a + n(c.valor), 0);
  const delaOficina = useMemo(() => clientes.filter((c) => c.oficina_id === oficina && c.nombre.toLowerCase().includes(buscar.toLowerCase())), [clientes, oficina, buscar]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  function elegirServicio(id: string) {
    setServicio(id);
    const s = servicios.find((x) => x.id === id);
    if (s) setV((p) => ({ ...p, descripcion: p.descripcion || s.nombre.split(' · ')[1], forma_pago: p.forma_pago || s.forma,
      honorarios: p.honorarios || (s.moneda === 'COP' ? String(s.precio * Math.max(1, n(p.aplicantes))) : '') }));
  }

  function planDosCuotas() {
    const mitad = Math.round(n(v.honorarios) / 2);
    setCuotas([
      { descripcion: 'Anticipo', fecha: v.fecha, valor: String(mitad) },
      { descripcion: 'Saldo de honorarios', fecha: sumarDias(v.fecha, 30), valor: String(n(v.honorarios) - mitad) },
      ...(n(v.terceros) ? [{ descripcion: 'Derechos consulares', fecha: sumarDias(v.fecha, 30), valor: String(n(v.terceros)) }] : []),
    ]);
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    iniciar(async () => {
      const r = await crearVenta({
        oficina_id: oficina, cliente_id: cliente, servicio_id: servicio, ...v,
        honorarios: n(v.honorarios), descuento: n(v.descuento), terceros: n(v.terceros), aplicantes: n(v.aplicantes) || 1,
        cuotas: cuotas.map((c) => ({ ...c, valor: n(c.valor) })),
      });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="tarjeta grid gap-4 sm:grid-cols-2">
          <h2 className="text-base font-extrabold sm:col-span-2">Cliente</h2>
          <div>
            <label className="etiqueta" htmlFor="oficina">Oficina</label>
            <select id="oficina" className="campo" value={oficina} onChange={(e) => { setOficina(e.target.value); setCliente(''); }}>
              {oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="buscar">Buscar cliente</label>
            <input id="buscar" className="campo" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o documento" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="cliente">Cliente</label>
            <select id="cliente" className="campo" required value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Elige el cliente…</option>
              {delaOficina.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <p className="mt-1 text-xs text-suave">¿No está? <Link href="/clientes/nuevo" className="font-bold text-info underline">Créalo primero</Link> y vuelve.</p>
          </div>
        </section>

        <section className="tarjeta grid gap-4 sm:grid-cols-2">
          <h2 className="text-base font-extrabold sm:col-span-2">Servicio y valores</h2>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="servicio">Servicio del catálogo</label>
            <select id="servicio" className="campo" value={servicio} onChange={(e) => elegirServicio(e.target.value)}>
              <option value="">Otro / sin servicio del catálogo</option>
              {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="descripcion">Descripción</label>
            <input id="descripcion" className="campo" value={v.descripcion} onChange={set('descripcion')} placeholder="Ej. Renovación visa USA premium" />
          </div>
          <div><label className="etiqueta" htmlFor="fecha">Fecha de la venta</label><input id="fecha" type="date" className="campo" required value={v.fecha} onChange={set('fecha')} /></div>
          <div><label className="etiqueta" htmlFor="aplicantes">Aplicantes (titular + miembros)</label><input id="aplicantes" type="number" min={1} className="campo" value={v.aplicantes} onChange={set('aplicantes')} /></div>
          <div><label className="etiqueta" htmlFor="honorarios">Honorarios SAFE BSO (ya con descuento)</label><input id="honorarios" inputMode="numeric" className="campo" value={v.honorarios} onChange={set('honorarios')} placeholder="597600" /></div>
          <div><label className="etiqueta" htmlFor="descuento">Descuento dado (informativo)</label><input id="descuento" inputMode="numeric" className="campo" value={v.descuento} onChange={set('descuento')} placeholder="0" /></div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="terceros">Derechos consulares / pagos a terceros (en pesos)</label>
            <input id="terceros" inputMode="numeric" className="campo" value={v.terceros} onChange={set('terceros')} placeholder="1280000" />
            <p className="mt-1 text-xs text-suave">Se cobran al cliente pero no son ingreso ni utilidad de SAFE BSO.</p>
          </div>
        </section>

        <section className="tarjeta space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">Plan de pagos</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secundario" onClick={() => setCuotas([])}>Un solo pago</button>
              <button type="button" className="btn-secundario" onClick={planDosCuotas}>50% + 50% a 30 días</button>
              <button type="button" className="btn-secundario" onClick={() => setCuotas([...cuotas, { descripcion: `Pago ${cuotas.length + 1}`, fecha: v.fecha, valor: '' }])}>Agregar cuota</button>
            </div>
          </div>
          {!cuotas.length ? <p className="text-sm text-suave">Un solo pago por el total, con fecha de la venta.</p> : (
            <div className="space-y-2">
              {cuotas.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_160px_160px_auto]">
                  <input aria-label={`Descripción cuota ${i + 1}`} className="campo" value={c.descripcion} onChange={(e) => setCuotas(cuotas.map((x, k) => k === i ? { ...x, descripcion: e.target.value } : x))} />
                  <input aria-label={`Fecha cuota ${i + 1}`} type="date" className="campo" value={c.fecha} onChange={(e) => setCuotas(cuotas.map((x, k) => k === i ? { ...x, fecha: e.target.value } : x))} />
                  <input aria-label={`Valor cuota ${i + 1}`} inputMode="numeric" className="campo" value={c.valor} onChange={(e) => setCuotas(cuotas.map((x, k) => k === i ? { ...x, valor: e.target.value } : x))} />
                  <button type="button" className="btn-secundario" onClick={() => setCuotas(cuotas.filter((_, k) => k !== i))}>Quitar</button>
                </div>
              ))}
              <p className={`text-sm font-semibold ${Math.round(sumaCuotas) === Math.round(total) ? 'text-ok' : 'text-peligro'}`}>
                Las cuotas suman {formatoMoneda(sumaCuotas)} de {formatoMoneda(total)}
              </p>
            </div>
          )}
        </section>

        <section className="tarjeta grid gap-4 sm:grid-cols-2">
          <h2 className="text-base font-extrabold sm:col-span-2">Otros datos</h2>
          <div><label className="etiqueta" htmlFor="forma_pago">Forma de pago</label><input id="forma_pago" className="campo" value={v.forma_pago} onChange={set('forma_pago')} placeholder="Contado" /></div>
          <div><label className="etiqueta" htmlFor="vendedor">Vendedor</label><input id="vendedor" className="campo" value={v.vendedor} onChange={set('vendedor')} /></div>
          <div className="sm:col-span-2"><label className="etiqueta" htmlFor="referido_por">¿Quién lo refirió?</label><input id="referido_por" className="campo" value={v.referido_por} onChange={set('referido_por')} /></div>
          <div className="sm:col-span-2"><label className="etiqueta" htmlFor="notas">Notas</label><textarea id="notas" rows={2} className="campo" value={v.notas} onChange={set('notas')} /></div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="tarjeta sticky top-4 space-y-3">
          <h2 className="text-base font-extrabold">Resumen</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Honorarios</dt><dd>{formatoMoneda(n(v.honorarios))}</dd></div>
            <div className="flex justify-between"><dt>Pagos a terceros</dt><dd>{formatoMoneda(n(v.terceros))}</dd></div>
            <div className="flex justify-between border-t border-borde pt-2 text-base font-extrabold"><dt>Total</dt><dd>{formatoMoneda(total)}</dd></div>
          </dl>
          {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
          <button className="btn-primario w-full" disabled={pendiente || !cliente || total <= 0}>{pendiente ? 'Guardando…' : 'Guardar venta'}</button>
          <p className="text-xs text-suave">Después de guardar puedes registrar los abonos que ya pagó.</p>
        </section>
      </aside>
    </form>
  );
}
