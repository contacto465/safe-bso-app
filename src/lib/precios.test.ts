import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMargen, cronograma, diaJuliano, baseSinIva, precioParaMargen } from './precios.ts';

test('IVA interno: 1.190.000 con IVA 19% → base 1.000.000', () => {
  assert.equal(baseSinIva(1_190_000, 19), 1_000_000);
});

test('margen real de Visa Americana pagada por plataforma al 3%', () => {
  const m = calcularMargen({
    precio: 1_190_000, ivaPct: 19, comisionPct: 3, fondoPct: 10,
    costos: [{ tipo: 'fijo', valor: 100_000 }, { tipo: 'variable', valor: 20_000 }],
  });
  assert.equal(m.base, 1_000_000);
  assert.equal(m.iva, 190_000);
  assert.equal(m.comision, 35_700); // 3% de 1.190.000
  assert.equal(m.netoRecibido, 1_154_300);
  // fondo = (1.190.000 − 35.700) / 1,19 × 10% = 97.000
  assert.equal(m.fondo, 97_000);
  assert.equal(m.utilidad, 1_000_000 - 35_700 - 120_000 - 97_000);
  assert.equal(m.margenPct, 74.73);
});

test('empresas: sin fondo de comisiones', () => {
  const m = calcularMargen({ precio: 1_190_000, ivaPct: 19, comisionPct: 0, fondoPct: 10, costos: [], aplicaFondo: false });
  assert.equal(m.fondo, 0);
  assert.equal(m.utilidad, 1_000_000);
});

test('precio para lograr un margen objetivo', () => {
  const p = { ivaPct: 19, comisionPct: 3, fondoPct: 10, costos: [{ tipo: 'fijo' as const, valor: 500_000 }] };
  const precio = precioParaMargen(p, 50);
  assert.ok(calcularMargen({ ...p, precio }).margenPct >= 50);
  assert.ok(calcularMargen({ ...p, precio: precio - 1000 }).margenPct < 50);
});

test('cronograma 50/50: la última cuota absorbe el redondeo', () => {
  const c = cronograma(1_000_001, [
    { numero: 1, porcentaje: 50, dias: 0 }, { numero: 2, porcentaje: 50, dias: 30 },
  ], new Date(2026, 9, 30));
  assert.equal(c[0].valor + c[1].valor, 1_000_001);
  assert.equal(c[1].fecha.getMonth(), 10); // 29 de noviembre
  assert.equal(c[1].fecha.getDate(), 29);
});

test('día juliano: 30 de octubre de 2026 = 303, 1 de enero = 1', () => {
  assert.equal(diaJuliano(new Date(2026, 9, 30)), 303);
  assert.equal(diaJuliano(new Date(2026, 0, 1)), 1);
});
