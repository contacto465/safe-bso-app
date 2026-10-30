'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { parsearCSV, interpretarFilas, COLUMNAS, type FilaImportada } from '@/lib/importacion';
import { formatoMoneda } from '@/lib/precios';
import { importarServicios, type ResultadoImportacion } from './acciones';

const AYUDA: Record<string, string> = {
  tipo: 'principal, adicional o tercero',
  abreviatura: '1 a 6 letras/números; va en el consecutivo',
  incluye: 'puntos separados por |',
  precio: 'IVA incluido; 1.190.000 o 1190000',
  iva: 'por defecto 19; terceros siempre 0',
  forma_pago: 'nombre exacto de una forma de pago creada',
  costos_fijos: 'Concepto:valor | Concepto:valor',
  costos_variables: 'Concepto:valor | Concepto:valor',
  aplica_a: 'para adicionales y terceros: abreviaturas de los principales (VA | VC)',
  recargo_gestion: 'solo pagos a terceros',
};

export function CargaCatalogo() {
  const [filas, setFilas] = useState<FilaImportada[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [pendiente, iniciar] = useTransition();

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResultado(null);
    if (!f) return;
    setArchivo(f.name);
    setFilas(interpretarFilas(parsearCSV(await f.text())));
  }

  const conError = filas?.filter((f) => f.errores.length) ?? [];
  const validas = filas?.filter((f) => !f.errores.length) ?? [];

  return (
    <div className="space-y-5">
      <section className="tarjeta space-y-3">
        <h2 className="text-base font-extrabold">1. Prepara el archivo</h2>
        <p className="text-sm">
          Descarga la plantilla, ábrela en Excel, llena una fila por servicio y guárdala como <b>CSV (delimitado por punto y coma)</b>.
        </p>
        {/* Descarga de archivo, no navegación */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/catalogo/plantilla" download className="btn-secundario">Descargar plantilla</a>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-info">Ver columnas</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {COLUMNAS.map((c) => <li key={c}><code className="font-bold">{c}</code>{AYUDA[c] && <span className="text-suave"> — {AYUDA[c]}</span>}</li>)}
          </ul>
        </details>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="text-base font-extrabold">2. Sube el archivo</h2>
        <label className="etiqueta" htmlFor="archivo">Archivo CSV</label>
        <input id="archivo" type="file" accept=".csv,text/csv" onChange={leer} className="campo" />
        {archivo && filas && (
          <p className="text-sm">
            <b>{archivo}</b>: {filas.length} filas · <span className="text-ok font-bold">{validas.length} listas</span>
            {conError.length > 0 && <> · <span className="text-peligro font-bold">{conError.length} con errores (no se cargan)</span></>}
          </p>
        )}
      </section>

      {filas && filas.length > 0 && (
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">3. Revisa y carga</h2>
          <div className="max-h-[420px] overflow-auto">
            <table className="tabla min-w-[760px]">
              <thead><tr><th>Línea</th><th>Tipo</th><th>Servicio</th><th className="text-right">Precio</th><th>Forma de pago</th><th>Costos</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.linea}>
                    <td>{f.linea}</td>
                    <td>{f.tipo || '—'}</td>
                    <td><b>{f.nombre}</b> <span className="text-suave">· {f.abreviatura}</span></td>
                    <td className="text-right">{formatoMoneda(f.precio, f.moneda)}</td>
                    <td>{f.forma_pago || <span className="text-suave">—</span>}</td>
                    <td>{f.costos.length}</td>
                    <td>{f.errores.length ? <span className="text-xs font-semibold text-peligro">{f.errores.join('; ')}</span> : <span className="text-xs font-bold text-ok">Lista</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-primario" disabled={!validas.length || pendiente}
            onClick={() => iniciar(async () => setResultado(await importarServicios(validas)))}>
            {pendiente ? 'Cargando…' : `Cargar ${validas.length} servicio(s)`}
          </button>
        </section>
      )}

      {resultado && (
        <section className="tarjeta space-y-2" role="status">
          <h2 className="text-base font-extrabold">Resultado</h2>
          <p className="text-sm">{resultado.creados} creados · {resultado.actualizados} actualizados · {resultado.enlaces} adicionales enlazados</p>
          {resultado.avisos.length > 0 && <ul className="list-disc pl-5 text-sm text-alerta">{resultado.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
          {resultado.errores.length > 0 && <ul className="list-disc pl-5 text-sm text-peligro">{resultado.errores.map((a) => <li key={a}>{a}</li>)}</ul>}
          <Link href="/catalogo" className="btn-secundario">Ver catálogo</Link>
        </section>
      )}
    </div>
  );
}
