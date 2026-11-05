import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerCargaInicial, leerFecha } from './carga-inicial.ts';

test('fechas de Excel, dd/mm/aaaa y aaaa-mm-dd', () => {
  assert.equal(leerFecha(new Date('2026-11-04T00:00:00Z')), '2026-11-04');
  assert.equal(leerFecha('4/11/2026'), '2026-11-04');
  assert.equal(leerFecha('2026-11-04'), '2026-11-04');
  assert.equal(leerFecha(46330), '2026-11-04');
  assert.equal(leerFecha('ayer'), undefined);
  assert.equal(leerFecha(''), null);
});

const hojas = [
  { sheet: 'Instrucciones', data: [['Carga inicial'], ['Fecha de corte:', '01/11/2026']] },
  { sheet: 'Deudas', data: [
    ['Acreedor', 'Tipo', 'NIT / documento', 'Concepto / para qué fue', 'Fecha del préstamo', 'Valor original', 'SALDO a la fecha de corte', 'Tasa de interés %', 'Tasa es', 'Valor de la cuota', 'Cuotas que faltan', 'Día de pago / próxima fecha', 'Oficina que la asume', '% Bogotá (si es repartida)', '% Barranquilla (si es repartida)', 'Soporte', 'Notas'],
    ['Bancolombia', 'Banco', '', '', '15/03/2026', 20000000, 14500000, 1.6, 'Mensual', 1050000, 18, '05/12/2026', 'BOG', null, null, '', 'Ejemplo'],
    ['Socio', 'Socio', '', '', '', '', '10.000.000', '', 'Sin interés', '', '', '', 'Repartida', 0.7, 0.3, '', ''],
    ['Mala', 'Banco', '', '', '', '', 100, '', '', '', '', '', 'Medellín', '', '', '', ''],
  ] },
  { sheet: 'Pagos de deudas', data: [
    ['Acreedor', 'Fecha del pago', 'Valor total pagado', 'Abono a capital', 'Intereses', 'Otros cargos (seguro, mora)', 'Oficina que pagó', 'Medio de pago', 'Cuenta de donde salió', 'N.º de comprobante', 'Notas'],
    ['Socio', '05/11/2026', 500000, null, null, null, 'BOG', 'Transferencia', '', '', ''],
  ] },
  { sheet: 'Ventas', data: [
    ['N.º de venta', 'Fecha de venta', 'Oficina', 'Nombres del cliente', 'Apellidos', 'Documento', 'Celular', 'Correo', 'Empresa (si es venta a empresa)', 'Servicio (abreviatura)', 'N.º de aplicantes (titular + miembros)', 'Honorarios totales SAFE BSO', 'Descuento dado', 'Derechos consulares / terceros', 'Moneda de terceros', 'Forma de pago', 'Vendedor', '¿Quién lo refirió?', 'Estado del proceso', 'N.º de cotización (si hubo)', 'Notas'],
    [1, '04/11/2026', 'BOG', 'Ricardo', 'Chaparro', '', '3115144466', '', '', 'rp', 2, 597600, 398400, 1280000, 'COP', 'Contado', '', '', 'En proceso', '22441', ''],
  ] },
  { sheet: 'Abonos', data: [
    ['N.º de venta', 'Fecha del pago', 'Valor recibido', 'Se aplica a', 'Medio de pago', 'Cuenta donde entró', 'N.º de comprobante / referencia', 'Recibido por', 'Notas'],
    [1, '04/11/2026', 597600, 'Honorarios', 'Transferencia', '', '', '', ''],
    [7, '04/11/2026', 1000, 'Terceros (embajada)', '', '', '', '', ''],
  ] },
];

test('lee las cuatro hojas, omite la fila de ejemplo y detecta errores por fila', () => {
  const { carga, errores, omitidas } = leerCargaInicial(hojas);
  assert.equal(carga.fecha_corte, '2026-11-01');
  assert.equal(omitidas, 1);
  assert.equal(carga.deudas.length, 2);
  assert.equal(carga.deudas[0].asignacion, 'repartida');
  assert.equal(carga.deudas[0].pct_bog, 70);
  assert.equal(carga.deudas[0].saldo_inicial, 10000000);
  assert.equal(carga.deudas[0].tasa_periodo, 'Sin interés');
  assert.equal(carga.pagos_deudas[0].capital, 500000);
  assert.equal(carga.ventas[0].ref, '1');
  assert.equal(carga.ventas[0].servicio, 'RP');
  assert.match(String(carga.ventas[0].notas), /Cotización 22441/);
  assert.equal(carga.abonos[1].aplica_a, 'terceros');
  assert.deepEqual(errores, [
    'Deudas, fila 4: «Oficina que la asume» debe ser BOG, BAQ, General o Repartida',
    'Abonos, fila 3: la venta N.º 7 no está en la hoja Ventas',
  ]);
});
