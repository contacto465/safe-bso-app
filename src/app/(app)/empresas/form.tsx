'use client';
import { useActionState } from 'react';
import { guardarEmpresa } from '../clientes/acciones';

type E = { id: string; oficina_id: string; razon_social: string; nit: string | null; pais: string | null; sector: string | null; contacto_nombre: string | null; contacto_correo: string | null; contacto_celular: string | null; notas: string | null };

export function FormEmpresa({ e, oficinas }: { e?: E; oficinas: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState(guardarEmpresa, null);
  const k = e?.id ?? 'nueva';
  const c = (n: keyof E, l: string, t = 'text') => (
    <div><label className="etiqueta" htmlFor={`${n}-${k}`}>{l}</label><input id={`${n}-${k}`} name={n} type={t} defaultValue={(e?.[n] as string) ?? ''} className="campo" /></div>
  );
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      {e && <input type="hidden" name="id" value={e.id} />}
      <div className="sm:col-span-2"><label className="etiqueta" htmlFor={`rs-${k}`}>Razón social</label><input id={`rs-${k}`} name="razon_social" required defaultValue={e?.razon_social} className="campo" /></div>
      {c('nit', 'NIT / Tax ID')}{c('pais', 'País')}{c('sector', 'Sector')}
      <div><label className="etiqueta" htmlFor={`of-${k}`}>Oficina</label>
        <select id={`of-${k}`} name="oficina_id" defaultValue={e?.oficina_id ?? oficinas[0]?.id} className="campo">{oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
      {c('contacto_nombre', 'Contacto')}{c('contacto_correo', 'Correo del contacto', 'email')}{c('contacto_celular', 'Celular del contacto')}
      <div className="sm:col-span-2"><label className="etiqueta" htmlFor={`no-${k}`}>Acuerdo comercial / notas</label><textarea id={`no-${k}`} name="notas" rows={2} defaultValue={e?.notas ?? ''} className="campo" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primario" disabled={pendiente}>Guardar</button>
        {estado?.error && <p role="alert" className="text-sm font-semibold text-peligro">{estado.error}</p>}
        {estado?.ok && <p role="status" className="text-sm font-semibold text-ok">Guardada.</p>}
      </div>
    </form>
  );
}
