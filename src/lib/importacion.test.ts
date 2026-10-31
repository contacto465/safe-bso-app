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
