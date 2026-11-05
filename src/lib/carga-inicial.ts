// Lee el Excel CARGA-INICIAL-SAFE-BSO.xlsx (hojas Deudas, Pagos de deudas, Ventas, Abonos)
// y arma lo que recibe la función importar_carga_inicial de la base de datos.
import { leerNumero } from './importacion.ts';

export type Hoja = { sheet: string; data: unknown[][] };
export type CargaInicial = {
  fecha_corte: string | null;
  deudas: Record<string, unknown>[];
  pagos_deudas: Record<string, unknown>[];
  ventas: Record<string, unknown>[];
  abonos: Record<string, unknown>[];
};
export type ResultadoLectura = { carga: CargaInicial; errores: string[]; omitidas: number };

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Fecha de Excel (Date), texto dd/mm/aaaa o aaaa-mm-dd → aaaa-mm-dd
export function leerFecha(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mes >= 1 && mes <= 12 && d >= 1 && d <= 31) return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined; // no se entiende
}

function num(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = leerNumero(String(v));
  return Number.isFinite(n) ? n : undefined;
}

// Porcentaje: 0.7 (celda con formato %) o 70
function pct(v: unknown): number | null | undefined {
  const n = num(v);
  if (n === null || n === undefined) return n;
  return n > 0 && n <= 1 ? Math.round(n * 10000) / 100 : n;
}

type Col = { clave: string; rotulo: RegExp; tipo?: 'num' | 'fecha' | 'pct' | 'txt'; obligatorio?: boolean };

const DEUDAS: Col[] = [
  { clave: 'acreedor', rotulo: /^acreedor/, obligatorio: true },
  { clave: 'tipo', rotulo: /^tipo/ },
  { clave: 'documento', rotulo: /^nit/ },
  { clave: 'concepto', rotulo: /^concepto/ },
  { clave: 'fecha_prestamo', rotulo: /^fecha del prestamo/, tipo: 'fecha' },
  { clave: 'valor_original', rotulo: /^valor original/, tipo: 'num' },
  { clave: 'saldo_inicial', rotulo: /^saldo/, tipo: 'num', obligatorio: true },
  { clave: 'tasa_pct', rotulo: /^tasa de interes/, tipo: 'num' },
  { clave: 'tasa_periodo', rotulo: /^tasa es/ },
  { clave: 'cuota_valor', rotulo: /^valor de la cuota/, tipo: 'num' },
  { clave: 'cuotas_restantes', rotulo: /^cuotas que faltan/, tipo: 'num' },
  { clave: 'proxima_fecha', rotulo: /^dia de pago|^proxima fecha/, tipo: 'fecha' },
  { clave: 'oficina', rotulo: /^oficina que la asume/, obligatorio: true },
  { clave: 'pct_bog', rotulo: /^% bogota/, tipo: 'pct' },
  { clave: 'pct_baq', rotulo: /^% barranquilla/, tipo: 'pct' },
  { clave: 'soporte', rotulo: /^soporte/ },
  { clave: 'notas', rotulo: /^notas/ },
];
const PAGOS: Col[] = [
  { clave: 'acreedor', rotulo: /^acreedor/, obligatorio: true },
  { clave: 'fecha', rotulo: /^fecha/, tipo: 'fecha', obligatorio: true },
  { clave: 'total', rotulo: /^valor total/, tipo: 'num' },
  { clave: 'capital', rotulo: /^abono a capital/, tipo: 'num' },
  { clave: 'intereses', rotulo: /^intereses/, tipo: 'num' },
  { clave: 'otros', rotulo: /^otros/, tipo: 'num' },
  { clave: 'oficina', rotulo: /^oficina/ },
  { clave: 'medio', rotulo: /^medio/ },
  { clave: 'cuenta', rotulo: /^cuenta/ },
  { clave: 'referencia', rotulo: /^n.? ?º? ?de comprobante|^comprobante/ },
  { clave: 'notas', rotulo: /^notas/ },
];
const VENTAS: Col[] = [
  { clave: 'ref', rotulo: /^n.? ?º? ?de venta/, obligatorio: true },
  { clave: 'fecha', rotulo: /^fecha/, tipo: 'fecha', obligatorio: true },
  { clave: 'oficina', rotulo: /^oficina/, obligatorio: true },
  { clave: 'nombres', rotulo: /^nombres/, obligatorio: true },
  { clave: 'apellidos', rotulo: /^apellidos/, obligatorio: true },
  { clave: 'documento', rotulo: /^documento/ },
  { clave: 'celular', rotulo: /^celular/ },
  { clave: 'correo', rotulo: /^correo/ },
  { clave: 'empresa', rotulo: /^empresa/ },
  { clave: 'servicio', rotulo: /^servicio/ },
  { clave: 'aplicantes', rotulo: /^n.? ?º? ?de aplicantes/, tipo: 'num' },
  { clave: 'honorarios', rotulo: /^honorarios/, tipo: 'num' },
  { clave: 'descuento', rotulo: /^descuento/, tipo: 'num' },
  { clave: 'terceros', rotulo: /^derechos consulares/, tipo: 'num' },
  { clave: 'moneda_terceros', rotulo: /^moneda/ },
  { clave: 'forma_pago', rotulo: /^forma de pago/ },
  { clave: 'vendedor', rotulo: /^vendedor/ },
  { clave: 'referido_por', rotulo: /^.?quien lo refirio/ },
  { clave: 'estado_proceso', rotulo: /^estado/ },
  { clave: 'cotizacion', rotulo: /^n.? ?º? ?de cotizacion/ },
  { clave: 'notas', rotulo: /^notas/ },
];
const ABONOS: Col[] = [
  { clave: 'ref', rotulo: /^n.? ?º? ?de venta/, obligatorio: true },
  { clave: 'fecha', rotulo: /^fecha/, tipo: 'fecha', obligatorio: true },
  { clave: 'valor', rotulo: /^valor/, tipo: 'num', obligatorio: true },
  { clave: 'aplica', rotulo: /^se aplica/ },
  { clave: 'medio', rotulo: /^medio/ },
  { clave: 'cuenta', rotulo: /^cuenta/ },
  { clave: 'referencia', rotulo: /^n.? ?º? ?de comprobante|^comprobante/ },
  { clave: 'recibido_por', rotulo: /^recibido/ },
  { clave: 'notas', rotulo: /^notas/ },
];

