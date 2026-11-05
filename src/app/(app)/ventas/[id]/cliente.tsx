'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { formatoMoneda } from '@/lib/precios';
import { registrarAbono, anularAbono, anularVenta, type Resultado } from '../acciones';

export function FormAbono({ ventaId, saldo, hoy, medios }: { ventaId: string; saldo: number; hoy: string; medios: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState<Resultado | null, FormData>(registrarAbono, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado?.ok) form.current?.reset(); }, [estado]);
  return (
    <form ref={form} action={accion} className="tarjeta space-y-3">
      <h2 className="text-base font-extrabold">Registrar abono</h2>
      <p className="text-sm text-suave">Saldo: <b className="text-texto">{formatoMoneda(saldo)}</b>. Se cubren primero los honorarios y luego los pagos a terceros.</p>
      <input type="hidden" name="venta_id" value={ventaId} />
      <div><label className="etiqueta" htmlFor="valor">Valor recibido</label><input id="valor" name="valor" inputMode="numeric" required className="campo" placeholder={String(saldo)} /></div>
      <div><label className="etiqueta" htmlFor="fecha-abono">Fecha</label><input id="fecha-abono" name="fecha" type="date" required defaultValue={hoy} className="campo" /></div>
      <div>
        <label className="etiqueta" htmlFor="medio_id">Medio de pago</label>
        <select id="medio_id" name="medio_id" className="campo" defaultValue="">
          <option value="">Elige…</option>
          {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor="aplica_a">Se aplica a</label>
        <select id="aplica_a" name="aplica_a" className="campo" defaultValue="honorarios">
          <option value="honorarios">Automático (primero honorarios)</option>
          <option value="terceros">Pago a terceros (embajada)</option>
        </select>
      </div>
      <div><label className="etiqueta" htmlFor="cuenta">Cuenta donde entró</label><input id="cuenta" name="cuenta" className="campo" placeholder="Bancolombia ahorros" /></div>
      <div><label className="etiqueta" htmlFor="referencia">N.º de comprobante</label><input id="referencia" name="referencia" className="campo" /></div>
      <div><label className="etiqueta" htmlFor="recibido_por">Recibido por</label><input id="recibido_por" name="recibido_por" className="campo" /></div>
      {estado?.error && <p role="alert" className="text-sm font-semibold text-peligro">{estado.error}</p>}
      {estado?.ok && <p role="status" className="text-sm font-semibold text-ok">Abono registrado.</p>}
      <button className="btn-primario w-full" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Registrar abono'}</button>
    </form>
  );
}

function useAnulacion(f: (motivo: string) => Promise<Resultado>) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [pendiente, iniciar] = useTransition();
  const confirmar = () => iniciar(async () => {
    const r = await f(motivo);
    if (r.error) setError(r.error); else { setAbierto(false); setMotivo(''); }
  });
  return { abierto, setAbierto, motivo, setMotivo, error, pendiente, confirmar };
}

function Anulacion({ etiqueta, f, ancho }: { etiqueta: string; f: (motivo: string) => Promise<Resultado>; ancho?: boolean }) {
  const a = useAnulacion(f);
  if (!a.abierto) return <button type="button" className={`btn-secundario ${ancho ? 'w-full' : 'min-h-8 px-3 py-1 text-xs'}`} onClick={() => a.setAbierto(true)}>{etiqueta}</button>;
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={`motivo-${etiqueta}`}>Motivo</label>
      <input id={`motivo-${etiqueta}`} autoFocus className="campo" placeholder="Motivo de la anulación" value={a.motivo} onChange={(e) => a.setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="btn-peligro min-h-8 px-3 py-1 text-xs" disabled={a.pendiente || !a.motivo.trim()} onClick={a.confirmar}>Confirmar</button>
        <button type="button" className="btn-secundario min-h-8 px-3 py-1 text-xs" onClick={() => a.setAbierto(false)}>Cancelar</button>
      </div>
      {a.error && <p role="alert" className="text-xs font-semibold text-peligro">{a.error}</p>}
    </div>
  );
}

export function BotonAnularAbono({ id, ventaId }: { id: string; ventaId: string }) {
  return <Anulacion etiqueta="Anular" f={(m) => anularAbono(id, ventaId, m)} />;
}

export function BotonAnularVenta({ id }: { id: string }) {
  return <section className="tarjeta"><Anulacion etiqueta="Anular venta" ancho f={(m) => anularVenta(id, m)} /></section>;
}
