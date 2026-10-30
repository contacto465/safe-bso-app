'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { guardarCliente } from './acciones';

export type Cliente = {
  id: string; oficina_id: string; nombres: string; apellidos: string; documento_tipo: string | null; documento: string | null;
  correo: string | null; celular: string | null; pais: string | null; ciudad: string | null; empresa_id: string | null;
  referido_por: string | null; categoria: string | null; tipo_proceso: string | null; estado_proceso: string; notas: string | null;
};
export const ESTADOS_PROCESO = ['Registrado', 'Cotizado', 'En proceso', 'Documentación', 'Radicado', 'Cita asignada', 'Aprobado', 'Negado', 'Finalizado', 'Desistió'];

export function FormCliente({ c, oficinas, empresas }: {
  c?: Cliente; oficinas: { id: string; nombre: string }[]; empresas: { id: string; razon_social: string }[];
}) {
  const [estado, accion, pendiente] = useActionState(guardarCliente, null);
  const campo = (name: keyof Cliente, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="etiqueta" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={(c?.[name] as string) ?? ''} className="campo" {...props} />
    </div>
  );
  return (
    <form action={accion} className="space-y-5">
      {c && <input type="hidden" name="id" value={c.id} />}
      {estado?.error && <p role="alert" className="rounded-xl bg-peligro-fondo px-4 py-3 text-sm font-semibold text-peligro">{estado.error}</p>}
      <section className="tarjeta grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-extrabold sm:col-span-2">Datos del cliente</h2>
        {campo('nombres', 'Nombres', { required: true, autoComplete: 'off' })}
        {campo('apellidos', 'Apellidos', { required: true, autoComplete: 'off' })}
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
          <div>
            <label className="etiqueta" htmlFor="documento_tipo">Tipo</label>
            <select id="documento_tipo" name="documento_tipo" defaultValue={c?.documento_tipo ?? 'CC'} className="campo">
              {['CC', 'CE', 'PA', 'PPT', 'NIT', 'OTRO'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          {campo('documento', 'Documento')}
        </div>
        {campo('celular', 'Celular / WhatsApp', { inputMode: 'tel', placeholder: '573001234567' })}
        {campo('correo', 'Correo', { type: 'email' })}
        <div className="grid grid-cols-2 gap-2">{campo('pais', 'País')}{campo('ciudad', 'Ciudad')}</div>
        <div>
          <label className="etiqueta" htmlFor="oficina_id">Oficina que lo atiende</label>
          <select id="oficina_id" name="oficina_id" defaultValue={c?.oficina_id ?? oficinas[0]?.id} className="campo" required>
            {oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="empresa_id">Empresa (si es beneficiario de una)</label>
          <select id="empresa_id" name="empresa_id" defaultValue={c?.empresa_id ?? ''} className="campo">
            <option value="">Ninguna — persona natural</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.razon_social}</option>)}
          </select>
        </div>
        {campo('referido_por', '¿Quién lo refirió?')}
      </section>
      <section className="tarjeta grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-extrabold sm:col-span-2">Control de procesos</h2>
        {campo('categoria', 'Categoría', { placeholder: 'Visas EE. UU.' })}
        {campo('tipo_proceso', 'Tipo de proceso', { placeholder: 'Visa de turismo B1/B2' })}
        <div>
          <label className="etiqueta" htmlFor="estado_proceso">Estado</label>
          <select id="estado_proceso" name="estado_proceso" defaultValue={c?.estado_proceso ?? 'Registrado'} className="campo">
            {ESTADOS_PROCESO.map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="notas">Anotaciones</label>
          <textarea id="notas" name="notas" rows={3} defaultValue={c?.notas ?? ''} className="campo" />
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar cliente'}</button>
        <Link href="/clientes" className="btn-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
