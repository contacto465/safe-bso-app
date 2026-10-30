'use client';
import { useActionState, useState, useTransition } from 'react';
import { invitarUsuario, actualizarUsuario, cambiarActivo, restablecer2FA } from './acciones';

type Oficina = { id: string; nombre: string };
const ROLES = [['admin', 'Administrador'], ['finanzas', 'Finanzas'], ['operaciones', 'Operaciones'], ['vendedor', 'Vendedor (sin costos ni utilidad)']];

function Alcance({ oficinas, valor, id }: { oficinas: Oficina[]; valor?: string; id: string }) {
  return (
    <div>
      <label className="etiqueta" htmlFor={id}>Qué puede ver</label>
      <select id={id} name="alcance" defaultValue={valor ?? ''} required className="campo">
        <option value="" disabled>Elige…</option>
        <option value="todo">Ver todo (todas las oficinas y el consolidado)</option>
        {oficinas.map((o) => <option key={o.id} value={o.id}>Solo {o.nombre}</option>)}
      </select>
    </div>
  );
}

function Msg({ e }: { e: { error?: string; ok?: string } | null | undefined }) {
  if (e?.error) return <p role="alert" className="text-sm font-semibold text-peligro">{e.error}</p>;
  if (e?.ok) return <p role="status" className="text-sm font-semibold text-ok">{e.ok}</p>;
  return null;
}

export function FormInvitar({ oficinas, deshabilitado }: { oficinas: Oficina[]; deshabilitado: boolean }) {
  const [estado, accion, pendiente] = useActionState(invitarUsuario, null);
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <fieldset disabled={deshabilitado} className="contents">
        <div><label className="etiqueta" htmlFor="inv-n">Nombre</label><input id="inv-n" name="nombre" required className="campo" /></div>
        <div><label className="etiqueta" htmlFor="inv-c">Correo</label><input id="inv-c" name="correo" type="email" required className="campo" /></div>
        <div><label className="etiqueta" htmlFor="inv-r">Rol</label>
          <select id="inv-r" name="rol" defaultValue="finanzas" className="campo">{ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <Alcance oficinas={oficinas} id="inv-a" />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button className="btn-primario" disabled={pendiente}>{pendiente ? 'Enviando…' : 'Enviar invitación'}</button>
          <Msg e={estado} />
        </div>
      </fieldset>
    </form>
  );
}

export function FormUsuario({ u, oficinas, alcance, esYo }: {
  u: { id: string; rol: string; activo: boolean }; oficinas: Oficina[]; alcance: string; esYo: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(actualizarUsuario, null);
  const [otro, setOtro] = useState<{ error?: string; ok?: string } | null>(null);
  const [p2, iniciar] = useTransition();
  return (
    <div className="space-y-3">
      <form action={accion} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={u.id} />
        <div><label className="etiqueta" htmlFor={`r-${u.id}`}>Rol</label>
          <select id={`r-${u.id}`} name="rol" defaultValue={u.rol} disabled={esYo} className="campo">{ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          {esYo && <input type="hidden" name="rol" value={u.rol} />}</div>
        <Alcance oficinas={oficinas} valor={alcance} id={`a-${u.id}`} />
        {!esYo && <div className="sm:col-span-2"><button className="btn-primario" disabled={pendiente}>Guardar cambios</button></div>}
      </form>
      <Msg e={estado} />
      {!esYo && (
        <div className="flex flex-wrap gap-2 border-t border-borde pt-3">
          <button type="button" className={u.activo ? 'btn-peligro' : 'btn-secundario'} disabled={p2}
            onClick={() => iniciar(async () => setOtro(await cambiarActivo(u.id, !u.activo)))}>
            {u.activo ? 'Desactivar usuario' : 'Reactivar usuario'}
          </button>
          <button type="button" className="btn-secundario" disabled={p2}
            onClick={() => iniciar(async () => setOtro(await restablecer2FA(u.id)))}>Restablecer verificación en dos pasos</button>
        </div>
      )}
      <Msg e={otro} />
    </div>
  );
}
