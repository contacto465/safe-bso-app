'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { enviarCotizacion, actualizarCotizacion, anularCotizacion } from '../acciones';

export function AccionesCotizacion({ id, estado, enlace, celular, consecutivo, nombre }: {
  id: string; estado: string; enlace: string; celular: string | null; consecutivo: string; nombre: string;
}) {
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pendiente, iniciar] = useTransition();
  const editable = ['borrador', 'enviada', 'por_reenviar'].includes(estado);
  const enviada = estado === 'enviada';
  const tel = celular?.replace(/\D/g, '');
  const wa = tel ? `https://wa.me/${tel.length === 10 ? '57' + tel : tel}?text=${encodeURIComponent(`Hola ${nombre}, te compartimos tu cotización ${consecutivo} de SAFE BSO MIGRATION: ${enlace}`)}` : null;
  const ejecutar = (f: () => Promise<{ error?: string; ok?: boolean }>, ok: string) =>
    iniciar(async () => { const r = await f(); setMsg(r.error ? { error: r.error } : { ok }); });

  return (
    <section className="tarjeta space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        {editable && (
          <button type="button" className="btn-primario" disabled={pendiente}
            onClick={() => ejecutar(() => enviarCotizacion(id), 'Marcada como enviada. Vigente desde hoy. Comparte el enlace con el cliente.')}>
            {estado === 'borrador' ? 'Marcar como enviada' : 'Reenviar'}
          </button>
        )}
        {enviada && (
          <>
            <button type="button" className="btn-secundario" onClick={async () => { await navigator.clipboard.writeText(enlace); setCopiado(true); }}>
              {copiado ? 'Enlace copiado' : 'Copiar enlace del cliente'}
            </button>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secundario">Enviar por WhatsApp</a>}
            <a href={enlace} target="_blank" rel="noopener noreferrer" className="btn-secundario">Ver como el cliente</a>
          </>
        )}
        {editable && <Link href={`/cotizaciones/${id}/editar`} className="btn-secundario">Editar</Link>}
        {editable && estado !== 'borrador' && (
          <button type="button" className="btn-secundario" disabled={pendiente}
            onClick={() => ejecutar(() => actualizarCotizacion(id), 'Precios actualizados con el catálogo. Queda por reenviar.')}>Actualizar precios</button>
        )}
        <button type="button" className="btn-secundario" onClick={() => window.print()}>Imprimir / PDF</button>
        {!['aceptada', 'anulada'].includes(estado) && (
          <button type="button" className="btn-peligro" disabled={pendiente} onClick={() => {
            const motivo = prompt('Motivo de la anulación');
            if (motivo) ejecutar(() => anularCotizacion(id, motivo), 'Cotización anulada.');
          }}>Anular</button>
        )}
      </div>
      {estado === 'por_reenviar' && <p className="text-sm font-semibold text-alerta">Venció y se actualizó con los precios vigentes. El cliente no la puede aceptar hasta que la reenvíes.</p>}
      {msg?.error && <p role="alert" className="text-sm font-semibold text-peligro">{msg.error}</p>}
      {msg?.ok && <p role="status" className="text-sm font-semibold text-ok">{msg.ok}</p>}
      <p className="text-xs text-suave">El envío automático por correo llega en la fase 5. Por ahora se comparte el enlace por WhatsApp o correo.</p>
    </section>
  );
}
