// Prueba las migraciones y las reglas de seguridad en un Postgres embebido (PGlite).
// Ejecutar: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const db = new PGlite({ extensions: { pgcrypto } });

// Simulación mínima del esquema auth de Supabase
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public, auth to authenticated;
  grant execute on all functions in schema auth to authenticated;
  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant all on sequences to authenticated;
`);
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
}

const U = {
  mauro: '00000000-0000-0000-0000-000000000001',
  baq: '00000000-0000-0000-0000-000000000002',
  bog: '00000000-0000-0000-0000-000000000003',
  cuarto: '00000000-0000-0000-0000-000000000004',
};
const { rows: ofs } = await db.query(`select id, codigo from oficinas`);
const BOG = ofs.find((o) => o.codigo === 'BOG').id;
const BAQ = ofs.find((o) => o.codigo === 'BAQ').id;

// Alta inicial como superusuario (equivale al editor SQL de Supabase)
await db.exec(`
  insert into auth.users values ('${U.mauro}','mauro@x.co'),('${U.baq}','baq@x.co'),('${U.bog}','bog@x.co'),('${U.cuarto}','c@x.co');
  insert into perfiles (id, nombre, correo, rol, ve_todo) values ('${U.mauro}','Mauro','mauro@x.co','admin',true);
  insert into perfiles (id, nombre, correo, rol) values ('${U.baq}','Usuaria BAQ','baq@x.co','finanzas');
  insert into perfiles (id, nombre, correo, rol) values ('${U.bog}','Usuario BOG','bog@x.co','vendedor');
  insert into usuario_oficinas values ('${U.baq}','${BAQ}'),('${U.bog}','${BOG}');
