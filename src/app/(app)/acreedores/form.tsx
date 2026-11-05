'use client';
import { useState, useTransition } from 'react';
import { guardarDeuda } from './acciones';

export type DeudaForm = {
  id?: string; acreedor: string; tipo: string; documento: string; concepto: string; fecha_prestamo: string; valor_original: string;
  fecha_corte: string; saldo_inicial: string; tasa_pct: string; tasa_periodo: string; cuota_valor: string; cuotas_restantes: string;
  proxima_fecha: string; asignacion: 'oficina' | 'repartida' | 'general'; oficina_id: string; reparto: Record<string, string>;
  soporte: string; notas: string;
};
const TIPOS = ['Banco', 'Tarjeta de crédito', 'Socio', 'Particular', 'Proveedor', 'Leasing', 'Otro'];
const limpiar = (x: string) => String(x ?? '').replace(/[.\s$]/g, '').replace(',', '.');

export function FormDeuda({ inicial, oficinas, veTodo }: { inicial: DeudaForm; oficinas: { id: string; nombre: string }[]; veTodo: boolean }) {
  const [d, setD] = useState<DeudaForm>(inicial);
  const [error, setError] = useState('');
  const [pendiente, iniciar] = useTransition();
  const set = (k: keyof DeudaForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const suma = Object.values(d.reparto).reduce((a, x) => a + (Number(x) || 0), 0);

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    iniciar(async () => {
      const r = await guardarDeuda({
        ...d, saldo_inicial: limpiar(d.saldo_inicial), valor_original: limpiar(d.valor_original), cuota_valor: limpiar(d.cuota_valor),
        tasa_pct: limpiar(d.tasa_pct) || '0',
        reparto: d.asignacion === 'repartida' ? Object.entries(d.reparto).map(([oficina_id, pct]) => ({ oficina_id, pct: Number(pct) || 0 })) : [],
      });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <section className="tarjeta grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-extrabold sm:col-span-2">Acreedor</h2>
        <div><label className="etiqueta" htmlFor="acreedor">A quién se le debe</label><input id="acreedor" required className="campo" value={d.acreedor} onChange={set('acreedor')} placeholder="Bancolombia" /></div>
        <div><label className="etiqueta" htmlFor="tipo">Tipo</label><select id="tipo" className="campo" value={d.tipo} onChange={set('tipo')}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="etiqueta" htmlFor="documento">NIT / documento</label><input id="documento" className="campo" value={d.documento} onChange={set('documento')} /></div>
        <div><label className="etiqueta" htmlFor="concepto">Para qué fue</label><input id="concepto" className="campo" value={d.concepto} onChange={set('concepto')} placeholder="Capital de trabajo" /></div>
      </section>

      <section className="tarjeta grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-extrabold sm:col-span-2">Saldo y condiciones</h2>
        <div><label className="etiqueta" htmlFor="fecha_corte">Fecha de corte</label><input id="fecha_corte" type="date" required className="campo" value={d.fecha_corte} onChange={set('fecha_corte')} /></div>
        <div>
          <label className="etiqueta" htmlFor="saldo_inicial">Saldo a la fecha de corte (capital)</label>
          <input id="saldo_inicial" inputMode="numeric" required className="campo" value={d.saldo_inicial} onChange={set('saldo_inicial')} placeholder="14500000" />
        </div>
        <div><label className="etiqueta" htmlFor="fecha_prestamo">Fecha del préstamo</label><input id="fecha_prestamo" type="date" className="campo" value={d.fecha_prestamo} onChange={set('fecha_prestamo')} /></div>
        <div><label className="etiqueta" htmlFor="valor_original">Valor original</label><input id="valor_original" inputMode="numeric" className="campo" value={d.valor_original} onChange={set('valor_original')} /></div>
        <div><label className="etiqueta" htmlFor="tasa_periodo">Interés</label><select id="tasa_periodo" className="campo" value={d.tasa_periodo} onChange={set('tasa_periodo')}><option>Mensual</option><option>Anual</option><option>Sin interés</option></select></div>
        {d.tasa_periodo !== 'Sin interés' && <div><label className="etiqueta" htmlFor="tasa_pct">Tasa (%)</label><input id="tasa_pct" inputMode="decimal" className="campo" value={d.tasa_pct} onChange={set('tasa_pct')} placeholder="1,6" /></div>}
        <div><label className="etiqueta" htmlFor="cuota_valor">Valor de la cuota</label><input id="cuota_valor" inputMode="numeric" className="campo" value={d.cuota_valor} onChange={set('cuota_valor')} /></div>
        <div><label className="etiqueta" htmlFor="cuotas_restantes">Cuotas que faltan</label><input id="cuotas_restantes" type="number" min={0} className="campo" value={d.cuotas_restantes} onChange={set('cuotas_restantes')} /></div>
        <div><label className="etiqueta" htmlFor="proxima_fecha">Próximo pago</label><input id="proxima_fecha" type="date" className="campo" value={d.proxima_fecha} onChange={set('proxima_fecha')} /></div>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="text-base font-extrabold">¿Quién la asume?</h2>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Asignación</legend>
          {([['oficina', 'Una oficina (100%)'], ['repartida', 'Repartida por porcentaje'], ...(veTodo ? [['general', 'General de la empresa']] : [])] as [DeudaForm['asignacion'], string][]).map(([v, t]) => (
            <label key={v} className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="asignacion" checked={d.asignacion === v} onChange={() => setD({ ...d, asignacion: v })} /> {t}</label>
          ))}
        </fieldset>
        {d.asignacion === 'oficina' && (
          <div className="max-w-sm"><label className="etiqueta" htmlFor="oficina_id">Oficina</label>
            <select id="oficina_id" className="campo" value={d.oficina_id} onChange={set('oficina_id')} required>
              <option value="">Elige…</option>{oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select></div>
        )}
        {d.asignacion === 'repartida' && (
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            {oficinas.map((o) => (
              <div key={o.id}><label className="etiqueta" htmlFor={`pct-${o.id}`}>{o.nombre} (%)</label>
                <input id={`pct-${o.id}`} inputMode="decimal" className="campo" value={d.reparto[o.id] ?? ''} onChange={(e) => setD({ ...d, reparto: { ...d.reparto, [o.id]: e.target.value } })} /></div>
            ))}
            <p className={`text-sm font-semibold sm:col-span-2 ${suma === 100 ? 'text-ok' : 'text-peligro'}`}>Suman {suma}% (deben sumar 100%)</p>
          </div>
        )}
        {d.asignacion === 'general' && <p className="text-sm text-suave">Solo la ve quien ve todas las oficinas (consolidado).</p>}
      </section>

      <section className="tarjeta grid gap-4 sm:grid-cols-2">
        <div><label className="etiqueta" htmlFor="soporte">Soporte</label><input id="soporte" className="campo" value={d.soporte} onChange={set('soporte')} placeholder="Pagaré, contrato, extracto" /></div>
        <div><label className="etiqueta" htmlFor="notas">Notas</label><input id="notas" className="campo" value={d.notas} onChange={set('notas')} /></div>
      </section>

      {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
      <button className="btn-primario" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar deuda'}</button>
    </form>
  );
}
