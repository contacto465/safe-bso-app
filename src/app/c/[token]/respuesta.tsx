'use client';
import { useState, useTransition } from 'react';
import { responder } from './acciones';

export function Respuesta({ token, vigente, estado, whatsapp, consecutivo }: { token: string; vigente: boolean; estado: string; whatsapp: string | null; consecutivo: string }) {
  const [res, setRes] = useState<string | null>(estado === 'aceptada' || estado === 'rechazada' ? estado : null);
  const [rechazo, setRechazo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const wa = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una pregunta sobre la cotización ${consecutivo}`)}` : null;
  const enviar = (accion: 'aceptar' | 'rechazar', comentario?: string) => iniciar(async () => {
    const r = await responder(token, accion, comentario);
    if (r.error) setError(r.error); else setRes(r.estado!);
  });

  if (res) return (
    <div role="status" className={`rounded-2xl p-5 text-center font-semibold ${res === 'aceptada' ? 'bg-ok-fondo text-ok' : 'bg-superficie-2 text-suave'}`}>
      {res === 'aceptada' ? '¡Gracias! Aceptaste esta cotización. Tu asesor te contactará para continuar.' : 'Registramos tu respuesta. Si cambias de opinión, escríbenos.'}
      {wa && <a href={wa} className="btn-secundario mt-3 flex">Escribir por WhatsApp</a>}
    </div>
  );
  if (!vigente) return (
    <div role="status" className="rounded-2xl bg-alerta-fondo p-5 text-center font-semibold text-alerta">
      Esta cotización venció. Tu asesor te enviará una versión actualizada.
      {wa && <a href={wa} className="btn-secundario mt-3 flex">Escribir por WhatsApp</a>}
    </div>
  );
  return (
    <div className="space-y-3 rounded-2xl bg-superficie p-5 print:hidden">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={pendiente} onClick={() => enviar('aceptar')} className="btn-primario min-h-12 text-base">Aceptar cotización</button>
        <button type="button" disabled={pendiente} onClick={() => setRechazo(!rechazo)} className="btn-secundario min-h-12 text-base">No aceptar</button>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secundario min-h-12">Continuar por WhatsApp</a>}
        <a href="#metodos" className="btn-secundario min-h-12">Pagar</a>
      </div>
      {rechazo && (
        <form className="space-y-2" action={(fd) => enviar('rechazar', String(fd.get('comentario') ?? ''))}>
          <label className="etiqueta" htmlFor="comentario">¿Nos cuentas por qué? (opcional)</label>
          <textarea id="comentario" name="comentario" rows={2} className="campo" />
          <button className="btn-peligro" disabled={pendiente}>Confirmar que no acepto</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
      <button type="button" onClick={() => window.print()} className="text-sm font-semibold text-info underline">Descargar en PDF / imprimir</button>
    </div>
  );
}
