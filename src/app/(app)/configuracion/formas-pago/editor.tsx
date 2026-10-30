'use client';
import { useState, useTransition } from 'react';
import { guardarFormaPago } from './acciones';
import type { FormaPago } from '@/lib/catalogo';

type Cuota = FormaPago['cuotas'][number];

export function EditorFormaPago({ forma, onListo }: { forma?: FormaPago; onListo?: () => void }) {
  const [nombre, setNombre] = useState(forma?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(forma?.descripcion ?? '');
  const [cuotas, setCuotas] = useState<Cuota[]>(forma?.cuotas ?? [{ numero: 1, porcentaje: 100, dias: 0, descripcion: 'Pago total' }]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pendiente, iniciar] = useTransition();
  const total = cuotas.reduce((a, c) => a + (Number(c.porcentaje) || 0), 0);
  const set = (i: number, k: keyof Cuota, v: string) =>
    setCuotas(cuotas.map((c, j) => (j === i ? { ...c, [k]: k === 'descripcion' ? v : Number(v) } : c)));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        iniciar(async () => {
          const r = await guardarFormaPago({ id: forma?.id, nombre, descripcion, cuotas: cuotas.map((c, i) => ({ ...c, numero: i + 1 })) });
          if (r.error) setError(r.error);
          else { setError(null); setOk(true); if (!forma) { setNombre(''); setDescripcion(''); setCuotas([{ numero: 1, porcentaje: 100, dias: 0, descripcion: 'Pago total' }]); } onListo?.(); }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta" htmlFor={`fn-${forma?.id ?? 'nueva'}`}>Nombre</label>
          <input id={`fn-${forma?.id ?? 'nueva'}`} value={nombre} onChange={(e) => setNombre(e.target.value)} required className="campo" placeholder="40% + 30% + 30%" />
        </div>
        <div>
          <label className="etiqueta" htmlFor={`fd-${forma?.id ?? 'nueva'}`}>Descripción</label>
          <input id={`fd-${forma?.id ?? 'nueva'}`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="campo" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="hidden grid-cols-[minmax(0,1fr)_90px_120px_auto] gap-2 text-xs font-bold uppercase text-suave sm:grid">
          <span>Pago</span><span>%</span><span>Días después de aceptar</span><span />
        </div>
        {cuotas.map((c, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_90px_120px_auto] gap-2">
            <input aria-label={`Descripción del pago ${i + 1}`} value={c.descripcion ?? ''} onChange={(e) => set(i, 'descripcion', e.target.value)} className="campo" placeholder={i === 0 ? 'Anticipo' : `Cuota ${i + 1}`} />
            <input aria-label={`Porcentaje del pago ${i + 1}`} type="number" min="0" max="100" step="any" value={c.porcentaje} onChange={(e) => set(i, 'porcentaje', e.target.value)} className="campo" />
            <input aria-label={`Días del pago ${i + 1}`} type="number" min="0" value={c.dias} onChange={(e) => set(i, 'dias', e.target.value)} className="campo" />
            <button type="button" aria-label={`Quitar pago ${i + 1}`} className="btn-secundario px-3" disabled={cuotas.length === 1}
              onClick={() => setCuotas(cuotas.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secundario" onClick={() => setCuotas([...cuotas, { numero: cuotas.length + 1, porcentaje: Math.max(0, 100 - total), dias: 30 * cuotas.length }])}>Agregar pago</button>
        <span className={`text-sm font-bold ${Math.abs(total - 100) < 0.001 ? 'text-ok' : 'text-peligro'}`}>Total: {total}%</span>
        <button type="submit" className="btn-primario ml-auto" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</button>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
      {ok && <p role="status" className="text-sm font-semibold text-ok">Guardada.</p>}
    </form>
  );
}
