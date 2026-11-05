'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import readExcelFile from 'read-excel-file/browser';
import { leerCargaInicial, type ResultadoLectura } from '@/lib/carga-inicial';
import { formatoMoneda } from '@/lib/precios';
import { importarCargaInicial, type ResultadoCarga } from './acciones';

export function CargaInicialForm() {
  const [archivo, setArchivo] = useState('');
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null);
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null);
  const [pendiente, iniciar] = useTransition();

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResultado(null); setLectura(null);
    if (!f) return;
    setArchivo(f.name);
    const hojas = await readExcelFile(f);
    setLectura(leerCargaInicial(hojas.map((h) => ({ sheet: h.sheet, data: h.data as unknown[][] }))));
  }

  const c = lectura?.carga;
  const suma = (filas: Record<string, unknown>[] | undefined, k: string) => (filas ?? []).reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const listo = c && !lectura.errores.length && (c.deudas.length + c.pagos_deudas.length + c.ventas.length + c.abonos.length) > 0;

  return (
    <div className="space-y-5">
      <section className="tarjeta space-y-3">
        <h2 className="text-base font-extrabold">1. Llena la plantilla</h2>
        <p className="text-sm">Escribe la <b>fecha de corte</b> en la hoja Instrucciones y llena las hojas <b>Deudas</b>, <b>Pagos de deudas</b>, <b>Ventas</b> y <b>Abonos</b>. La fila de ejemplo (con «Ejemplo» en Notas) no se carga.</p>
        {/* Descarga de archivo, no navegación */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/plantilla-carga-inicial-safe-bso.xlsx" download className="btn-primario inline-flex">Descargar plantilla de Excel</a>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="text-base font-extrabold">2. Sube el archivo</h2>
        <label className="etiqueta" htmlFor="archivo">Archivo de Excel (.xlsx)</label>
        <input id="archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={leer} className="campo" />
        {c && (
          <div className="space-y-3">
            <p className="text-sm"><b>{archivo}</b>{c.fecha_corte ? <> · fecha de corte <b>{c.fecha_corte}</b></> : <> · <span className="text-alerta font-bold">sin fecha de corte</span> (se usa la fecha de hoy en las deudas)</>}{lectura.omitidas > 0 && <> · {lectura.omitidas} filas de ejemplo omitidas</>}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-superficie-2 p-3 text-sm"><p className="font-bold">Deudas</p><p>{c.deudas.length} · saldo {formatoMoneda(suma(c.deudas, 'saldo_inicial'))}</p></div>
              <div className="rounded-xl bg-superficie-2 p-3 text-sm"><p className="font-bold">Pagos de deudas</p><p>{c.pagos_deudas.length} · capital {formatoMoneda(suma(c.pagos_deudas, 'capital'))}</p></div>
              <div className="rounded-xl bg-superficie-2 p-3 text-sm"><p className="font-bold">Ventas</p><p>{c.ventas.length} · {formatoMoneda(suma(c.ventas, 'honorarios') + suma(c.ventas, 'terceros'))}</p></div>
              <div className="rounded-xl bg-superficie-2 p-3 text-sm"><p className="font-bold">Abonos</p><p>{c.abonos.length} · {formatoMoneda(suma(c.abonos, 'valor'))}</p></div>
            </div>
            {lectura.errores.length > 0 && (
              <div role="alert" className="rounded-xl bg-peligro-fondo p-3 text-sm text-peligro">
                <p className="font-bold">Corrige esto en el Excel y vuelve a subirlo:</p>
                <ul className="mt-1 list-disc pl-5">{lectura.errores.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </section>

      {c && (
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">3. Cargar</h2>
          <p className="text-sm text-suave">Los clientes que no existan se crean solos (se buscan por correo, documento o celular). Cada venta toma su consecutivo con la fecha de la venta.</p>
          <button type="button" className="btn-primario" disabled={!listo || pendiente}
            onClick={() => iniciar(async () => setResultado(await importarCargaInicial(c)))}>{pendiente ? 'Cargando…' : 'Cargar todo'}</button>
          {resultado?.error && <p role="alert" className="text-sm font-semibold text-peligro">{resultado.error}</p>}
          {resultado?.resumen && (
            <div role="status" className="rounded-xl bg-ok-fondo p-3 text-sm text-ok">
              <p className="font-bold">Carga completa: {resultado.resumen.deudas} deudas, {resultado.resumen.pagos_deudas} pagos de deudas, {resultado.resumen.ventas} ventas ({resultado.resumen.clientes_nuevos} clientes nuevos) y {resultado.resumen.abonos} abonos.</p>
              <p className="mt-1"><Link href="/ventas" className="underline">Ver ventas</Link> · <Link href="/abonos" className="underline">Ver cartera</Link> · <Link href="/acreedores" className="underline">Ver deudas</Link></p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
