'use client';
import { useActionState } from 'react';
import { guardarReglas, crearCategoria } from './acciones';

export type Regla = { clave: string; valor: number; descripcion: string; unidad: string };

export function FormReglas({ reglas, editable }: { reglas: Regla[]; editable: boolean }) {
  const [estado, accion, pendiente] = useActionState(guardarReglas, null);
  return (
    <form action={accion} className="space-y-3">
      <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
        {reglas.map((r) => (
          <div key={r.clave}>
            <label className="mb-1 block text-sm font-semibold" htmlFor={r.clave}>{r.descripcion}</label>
            <div className="flex items-center gap-2">
              <input id={r.clave} name={r.clave} type="number" step="any" defaultValue={r.valor} className="campo w-32" />
              <span className="text-sm text-suave">{r.unidad}</span>
            </div>
          </div>
        ))}
      </fieldset>
      {editable && (
        <div className="flex items-center gap-3">
          <button className="btn-primario" disabled={pendiente}>Guardar reglas</button>
          {estado?.error && <p role="alert" className="text-sm font-semibold text-peligro">{estado.error}</p>}
          {estado?.ok && <p role="status" className="text-sm font-semibold text-ok">Guardado. Quedó en la auditoría.</p>}
        </div>
      )}
    </form>
  );
}

export function FormCategoria() {
  const [estado, accion, pendiente] = useActionState(crearCategoria, null);
  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1"><label className="etiqueta" htmlFor="cat-n">Nueva categoría</label><input id="cat-n" name="nombre" className="campo" placeholder="Visas EE. UU." /></div>
      <div className="min-w-48 flex-1"><label className="etiqueta" htmlFor="cat-t">Tipo de proceso</label><input id="cat-t" name="tipo_proceso" className="campo" placeholder="Visa de turismo" /></div>
      <button className="btn-secundario" disabled={pendiente}>Agregar</button>
      {estado?.error && <p role="alert" className="w-full text-sm font-semibold text-peligro">{estado.error}</p>}
    </form>
  );
}