`);

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };

async function como(uid, fn, aal = 'aal2') {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal })]);
    return fn(tx);
  });
}
const falla = async (p, re) => {
  try { await p; } catch (e) { if (re) assert.match(e.message, re); return; }
  assert.fail('se esperaba un error');
};

console.log('Seguridad y oficinas');
await t('límite de 3 usuarios activos', () =>
  falla(db.exec(`insert into perfiles (id,nombre,correo) values ('${U.cuarto}','Cuarto','c@x.co')`), /Límite de usuarios/));
await t('sin verificación en dos pasos no se ve nada', async () => {
  const r = await como(U.mauro, (tx) => tx.query('select * from oficinas'), 'aal1');
  assert.equal(r.rows.length, 0);
});
await t('Mauro (ve todo) ve las 2 oficinas', async () => {
  const r = await como(U.mauro, (tx) => tx.query('select codigo from oficinas order by codigo'));
  assert.deepEqual(r.rows.map((x) => x.codigo), ['BAQ', 'BOG']);
});
await t('la usuaria de Barranquilla solo ve Barranquilla', async () => {
  const r = await como(U.baq, (tx) => tx.query('select codigo from oficinas'));
  assert.deepEqual(r.rows.map((x) => x.codigo), ['BAQ']);
});
await t('la usuaria de Barranquilla no puede cambiarse el alcance', async () => {
  const r = await como(U.baq, (tx) => tx.query(`update perfiles set ve_todo = true where id = '${U.baq}' returning id`));
  assert.equal(r.rows.length, 0);
});
await t('nadie salvo el admin general cambia la configuración', async () => {
  const r = await como(U.baq, (tx) => tx.query(`update configuracion set valor='50' where clave='tope_descuento_pct' returning clave`));
  assert.equal(r.rows.length, 0);
  const r2 = await como(U.mauro, (tx) => tx.query(`update configuracion set valor='30' where clave='tope_descuento_pct' returning clave`));
  assert.equal(r2.rows.length, 1);
});
await t('Mauro no puede quitarse sus propios permisos', () =>
  falla(como(U.mauro, (tx) => tx.query(`update perfiles set ve_todo=false where id='${U.mauro}'`)), /propios permisos/));
await t('al desactivar un usuario se libera un cupo', async () => {
  await como(U.mauro, (tx) => tx.query(`update perfiles set activo=false where id='${U.bog}'`));
  await db.exec(`insert into perfiles (id,nombre,correo) values ('${U.cuarto}','Cuarto','c@x.co')`);
  await falla(db.exec(`update perfiles set activo=true where id='${U.bog}'`), /Límite de usuarios/);
  await db.exec(`delete from perfiles where id='${U.cuarto}'; update perfiles set activo=true where id='${U.bog}'`);
});
await t('un usuario desactivado ya no ve nada', async () => {
  await db.exec(`update perfiles set activo=false where id='${U.bog}'`);
  const r = await como(U.bog, (tx) => tx.query('select * from servicios'));
  assert.equal(r.rows.length, 0);
  await db.exec(`update perfiles set activo=true where id='${U.bog}'`);
});
await t('los cambios quedan en auditoría con el usuario', async () => {
  const r = await db.query(`select usuario_id from auditoria where tabla='configuracion' order by id desc limit 1`);
  assert.equal(r.rows[0].usuario_id, U.mauro);
});

console.log('Catálogo');
let va;
await t('Mauro crea un servicio principal con costos fijos y variables', async () => {
  va = await como(U.mauro, async (tx) => {
    const fp = (await tx.query(`select id from formas_pago where nombre='Contado'`)).rows[0].id;
    const s = (await tx.query(`insert into servicios (tipo,nombre,abreviatura,precio,forma_pago_id)
      values ('principal','Visa Americana','VA',1190000,$1) returning id`, [fp])).rows[0].id;
    await tx.query(`insert into servicio_costos (servicio_id,tipo,concepto,valor) values ($1,'fijo','Asesor',100000),($1,'variable','Formulario',20000)`, [s]);
    return s;
  });
  assert.ok(va);
});
await t('un usuario que no es admin no puede crear servicios', () =>
  falla(como(U.baq, (tx) => tx.query(`insert into servicios (tipo,nombre,abreviatura) values ('principal','X','XX')`)), /row-level security/));
await t('el vendedor ve el servicio pero NO sus costos', async () => {
  const r = await como(U.bog, async (tx) => [
    (await tx.query('select * from servicios')).rows.length,
    (await tx.query('select * from servicio_costos')).rows.length]);
  assert.deepEqual(r, [1, 0]);
});
await t('Finanzas sí ve los costos', async () => {
  const r = await como(U.baq, (tx) => tx.query('select * from servicio_costos'));
  assert.equal(r.rows.length, 2);
});
await t('un pago a tercero no puede llevar IVA', () =>
  falla(como(U.mauro, (tx) => tx.query(`insert into servicios (tipo,nombre,abreviatura,iva_pct) values ('tercero','MRV','MRV',19)`)), /servicios_tercero_sin_iva/));
await t('pago a tercero con recargo de gestión y ligado como adicional', async () => {
  await como(U.mauro, async (tx) => {
    const mrv = (await tx.query(`insert into servicios (tipo,nombre,abreviatura,iva_pct,moneda,precio,recargo_gestion,beneficiario)
      values ('tercero','Tarifa MRV','MRV',0,'USD',185,20,'Embajada de EE. UU.') returning id`)).rows[0].id;
    const tr = (await tx.query(`insert into servicios (tipo,nombre,abreviatura,precio) values ('adicional','Traducción','TR',80000) returning id`)).rows[0].id;
    await tx.query(`insert into servicio_adicionales (principal_id, adicional_id) values ($1,$2),($1,$3)`, [va, mrv, tr]);
  });
});
await t('no se puede ligar un adicional a otro adicional', () =>
  falla(como(U.mauro, async (tx) => {
    const ids = (await tx.query(`select id from servicios where abreviatura in ('TR','MRV') order by abreviatura`)).rows;
    await tx.query(`insert into servicio_adicionales values ($1,$2)`, [ids[1].id, ids[0].id]);
  }), /servicio principal/));
await t('forma de pago que no suma 100% se rechaza', () =>
  falla(como(U.mauro, (tx) => tx.query(`insert into formas_pago (nombre,cuotas) values ('Mal','[{"numero":1,"porcentaje":60,"dias":0}]')`)), /sumar 100/));
await t('abreviatura con minúsculas o repetida se rechaza', async () => {
  await falla(como(U.mauro, (tx) => tx.query(`insert into servicios (tipo,nombre,abreviatura) values ('principal','Y','va')`)));
  await falla(como(U.mauro, (tx) => tx.query(`insert into servicios (tipo,nombre,abreviatura) values ('principal','Y','VA')`)));
});

console.log('Consecutivos');
await t('BOG-303-VA el 30 de octubre, y -02 si se repite el mismo día', async () => {
  const r = await como(U.mauro, async (tx) => [
    (await tx.query(`select app.siguiente_consecutivo($1,'VA','2026-10-30') c`, [BOG])).rows[0].c,
    (await tx.query(`select app.siguiente_consecutivo($1,'VA','2026-10-30') c`, [BOG])).rows[0].c,
    (await tx.query(`select app.siguiente_consecutivo($1,'VA','2026-10-30') c`, [BAQ])).rows[0].c,
    (await tx.query(`select app.siguiente_consecutivo($1,'VA','2026-01-05') c`, [BOG])).rows[0].c]);
  assert.deepEqual(r, ['BOG-303-VA', 'BOG-303-VA-02', 'BAQ-303-VA', 'BOG-005-VA']);
});
await t('la usuaria de Barranquilla no puede numerar en Bogotá', () =>
  falla(como(U.baq, (tx) => tx.query(`select app.siguiente_consecutivo($1,'VA')`, [BOG])), /No tienes acceso/));


console.log('Guardado atómico de servicios');
await t('guardar_servicio crea servicio con costos, adicionales y precio por oficina', async () => {
  const id = await como(U.mauro, async (tx) => {
    const tr = (await tx.query(`select id from servicios where abreviatura='TR'`)).rows[0].id;
    return (await tx.query(`select guardar_servicio($1::jsonb) id`, [JSON.stringify({
      tipo: 'principal', nombre: 'Visa Canadiense', abreviatura: 'vc', precio: 1500000, iva_pct: 19,
      costos: [{ tipo: 'fijo', concepto: 'Asesor', valor: 150000 }, { tipo: 'variable', concepto: '', valor: 1 }],
      adicionales: [tr], precios_oficina: [{ oficina_id: BAQ, precio: 1400000 }, { oficina_id: BOG, precio: '' }],
    })])).rows[0].id;
  });
  const r = await db.query(`select s.abreviatura, (select count(*)::int from servicio_costos where servicio_id=s.id) c,
    (select count(*)::int from servicio_adicionales where principal_id=s.id) a,
    (select count(*)::int from servicio_precios_oficina where servicio_id=s.id) po from servicios s where id=$1`, [id]);
  assert.deepEqual(r.rows[0], { abreviatura: 'VC', c: 1, a: 1, po: 1 });
});
await t('si algo falla no queda nada a medias', async () => {
  const antes = (await db.query(`select count(*)::int n from servicios`)).rows[0].n;
  await falla(como(U.mauro, (tx) => tx.query(`select guardar_servicio($1::jsonb)`, [JSON.stringify({
    tipo: 'principal', nombre: 'Malo', abreviatura: 'MAL', precio: 1, costos: [{ tipo: 'otro', concepto: 'x', valor: 1 }] })])));
  assert.equal((await db.query(`select count(*)::int n from servicios`)).rows[0].n, antes);
});
await t('un no administrador no puede usar guardar_servicio', () =>
  falla(como(U.baq, (tx) => tx.query(`select guardar_servicio('{"tipo":"principal","nombre":"X","abreviatura":"XX"}'::jsonb)`)), /Solo los administradores/));

console.log(`\n${ok} pruebas superadas`);
