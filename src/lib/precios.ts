// Cálculos de precio, IVA interno, comisión y margen real de un servicio.
// Reglas de SAFE BSO MIGRATION:
//  - El precio al cliente YA incluye el IVA: base = precio / (1 + IVA).
//  - La comisión del medio de pago está incluida en el pago del cliente (no se cobra aparte).
//  - Fondo de incentivos: % sobre los honorarios antes de IVA y netos de la comisión:
//      fondo = (precio − comisión) / (1 + IVA) × fondo%
//  - Pagos a terceros no llevan IVA, ni fondo, ni son ingreso; solo su recargo de gestión es ingreso.

export type Costo = { tipo: 'fijo' | 'variable'; valor: number };

export type ParametrosMargen = {
  precio: number; // precio al cliente, IVA incluido
  ivaPct: number;
  costos: Costo[];
  comisionPct: number; // comisión del medio de pago (%)
  comisionFija?: number; // valor fijo por transacción
  ivaSobreComision?: boolean; // si la plataforma cobra IVA sobre su comisión
  fondoPct: number; // reserva del fondo de incentivos (%)
  aplicaFondo?: boolean; // false para empresas (sin comisiones) o terceros
};

export type DesgloseMargen = {
  precio: number;
  base: number; // precio sin IVA
  iva: number;
  comision: number; // comisión total del medio (incluye IVA si aplica)
  netoRecibido: number; // lo que entra a la cuenta
  costosFijos: number;
  costosVariables: number;
  fondo: number;
  utilidad: number; // base − comisión − costos − fondo
  margenPct: number; // utilidad / base
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function baseSinIva(precio: number, ivaPct: number): number {
  return r2(precio / (1 + ivaPct / 100));
}

export function comisionMedio(
  valor: number,
  comisionPct: number,
  comisionFija = 0,
  ivaSobreComision = false,
  ivaPct = 19,
): number {
  const c = valor * (comisionPct / 100) + comisionFija;
  return r2(ivaSobreComision ? c * (1 + ivaPct / 100) : c);
}

export function calcularMargen(p: ParametrosMargen): DesgloseMargen {
  const precio = Math.max(0, p.precio || 0);
  const base = baseSinIva(precio, p.ivaPct);
  const iva = r2(precio - base);
  const comision = comisionMedio(precio, p.comisionPct, p.comisionFija, p.ivaSobreComision, p.ivaPct);
  const netoRecibido = r2(precio - comision);
  const costosFijos = r2(p.costos.filter((c) => c.tipo === 'fijo').reduce((a, c) => a + (c.valor || 0), 0));
  const costosVariables = r2(p.costos.filter((c) => c.tipo === 'variable').reduce((a, c) => a + (c.valor || 0), 0));
  const fondo = p.aplicaFondo === false ? 0 : r2(((precio - comision) / (1 + p.ivaPct / 100)) * (p.fondoPct / 100));
  // El IVA se declara sobre el precio completo; la comisión es un gasto financiero de la venta.
  const utilidad = r2(base - comision - costosFijos - costosVariables - fondo);
  const margenPct = base > 0 ? r2((utilidad / base) * 100) : 0;
  return { precio, base, iva, comision, netoRecibido, costosFijos, costosVariables, fondo, utilidad, margenPct };
}

// Precio mínimo para lograr un margen objetivo (búsqueda binaria; las fórmulas son lineales,
// pero así se mantiene correcto si cambian las reglas de comisión).
export function precioParaMargen(p: Omit<ParametrosMargen, 'precio'>, margenObjetivoPct: number): number {
  let lo = 0;
  let hi = 1e12;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (calcularMargen({ ...p, precio: mid }).margenPct >= margenObjetivoPct) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 100) * 100;
}

export function formatoMoneda(valor: number, moneda = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: moneda === 'COP' ? 0 : 2,
  }).format(valor || 0);
}

// Cronograma de pagos de una forma de pago a partir de la fecha de aceptación
export type Cuota = { numero: number; porcentaje: number; dias: number; descripcion?: string };

export function cronograma(total: number, cuotas: Cuota[], desde: Date) {
  let acumulado = 0;
  return cuotas
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((c, i, arr) => {
      const valor = i === arr.length - 1 ? r2(total - acumulado) : r2((total * c.porcentaje) / 100);
      acumulado = r2(acumulado + valor);
      const fecha = new Date(desde);
      fecha.setDate(fecha.getDate() + c.dias);
      return { ...c, valor, fecha };
    });
}

// Día juliano (día del año) usado en el consecutivo: 30 de octubre = 303
export function diaJuliano(fecha: Date): number {
  const inicio = Date.UTC(fecha.getFullYear(), 0, 1);
  const hoy = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  return Math.floor((hoy - inicio) / 86_400_000) + 1;
}
