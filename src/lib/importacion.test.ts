import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCSV, interpretarFilas, leerNumero, PLANTILLA_CSV } from './importacion.ts';

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
