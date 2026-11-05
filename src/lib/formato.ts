// Fechas y estados para ventas, abonos y deudas
export const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

export function fecha(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((new Date(hasta + 'T12:00:00').getTime() - new Date(desde + 'T12:00:00').getTime()) / 86400000);
}

export const ESTADOS_VENTA: Record<string, { texto: string; tono: 'gris' | 'ok' | 'alerta' | 'peligro' | 'info' }> = {
  activa: { texto: 'Con saldo', tono: 'info' },
  pagada: { texto: 'Pagada', tono: 'ok' },
  anulada: { texto: 'Anulada', tono: 'gris' },
};

// Antigüedad de la cartera según la cuota pendiente más antigua
export function antiguedad(proxima: string | null, hoy = hoyBogota()): { texto: string; tono: 'gris' | 'ok' | 'alerta' | 'peligro' | 'info'; grupo: string } {
  if (!proxima) return { texto: 'Sin cuotas', tono: 'gris', grupo: 'Al día' };
  const d = diasEntre(proxima.slice(0, 10), hoy);
  if (d <= 0) return { texto: d === 0 ? 'Vence hoy' : `Vence en ${-d} días`, tono: d === 0 ? 'alerta' : 'ok', grupo: 'Al día' };
  if (d <= 30) return { texto: `Vencida ${d} días`, tono: 'alerta', grupo: '1–30 días' };
  if (d <= 60) return { texto: `Vencida ${d} días`, tono: 'peligro', grupo: '31–60 días' };
  if (d <= 90) return { texto: `Vencida ${d} días`, tono: 'peligro', grupo: '61–90 días' };
  return { texto: `Vencida ${d} días`, tono: 'peligro', grupo: 'Más de 90 días' };
}
