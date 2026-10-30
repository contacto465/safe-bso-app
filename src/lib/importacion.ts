// Lectura del archivo de carga masiva del catálogo (CSV exportado desde Excel o Google Sheets).
// Excel en español guarda con punto y coma; Google Sheets con coma. Se detecta solo.

export const COLUMNAS = [
  'tipo', 'nombre', 'abreviatura', 'categoria', 'descripcion', 'incluye', 'moneda', 'precio', 'iva',
  'forma_pago', 'costos_fijos', 'costos_variables', 'aplica_a', 'beneficiario', 'recargo_gestion',
] as const;

export const PLANTILLA_CSV = [
  COLUMNAS.join(';'),
  'principal;Visa Americana de turismo;VA;Visas EE. UU.;Asesoría completa para la visa B1/B2;Diligenciamiento DS-160|Agendamiento de cita|Preparación de entrevista;COP;1190000;19;Contado;Asesor:100000;Formulario:20000;;;',
  'adicional;Traducción oficial por página;TR;Documentos;;;COP;80000;19;Contado;;Traductor:45000;VA;;',
  'tercero;Tarifa MRV visa B1/B2;MRV;Visas EE. UU.;;;USD;185;0;;;;VA;Embajada de los Estados Unidos;20',
].join('\n');

export type FilaImportada = {
  linea: number;
  tipo: string;
  nombre: string;
  abreviatura: string;
  categoria: string;
  descripcion: string;
  incluye: string;
  moneda: string;
  precio: number;
  iva: number;
  forma_pago: string;
  costos: { tipo: 'fijo' | 'variable'; concepto: string; valor: number }[];
  aplica_a: string[];
  beneficiario: string;
  recargo_gestion: number;
  errores: string[];
};

export function parsearCSV(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const primera = limpio.split('\n')[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

// Números en formato colombiano o internacional: "1.190.000", "1,190,000", "185.50", "185,5"
export function leerNumero(v: string): number {
  const s = v.replace(/[$\s]|COP|USD/gi, '').trim();
  if (!s) return 0;
  const puntos = (s.match(/\./g) ?? []).length;
  const comas = (s.match(/,/g) ?? []).length;
  let n = s;
  if (puntos && comas) n = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (puntos > 1 || (puntos === 1 && /\.\d{3}$/.test(s))) n = s.replace(/\./g, '');
  else if (comas > 1 || (comas === 1 && /,\d{3}$/.test(s))) n = s.replace(/,/g, '');
  else if (comas === 1) n = s.replace(',', '.');
  const r = Number(n);
  return Number.isFinite(r) ? r : NaN;
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function leerCostos(v: string, tipo: 'fijo' | 'variable', errores: string[]) {
  return v.split(/[|\n]/).map((x) => x.trim()).filter(Boolean).map((par) => {
    const i = par.lastIndexOf(':');
    const concepto = (i > 0 ? par.slice(0, i) : par).trim();
    const valor = i > 0 ? leerNumero(par.slice(i + 1)) : NaN;
    if (!Number.isFinite(valor)) errores.push(`Costo ${tipo} "${par}" debe ser Concepto:valor`);
    return { tipo, concepto, valor: Number.isFinite(valor) ? valor : 0 };
  });
}

export function interpretarFilas(filas: string[][]): FilaImportada[] {
  if (!filas.length) return [];
  const encabezado = filas[0].map(sinTildes);
  const idx = Object.fromEntries(COLUMNAS.map((c) => [c, encabezado.indexOf(c)]));
  const val = (f: string[], c: (typeof COLUMNAS)[number]) => (idx[c] >= 0 ? (f[idx[c]] ?? '').trim() : '');
  const vistas = new Set<string>();

  return filas.slice(1).map((f, i) => {
    const errores: string[] = [];
    const tipoTxt = sinTildes(val(f, 'tipo'));
    const tipo = tipoTxt.startsWith('prin') ? 'principal' : tipoTxt.startsWith('adic') ? 'adicional'
      : tipoTxt.startsWith('terc') || tipoTxt.includes('embajada') ? 'tercero' : '';
    if (!tipo) errores.push('Tipo debe ser principal, adicional o tercero');
    const nombre = val(f, 'nombre');
    if (nombre.length < 2) errores.push('Falta el nombre');
    const abreviatura = val(f, 'abreviatura').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9]{1,6}$/.test(abreviatura)) errores.push('Abreviatura: 1 a 6 letras o números');
    else if (vistas.has(abreviatura)) errores.push(`Abreviatura ${abreviatura} repetida en el archivo`);
    vistas.add(abreviatura);
    const moneda = (val(f, 'moneda') || 'COP').toUpperCase();
    if (!['COP', 'USD', 'CAD', 'EUR'].includes(moneda)) errores.push('Moneda debe ser COP, USD, CAD o EUR');
    const precio = leerNumero(val(f, 'precio'));
    if (!Number.isFinite(precio) || precio < 0) errores.push('Precio no válido');
    const ivaTxt = val(f, 'iva');
    let iva = tipo === 'tercero' ? 0 : ivaTxt === '' ? 19 : leerNumero(ivaTxt.replace('%', ''));
    if (!Number.isFinite(iva) || iva < 0 || iva > 100) { errores.push('IVA no válido'); iva = 0; }
    const recargo = leerNumero(val(f, 'recargo_gestion'));
    return {
      linea: i + 2,
      tipo, nombre, abreviatura,
      categoria: val(f, 'categoria'),
      descripcion: val(f, 'descripcion'),
      incluye: val(f, 'incluye').split('|').map((x) => x.trim()).filter(Boolean).join('\n'),
      moneda,
      precio: Number.isFinite(precio) ? precio : 0,
      iva,
      forma_pago: val(f, 'forma_pago'),
      costos: [...leerCostos(val(f, 'costos_fijos'), 'fijo', errores), ...leerCostos(val(f, 'costos_variables'), 'variable', errores)],
      aplica_a: val(f, 'aplica_a').split(/[|,;\s]+/).map((x) => x.toUpperCase()).filter(Boolean),
      beneficiario: val(f, 'beneficiario'),
      recargo_gestion: tipo === 'tercero' && Number.isFinite(recargo) ? recargo : 0,
      errores,
    };
  });
}
