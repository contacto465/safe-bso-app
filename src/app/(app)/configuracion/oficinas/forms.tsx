'use client';
import { useActionState } from 'react';
import { guardarEmpresa, guardarOficina } from './acciones';

type Empresa = { razon_social: string; nit: string | null; responsable_iva: boolean | null; color_primario: string | null; color_acento: string | null; tipografia: string | null };
type Oficina = { id: string; codigo: string; nombre: string; ciudad: string; direccion: string | null; telefono: string | null; correo: string | null; responsable: string | null };

function Resultado({ e }: { e: { error?: string; ok?: boolean } | null }) {
  if (e?.error) return <p role="alert" className="text-sm font-semibold text-peligro">{e.error}</p>;
  if (e?.ok) return <p role="status" className="text-sm font-semibold text-ok">Guardado.</p>;
  return null;
}

export function FormEmpresa({ e, editable }: { e: Empresa; editable: boolean }) {
  const [estado, accion, pendiente] = useActionState(guardarEmpresa, null);
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <fieldset disabled={!editable} className="contents">
        <div className="sm:col-span-2"><label className="etiqueta" htmlFor="rs">Razón social</label><input id="rs" name="razon_social" defaultValue={e.razon_social} className="campo" required /></div>
        <div><label className="etiqueta" htmlFor="nit">NIT</label><input id="nit" name="nit" defaultValue={e.nit ?? ''} className="campo" placeholder="900.000.000-0" /></div>
        <div><label className="etiqueta" htmlFor="iva">Responsable de IVA</label>
          <select id="iva" name="responsable_iva" defaultValue={e.responsable_iva == null ? '' : e.responsable_iva ? 'si' : 'no'} className="campo">
            <option value="">Por definir</option><option value="si">Sí</option><option value="no">No</option>
          </select></div>
        <div><label className="etiqueta" htmlFor="cp">Color principal de la marca</label><input id="cp" name="color_primario" defaultValue={e.color_primario ?? ''} className="campo" placeholder="#0E2A3F" /></div>
        <div><label className="etiqueta" htmlFor="ca">Color de acento</label><input id="ca" name="color_acento" defaultValue={e.color_acento ?? ''} className="campo" placeholder="#F2B544" /></div>
        <div className="sm:col-span-2"><label className="etiqueta" htmlFor="tp">Tipografía</label><input id="tp" name="tipografia" defaultValue={e.tipografia ?? ''} className="campo" placeholder="Manrope" /></div>
        {editable && <div className="flex items-center gap-3 sm:col-span-2"><button className="btn-primario" disabled={pendiente}>Guardar</button><Resultado e={estado} /></div>}
      </fieldset>
    </form>
  );
}

export function FormOficina({ o, editable }: { o?: Oficina; editable: boolean }) {
  const [estado, accion, pendiente] = useActionState(guardarOficina, null);
  const k = o?.id ?? 'nueva';
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)]">
      <fieldset disabled={!editable} className="contents">
        {o && <input type="hidden" name="id" value={o.id} />}
        <div><label className="etiqueta" htmlFor={`c-${k}`}>Código</label><input id={`c-${k}`} name="codigo" defaultValue={o?.codigo} maxLength={3} className="campo uppercase" required /></div>
        <div><label className="etiqueta" htmlFor={`n-${k}`}>Nombre</label><input id={`n-${k}`} name="nombre" defaultValue={o?.nombre} className="campo" required /></div>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <div><label className="etiqueta" htmlFor={`ci-${k}`}>Ciudad</label><input id={`ci-${k}`} name="ciudad" defaultValue={o?.ciudad} className="campo" required /></div>
          <div><label className="etiqueta" htmlFor={`d-${k}`}>Dirección</label><input id={`d-${k}`} name="direccion" defaultValue={o?.direccion ?? ''} className="campo" /></div>
          <div><label className="etiqueta" htmlFor={`t-${k}`}>Teléfono</label><input id={`t-${k}`} name="telefono" defaultValue={o?.telefono ?? ''} className="campo" /></div>
          <div><label className="etiqueta" htmlFor={`e-${k}`}>Correo</label><input id={`e-${k}`} name="correo" type="email" defaultValue={o?.correo ?? ''} className="campo" /></div>
          <div className="sm:col-span-2"><label className="etiqueta" htmlFor={`r-${k}`}>Responsable</label><input id={`r-${k}`} name="responsable" defaultValue={o?.responsable ?? ''} className="campo" /></div>
        </div>
        {editable && <div className="flex items-center gap-3 sm:col-span-2"><button className="btn-primario" disabled={pendiente}>Guardar</button><Resultado e={estado} /></div>}
      </fieldset>
    </form>
  );
}
