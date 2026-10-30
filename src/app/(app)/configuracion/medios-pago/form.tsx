'use client';
import { useActionState } from 'react';
import { guardarMedioPago } from './acciones';

type Medio = {
  id: string; nombre: string; tipo: string; comision_pct: number; valor_fijo: number; iva_sobre_comision: boolean;
  monedas: string[]; oficina_id: string | null; instrucciones: string | null; activo: boolean;
};
const TIPOS = { plataforma: 'Plataforma de pagos', transferencia: 'Transferencia / consignación', efectivo: 'Efectivo', datafono: 'Datáfono', internacional: 'Internacional (PayPal, Western Union…)', otro: 'Otro' };

export function FormMedio({ medio, oficinas }: { medio?: Medio; oficinas: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState(guardarMedioPago, null);
  const k = medio?.id ?? 'nuevo';
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      {medio && <input type="hidden" name="id" value={medio.id} />}
      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor={`n-${k}`}>Nombre</label>
        <input id={`n-${k}`} name="nombre" defaultValue={medio?.nombre} required className="campo" placeholder="Nequi, Bancolombia ahorros…" />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`t-${k}`}>Tipo</label>
        <select id={`t-${k}`} name="tipo" defaultValue={medio?.tipo ?? 'transferencia'} className="campo">
          {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor={`o-${k}`}>Oficina</label>
        <select id={`o-${k}`} name="oficina_id" defaultValue={medio?.oficina_id ?? ''} className="campo">
          <option value="">Todas</option>
          {oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor={`c-${k}`}>Comisión (%)</label>
        <input id={`c-${k}`} name="comision_pct" type="number" min="0" max="50" step="any" defaultValue={medio?.comision_pct ?? 0} className="campo" />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`f-${k}`}>Valor fijo por transacción</label>
        <input id={`f-${k}`} name="valor_fijo" type="number" min="0" step="any" defaultValue={medio?.valor_fijo ?? 0} className="campo" />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="etiqueta">Monedas</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {['COP', 'USD', 'CAD', 'EUR'].map((m) => (
            <label key={m} className="flex items-center gap-1.5"><input type="checkbox" name="monedas" value={m} defaultChecked={(medio?.monedas ?? ['COP']).includes(m)} className="size-4" /> {m}</label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor={`i-${k}`}>Instrucciones para el cliente (salen en la cotización)</label>
        <textarea id={`i-${k}`} name="instrucciones" rows={2} defaultValue={medio?.instrucciones ?? ''} className="campo" placeholder="Cuenta de ahorros Bancolombia 000-000000-00 a nombre de SAFE BSO MIGRATION, NIT …" />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="iva_sobre_comision" defaultChecked={medio?.iva_sobre_comision} className="size-4" /> Cobran IVA sobre la comisión</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="activo" defaultChecked={medio?.activo ?? true} className="size-4" /> Activo</label>
        <button className="btn-primario ml-auto" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</button>
      </div>
      {estado?.error && <p role="alert" className="text-sm font-semibold text-peligro sm:col-span-2">{estado.error}</p>}
      {estado?.ok && <p role="status" className="text-sm font-semibold text-ok sm:col-span-2">Guardado.</p>}
    </form>
  );
}