function leerHoja(h: Hoja | undefined, nombre: string, cols: Col[], errores: string[], omitidas: { n: number }) {
  if (!h || !h.data.length) return [];
  const enc = (h.data[0] ?? []).map(norm);
  const idx = cols.map((c) => enc.findIndex((e) => c.rotulo.test(e)));
  const filas: Record<string, unknown>[] = [];
  h.data.slice(1).forEach((fila, i) => {
    const nFila = i + 2;
    if (!fila || fila.every((v) => v === null || v === undefined || String(v).trim() === '')) return;
    const r: Record<string, unknown> = {};
    cols.forEach((c, k) => {
      const v = idx[k] >= 0 ? fila[idx[k]] : null;
      if (c.tipo === 'num') {
        const n = num(v);
        if (n === undefined) errores.push(`${nombre}, fila ${nFila}: «${String(v)}» no es un número (${c.clave.replace('_', ' ')})`);
        r[c.clave] = n ?? null;
      } else if (c.tipo === 'pct') {
        const n = pct(v);
        if (n === undefined) errores.push(`${nombre}, fila ${nFila}: «${String(v)}» no es un porcentaje`);
        r[c.clave] = n ?? null;
      } else if (c.tipo === 'fecha') {
        const f = leerFecha(v);
        if (f === undefined) errores.push(`${nombre}, fila ${nFila}: «${String(v)}» no es una fecha (usa dd/mm/aaaa)`);
        r[c.clave] = f ?? null;
      } else {
        r[c.clave] = v === null || v === undefined ? null : String(v).trim() || null;
      }
    });
    // La fila de ejemplo de la plantilla no se carga
    if (norm(r.notas) === 'ejemplo') { omitidas.n++; return; }
    for (const c of cols) {
      if (c.obligatorio && (r[c.clave] === null || r[c.clave] === '')) {
        errores.push(`${nombre}, fila ${nFila}: falta «${h.data[0]?.[idx[cols.indexOf(c)]] ?? c.clave}»`);
      }
    }
    r._fila = nFila;
    filas.push(r);
  });
  return filas;
}

const OFICINA: Record<string, string> = { bog: 'BOG', bogota: 'BOG', baq: 'BAQ', barranquilla: 'BAQ' };

