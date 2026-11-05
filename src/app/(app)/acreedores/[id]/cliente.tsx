'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { formatoMoneda } from '@/lib/precios';
import { registrarPagoDeuda, anularPagoDeuda, type Resultado } from '../acciones';

export function FormPagoDeuda({ deudaId, hoy, saldo, cuota, oficinas, oficinaDefecto }: {
  deudaId: string; hoy: string; saldo: number; cuota: number; oficinas: { id: string; nombre: string }[]; oficinaDefecto: string;
}) {
  const [estado, accion, pendiente] = useActionState<Resultado | null, FormData>(registrarPagoDeuda, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado?.ok) form.current?.reset(); }, [estado]);
  return (
    <form ref={form} action={accion} className="tarjeta space-y-3">
      <h2 className="text-base font-extrabold">Registrar pago</h2>
      <p className="text-sm text-suave">Saldo: <b className="text-texto">{formatoMoneda(saldo)}</b>{cuota > 0 && <> · cuota {formatoMoneda(cuota)}</>}. Separa capital e intereses como vienen en el extracto.</p>
      <input type="hidden" name="deuda_id" value={deudaId} />
      <div><label className="etiqueta" htmlFor="fecha-pago">Fecha</label><input id="fecha-pago" name="fecha" type="date" required defaultValue={hoy} className="campo" /></div>
      <div><label className="etiqueta" htmlFor="capital">Abono a capital</label><input id="capital" name="capital" inputMode="numeric" className="campo" placeholder="0" /><p className="mt-1 text-xs text-suave">Baja la deuda. No es gasto.</p></div>
      <div><label className="etiqueta" htmlFor="intereses">Intereses</label><input id="intereses" name="intereses" inputMode="numeric" className="campo" placeholder="0" /><p className="mt-1 text-xs text-suave">Gasto financiero de la oficina.</p></div>
      <div><label className="etiqueta" htmlFor="otros">Otros cargos (seguro, mora)</label><input id="otros" name="otros" inputMode="numeric" className="campo" placeholder="0" /></div>
      <div><label className="etiqueta" htmlFor="oficina_pago_id">Oficina que pagó</label>
        <select id="oficina_pago_id" name="oficina_pago_id" className="campo" defaultValue={oficinaDefecto}>{oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
      <div><label className="etiqueta" htmlFor="medio">Medio de pago</label><input id="medio" name="medio" className="campo" placeholder="Débito automático" /></div>
      <div><label className="etiqueta" htmlFor="cuenta">Cuenta de donde salió</label><input id="cuenta" name="cuenta" className="campo" /></div>
      <div><label className="etiqueta" htmlFor="referencia">N.º de comprobante</label><input id="referencia" name="referencia" className="campo" /></div>
      {estado?.error && <p role="alert" className="text-sm font-semibold text-peligro">{estado.error}</p>}
      {estado?.ok && <p role="status" className="text-sm font-semibold text-ok">Pago registrado.</p>}
      <button className="btn-primario w-full" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Registrar pago'}</button>
    </form>
  );
}

export function BotonAnularPago({ id, deudaId }: { id: string; deudaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [pendiente, iniciar] = useTransition();
  if (!abierto) return <button type="button" className="btn-secundario min-h-8 px-3 py-1 text-xs" onClick={() => setAbierto(true)}>Anular</button>;
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={`motivo-${id}`}>Motivo</label>
      <input id={`motivo-${id}`} autoFocus className="campo" placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="btn-peligro min-h-8 px-3 py-1 text-xs" disabled={pendiente || !motivo.trim()}
          onClick={() => iniciar(async () => { const r = await anularPagoDeuda(id, deudaId, motivo); if (r.error) setError(r.error); else setAbierto(false); })}>Confirmar</button>
        <button type="button" className="btn-secundario min-h-8 px-3 py-1 text-xs" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-peligro">{error}</p>}
    </div>
  );
}
