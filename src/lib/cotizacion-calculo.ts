// Vista previa de los totales de una cotización mientras se arma.
// La base de datos recalcula y valida todo al guardar (app.recalcular_cotizacion); esta función
// replica la misma lógica para mostrar los números en pantalla.

export type ServicioCot = {
  id: string; tipo: 'principal' | 'adicional' | 'tercero'; nombre: string; abreviatura: string;
  precio: number; moneda: string; iva_pct: number; recargo_gestion: number; incluye: string | null;
  forma_pago_id: string | null;
};
export type ItemCot = {
  servicio_id: string; cantidad: number; descuento_tipo: 'pct' | 'valor'; descuento_valor: number;
  recargo_gestion?: number;
};
export type Cuota = { numero: number; porcentaje: number; dias: number; descripcion?: string };

export function calcularCotizacion(
  items: ItemCot[], servicios: Map<string, ServicioCot>, tasas: Record<string, number>, tope: number,
  cuotasForma: Cuota[] | null, fecha = new Date(),
) {
  const errores: string[] = [];
  const lineas = items.map((it) => {
    const s = servicios.get(it.servicio_id)!;
    const tasa = s.moneda === 'COP' ? 1 : tasas[s.moneda] || 0;
    if (!tasa) errores.push(`Falta la TRM de ${s.moneda}`);
    const esTercero = s.tipo === 'tercero';
    const bruto = Math.round(it.cantidad * s.precio * tasa);
    const recargo = esTercero ? Math.round(it.cantidad * (it.recargo_gestion ?? s.recargo_gestion) * tasa) : 0;
    const descuento = esTercero || !bruto ? 0
      : it.descuento_tipo === 'pct' ? Math.round((bruto * it.descuento_valor) / 100) : Math.min(it.descuento_valor, bruto);
    const descuentoPct = bruto ? Math.round((descuento / bruto) * 10000) / 100 : 0;
    if (descuentoPct > tope) errores.push(`El descuento de "${s.nombre}" (${descuentoPct}%) supera el máximo (${tope}%)`);
    return { servicio: s, tasa, bruto, recargo, descuento, descuentoPct, total: bruto + recargo - descuento };
  });
  const brutoHon = lineas.filter((l) => l.servicio.tipo !== 'tercero').reduce((a, l) => a + l.bruto, 0);
  const recargos = lineas.reduce((a, l) => a + l.recargo, 0);
  const descuento = lineas.reduce((a, l) => a + l.descuento, 0);
  const terceros = lineas.filter((l) => l.servicio.tipo === 'tercero').reduce((a, l) => a + l.bruto, 0);
  const descuentoPct = brutoHon ? Math.round((descuento / brutoHon) * 10000) / 100 : 0;
  if (descuentoPct > tope && !errores.some((e) => e.includes('supera'))) errores.push(`El descuento total supera el máximo (${tope}%)`);
  const total = brutoHon + recargos - descuento + terceros;

  const cuotas = cuotasForma?.length ? cuotasForma : [{ numero: 1, porcentaje: 100, dias: 0, descripcion: 'Pago total' }];
  let acum = 0;
  const cronograma = [...cuotas].sort((a, b) => a.numero - b.numero).map((c, i, arr) => {
    const valor = i === arr.length - 1 ? total - acum : Math.round((total * c.porcentaje) / 100);
    acum += valor;
    const f = new Date(fecha);
    f.setDate(f.getDate() + c.dias);
    return { ...c, valor, fecha: f };
  });

  return {
    lineas, errores: [...new Set(errores)], subtotalHonorarios: brutoHon + recargos, descuento, descuentoPct,
    totalHonorarios: brutoHon + recargos - descuento, terceros, total, cronograma,
  };
}

export const ESTADOS_COTIZACION: Record<string, { texto: string; tono: 'gris' | 'info' | 'ok' | 'alerta' | 'peligro' }> = {
  borrador: { texto: 'Borrador', tono: 'gris' },
  enviada: { texto: 'Enviada', tono: 'info' },
  por_reenviar: { texto: 'Actualizada · por reenviar', tono: 'alerta' },
  aceptada: { texto: 'Aceptada', tono: 'ok' },
  rechazada: { texto: 'No aceptada', tono: 'peligro' },
  anulada: { texto: 'Anulada', tono: 'gris' },
};

// TRM oficial del día (Superintendencia Financiera, datos abiertos). Si falla, se escribe a mano.
export async function trmDelDia(): Promise<number | null> {
  try {
    const r = await fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1', {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const [d] = (await r.json()) as { valor?: string }[];
    const v = Number(d?.valor);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  } catch {
    return null;
  }
}