export function leerCargaInicial(hojas: Hoja[]): ResultadoLectura {
  const errores: string[] = [];
  const omitidas = { n: 0 };
  const buscar = (re: RegExp) => hojas.find((h) => re.test(norm(h.sheet)));

  // Fecha de corte: celda junto a «Fecha de corte:» en Instrucciones
  let fecha_corte: string | null = null;
  for (const fila of buscar(/^instrucciones/)?.data ?? []) {
    const i = fila.findIndex((v) => /^fecha de corte/.test(norm(v)));
    if (i >= 0) {
      const f = leerFecha(fila[i + 1]);
      if (f === undefined) errores.push('Instrucciones: la fecha de corte no es una fecha válida');
      fecha_corte = f ?? null;
    }
  }

  const deudas = leerHoja(buscar(/^deudas/), 'Deudas', DEUDAS, errores, omitidas).map((d) => {
    const of = norm(d.oficina);
    const asignacion = of === 'general' ? 'general' : of === 'repartida' ? 'repartida' : 'oficina';
    if (asignacion === 'oficina' && !OFICINA[of]) errores.push(`Deudas, fila ${d._fila}: «Oficina que la asume» debe ser BOG, BAQ, General o Repartida`);
    if (asignacion === 'repartida' && Math.round((Number(d.pct_bog ?? 0) + Number(d.pct_baq ?? 0)) * 100) !== 10000) {
      errores.push(`Deudas, fila ${d._fila}: en una deuda repartida, % Bogotá + % Barranquilla debe dar 100%`);
    }
    const periodo = norm(d.tasa_periodo);
    return { ...d, oficina: OFICINA[of] ?? null, asignacion,
      tasa_periodo: periodo.startsWith('anual') ? 'Anual' : periodo.startsWith('sin') ? 'Sin interés' : 'Mensual',
      tipo: d.tipo ?? 'Banco' };
  });

  const pagos_deudas = leerHoja(buscar(/^pagos de deudas/), 'Pagos de deudas', PAGOS, errores, omitidas).map((p) => {
    let capital = p.capital as number | null; const intereses = (p.intereses as number | null) ?? 0; const otros = (p.otros as number | null) ?? 0;
    // Si solo escribió el total, todo va a capital
    if (capital === null && p.total !== null) capital = Number(p.total) - intereses - otros;
    if (!capital && !intereses && !otros) errores.push(`Pagos de deudas, fila ${p._fila}: escribe el abono a capital y/o los intereses`);
    return { ...p, capital: capital ?? 0, intereses, otros, oficina: OFICINA[norm(p.oficina)] ?? null };
  });

  const ventas = leerHoja(buscar(/^ventas/), 'Ventas', VENTAS, errores, omitidas).map((v) => {
    const oficina = OFICINA[norm(v.oficina)];
    if (!oficina) errores.push(`Ventas, fila ${v._fila}: la oficina debe ser BOG o BAQ`);
    if (!Number(v.honorarios) && !Number(v.terceros)) errores.push(`Ventas, fila ${v._fila}: escribe los honorarios o los derechos consulares`);
    const notas = [v.notas, v.cotizacion ? `Cotización ${v.cotizacion}` : null, v.empresa ? `Empresa: ${v.empresa}` : null,
      v.moneda_terceros && v.moneda_terceros !== 'COP' ? `Terceros cotizados en ${v.moneda_terceros}` : null].filter(Boolean).join(' · ');
    return { ...v, ref: String(v.ref ?? '').replace(/\.0$/, ''), oficina, servicio: v.servicio ? String(v.servicio).toUpperCase() : null,
      honorarios: v.honorarios ?? 0, terceros: v.terceros ?? 0, notas: notas || null };
  });
  const refs = new Set(ventas.map((v) => v.ref));
  if (refs.size !== ventas.length) errores.push('Ventas: hay números de venta repetidos');

  const abonos = leerHoja(buscar(/^abonos/), 'Abonos', ABONOS, errores, omitidas).map((a) => {
    const ref = String(a.ref ?? '').replace(/\.0$/, '');
    if (ref && !refs.has(ref)) errores.push(`Abonos, fila ${a._fila}: la venta N.º ${ref} no está en la hoja Ventas`);
    if (Number(a.valor) <= 0) errores.push(`Abonos, fila ${a._fila}: el valor debe ser mayor que cero`);
    return { ...a, ref, aplica_a: /tercero|embajada/.test(norm(a.aplica)) ? 'terceros' : 'honorarios' };
  });

  return { carga: { fecha_corte, deudas, pagos_deudas, ventas, abonos }, errores, omitidas: omitidas.n };
}
