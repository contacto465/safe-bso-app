import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCSV, interpretarFilas, leerNumero, leerFormaPago, PLANTILLA_CSV } from './importacion.ts';

test('números colombianos e internacionales', () => {
  assert.equal(leerNumero('1.190.000'), 1_190_000);
  assert.equal(leerNumero('$ 1.190.000'), 1_190_000);
  assert.equal(leerNumero('1,190,000'), 1_190_000);
  assert.equal(leerNumero('185,50'), 185.5);
  assert.equal(leerNumero('185.5'), 185.5);
  assert.equal(leerNumero('80000'), 80_000);
  assert.equal(leerNumero('1.234,56'), 1234.56);
});

test('la plantilla se lee sin errores', () => {
  const filas = interpretarFilas(parsearCSV(PLANTILLA_CSV));
  assert.equal(filas.length, 3);
  assert.deepEqual(filas.map((f) => f.errores), [[], [], []]);
  assert.equal(filas[0].incluye.split('\n').length, 3);
  assert.deepEqual(filas[0].costos, [{ tipo: 'fijo', concepto: 'Asesor', valor: 100000 }, { tipo: 'variable', concepto: 'Formulario', valor: 20000 }]);
  assert.equal(filas[2].iva, 0);
  assert.equal(filas[2].recargo_gestion, 20);
  assert.deepEqual(filas[2].aplica_a, ['VA']);
});

test('CSV de Google Sheets con comas y comillas', () => {
  const t = 'Tipo,Nombre,Abreviatura,Precio\nprincipal,"Visa, Canadá",vc,"1.500.000"\n';
  const [f] = interpretarFilas(parsearCSV(t));
  assert.equal(f.nombre, 'Visa, Canadá');
  assert.equal(f.abreviatura, 'VC');
  assert.equal(f.precio, 1_500_000);
});

test('detecta errores por fila', () => {
  const t = 'tipo;nombre;abreviatura;precio\nxx;A;X1;abc\nprincipal;Bien;VA;10\nprincipal;Otra;VA;10';
  const f = interpretarFilas(parsearCSV(t));
  assert.ok(f[0].errores.length >= 3);
  assert.deepEqual(f[1].errores, []);
  assert.match(f[2].errores[0], /repetida/);
});

test('forma de pago escrita en palabras', () => {
  assert.deepEqual(leerFormaPago('50% al aceptar + 50% a 30 días'), { nombre: '50% al aceptar + 50% a 30 días', cuotas: [
    { numero: 1, porcentaje: 50, dias: 0, descripcion: 'Anticipo' }, { numero: 2, porcentaje: 50, dias: 30, descripcion: 'Saldo' }] });
  const tres = leerFormaPago('40% al aceptar, 30% a 30 dias y 30% a 60 días') as { cuotas: { descripcion: string }[] };
  assert.deepEqual(tres.cuotas.map((c) => c.descripcion), ['Anticipo', 'Cuota 2', 'Saldo']);
  assert.equal((leerFormaPago('Contado') as { nombre: string }).nombre, 'Contado');
  assert.equal(leerFormaPago('Mi forma especial'), null); // nombre de una forma ya creada
  assert.match((leerFormaPago('50% al aceptar + 40% a 30 días') as { error: string }).error, /suman 90%/);
  assert.match((leerFormaPago('50% cuando llegue la visa + 50% al aceptar') as { error: string }).error, /No entendí/);
});

test('celdas numéricas de Excel', () => {
  const f = interpretarFilas([['tipo', 'nombre', 'abreviatura', 'precio', 'iva', 'forma_pago'], ['principal', 'Visa', 'VA', 1190000, 19, 'Contado']]);
  assert.equal(f[0].precio, 1190000);
  assert.deepEqual(f[0].errores, []);
  assert.equal(f[0].forma_pago_cuotas?.length, 1);
});

test('ficha de costeo vertical: un servicio por columna', () => {
  const hoja = [
    ['Catálogo'], ['Comisión (%)', '', 3], [],
    ['CONCEPTO', 'CÓMO LLENARLO', 'VA (ejemplo)', 'Servicio 2', 'Servicio 3'],
    ['1. DATOS DEL SERVICIO'],
    ['Tipo', '', 'principal', 'tercero', ''], ['Nombre del servicio', '', 'Visa Americana', 'Tarifa MRV', ''],
    ['Abreviatura', '', 'VA', 'MRV', ''], ['Tiempo estimado', '', '6 semanas', '', ''], ['Moneda', '', 'COP', 'USD', ''],
    ['Forma de pago', '', '50% al aceptar + 50% a 30 días', '', ''], ['Aplica a (adicionales y terceros)', '', '', 'VA', ''],
    ['2. COSTOS FIJOS (no dependen del caso)'], ['Honorarios del asesor', '', 100000, null, null], ['Otro costo fijo', '', null, null, null],
    ['3. COSTOS VARIABLES (cambian con cada caso)'], ['Mensajería: DHL', '', 15000, null, null],
    ['4. PRECIO Y RESULTADO'], ['Precio al cliente (con IVA)', '', 1190000, 185, null], ['IVA (%)', '', 19, 0, null],
    ['5. CÁLCULOS AUTOMÁTICOS'], ['Valor antes de IVA', 'Fórmula', 1000000, 185, null], ['IVA incluido', 'Fórmula', 190000, 0, null],
  ];
  const f = interpretarFilas(hoja);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.errores), [[], []]);
  assert.equal(f[0].tiempo_estimado, '6 semanas');
  assert.equal(f[0].iva, 19);
  assert.deepEqual(f[0].costos, [{ tipo: 'fijo', concepto: 'Honorarios del asesor', valor: 100000 }, { tipo: 'variable', concepto: 'Mensajería  DHL', valor: 15000 }]);
  assert.equal(f[1].tipo, 'tercero'); assert.equal(f[1].iva, 0); assert.deepEqual(f[1].aplica_a, ['VA']);
});
