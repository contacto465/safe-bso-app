import { formatoMoneda } from '@/lib/precios';

// Documento de la cotización tal como lo ve el cliente (pantalla e impresión / PDF)
export type DocCotizacion = {
  consecutivo: string; tipo: string; version: number; fecha_emision: string; fecha_vencimiento: string;
  subtotal_honorarios: number; descuento_total: number; total_honorarios: number; iva_incluido: number;
  total_terceros: number; total: number; notas: string | null; tasas: Record<string, number>;
  cronograma: { numero: number; descripcion: string; porcentaje: number; valor: number; fecha: string }[];
  cliente: { nombre: string; documento: string | null }; empresa: { razon_social: string; nit: string | null } | null;
  oficina: { nombre: string; ciudad: string; direccion: string | null; telefono: string | null; correo: string | null };
  emisor: { razon_social: string; nit: string | null };
  items: { descripcion: string; incluye: string | null; tipo: string; cantidad: number; moneda: string; precio_unitario: number; bruto: number; recargo: number; descuento: number; total: number }[];
  medios_pago: { nombre: string; instrucciones: string | null }[];
  terminos: string | null;
};

const f = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

export function DocumentoCotizacion({ d }: { d: DocCotizacion }) {
  const hon = d.items.filter((i) => i.tipo === 'honorario');
  const ter = d.items.filter((i) => i.tipo === 'tercero');
  return (
    <article className="documento space-y-6 rounded-2xl bg-superficie p-6 sm:p-10 print:rounded-none print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-marca pb-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-marca text-lg font-extrabold text-acento print:border print:border-marca">SB</span>
          <div>
            <p className="text-lg font-extrabold">{d.emisor.razon_social}</p>
            <p className="text-xs text-suave">{d.emisor.nit ? `NIT ${d.emisor.nit} · ` : ''}{d.oficina.nombre}</p>
            <p className="text-xs text-suave">{[d.oficina.direccion, d.oficina.telefono, d.oficina.correo].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-widest text-suave">{d.tipo === 'prefactura' ? 'Prefactura' : 'Cotización'}</p>
          <p className="text-xl font-extrabold">{d.consecutivo}</p>
          <p className="text-xs text-suave">Versión {d.version} · {f(d.fecha_emision)}</p>
          <p className="text-xs font-bold text-alerta">Válida hasta el {f(d.fecha_vencimiento)}</p>
        </div>
      </header>

      <section className="text-sm">
        <p className="etiqueta">Cliente</p>
        <p className="font-bold">{d.empresa ? d.empresa.razon_social : d.cliente.nombre}</p>
        {d.empresa && <p className="text-suave">{d.empresa.nit ? `NIT ${d.empresa.nit} · ` : ''}Beneficiario: {d.cliente.nombre}</p>}
        {!d.empresa && d.cliente.documento && <p className="text-suave">Documento {d.cliente.documento}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-extrabold">Servicios SAFE BSO MIGRATION</h2>
        <table className="tabla">
          <thead><tr><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">Valor</th></tr></thead>
          <tbody>
            {hon.map((i, k) => (
              <tr key={k}>
                <td>
                  <b>{i.descripcion}</b>
                  {i.incluye && <ul className="mt-1 list-disc pl-5 text-xs text-suave">{i.incluye.split('\n').filter(Boolean).map((x) => <li key={x}>{x}</li>)}</ul>}
                  {i.descuento > 0 && <span className="block text-xs text-ok">Descuento: −{formatoMoneda(i.descuento)}</span>}
                </td>
                <td className="text-right">{i.cantidad}</td>
                <td className="text-right font-semibold">{formatoMoneda(i.total)}</td>
              </tr>
            ))}
            {ter.filter((i) => i.recargo > 0).map((i, k) => (
              <tr key={`g${k}`}><td><b>Gestión: {i.descripcion}</b></td><td className="text-right">{i.cantidad}</td><td className="text-right font-semibold">{formatoMoneda(i.recargo)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {ter.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-extrabold">Pagos a terceros (embajadas y entidades)</h2>
          <p className="text-xs text-suave">Valores oficiales que se pagan a la entidad. No son honorarios de SAFE BSO MIGRATION, no llevan IVA ni descuentos.</p>
          <table className="tabla">
            <tbody>
              {ter.map((i, k) => (
                <tr key={k}>
                  <td><b>{i.descripcion}</b>{i.moneda !== 'COP' && <span className="block text-xs text-suave">{i.cantidad} × {formatoMoneda(i.precio_unitario, i.moneda)} · TRM {formatoMoneda(d.tasas[i.moneda])}</span>}</td>
                  <td className="text-right font-semibold">{formatoMoneda(i.bruto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="ml-auto max-w-sm space-y-1 text-sm">
        <div className="flex justify-between"><span>Honorarios</span><span>{formatoMoneda(d.subtotal_honorarios)}</span></div>
        {d.descuento_total > 0 && <div className="flex justify-between text-ok"><span>Descuento</span><span>−{formatoMoneda(d.descuento_total)}</span></div>}
        {d.total_terceros > 0 && <div className="flex justify-between"><span>Pagos a terceros</span><span>{formatoMoneda(d.total_terceros)}</span></div>}
        <div className="flex justify-between border-t-2 border-marca pt-2 text-lg font-extrabold"><span>Total</span><span>{formatoMoneda(d.total)}</span></div>
        <p className="text-right text-xs text-suave">Precios con IVA incluido.</p>
      </section>

      {d.cronograma.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-extrabold">Forma y fechas de pago</h2>
          <table className="tabla">
            <tbody>
              {d.cronograma.map((c) => (
                <tr key={c.numero}><td>{c.descripcion} ({c.porcentaje}%)</td><td>{f(c.fecha)}</td><td className="text-right font-semibold">{formatoMoneda(c.valor)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-suave">Las fechas se confirman a partir del día en que se acepta la cotización.</p>
        </section>
      )}

      {d.notas && <section className="text-sm"><p className="etiqueta">Notas</p><p className="whitespace-pre-line">{d.notas}</p></section>}

      {d.medios_pago.length > 0 && (
        <section className="space-y-2 text-sm">
          <h2 className="text-base font-extrabold">Métodos de pago</h2>
          <ul className="space-y-1">{d.medios_pago.map((m) => <li key={m.nombre}><b>{m.nombre}</b>{m.instrucciones && <span className="text-suave"> — {m.instrucciones}</span>}</li>)}</ul>
        </section>
      )}

      {d.terminos && (
        <section className="text-xs text-suave">
          <p className="etiqueta">Términos y condiciones</p>
          <p className="whitespace-pre-line">{d.terminos}</p>
        </section>
      )}
    </article>
  );
}
