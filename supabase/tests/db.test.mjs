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
  grant usage on schema public, auth to authenticated, anon;
  grant execute on all functions in schema auth to authenticated, anon;
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
await t('BOG-303-VA-MARIAC: oficina, día juliano, servicio y cliente', async () => {
  const c = (of, ab, n, a, f) => `select app.siguiente_consecutivo('${of}','${ab}','${n}','${a}','${f}') c`;
  const r = await como(U.mauro, async (tx) => [
    (await tx.query(c(BOG, 'VA', 'María José', 'Castro Díaz', '2026-10-30'))).rows[0].c,
    (await tx.query(c(BOG, 'VA', 'Maria', 'Castro', '2026-10-30'))).rows[0].c,
    (await tx.query(c(BOG, 'VA', 'Ñusta', 'Ávila', '2026-10-30'))).rows[0].c,
    (await tx.query(c(BAQ, 'VA', 'María', 'Castro', '2026-10-30'))).rows[0].c,
    (await tx.query(c(BOG, 'VA', 'María', 'Castro', '2026-01-05'))).rows[0].c]);
  assert.deepEqual(r, ['BOG-303-VA-MARIAC', 'BOG-303-VA-MARIAC-02', 'BOG-303-VA-NUSTAA', 'BAQ-303-VA-MARIAC', 'BOG-005-VA-MARIAC']);
});
await t('la usuaria de Barranquilla no puede numerar en Bogotá', () =>
  falla(como(U.baq, (tx) => tx.query(`select app.siguiente_consecutivo($1,'VA','Ana','Ruiz')`, [BOG])), /No tienes acceso/));

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


console.log('Clientes y cotizaciones (fase 2)');
let cli, cliBaq, cot, token;
await t('crear clientes por oficina; Barranquilla no ve los de Bogotá', async () => {
  cli = await como(U.mauro, async (tx) => (await tx.query(`insert into clientes (oficina_id, nombres, apellidos) values ($1,'María José','Castro') returning id`, [BOG])).rows[0].id);
  cliBaq = await como(U.baq, async (tx) => (await tx.query(`insert into clientes (oficina_id, nombres, apellidos) values ($1,'Jorge','Díaz') returning id`, [BAQ])).rows[0].id);
  const r = await como(U.baq, (tx) => tx.query('select nombres from clientes'));
  assert.deepEqual(r.rows.map((x) => x.nombres), ['Jorge']);
  await falla(como(U.baq, (tx) => tx.query(`insert into clientes (oficina_id, nombres, apellidos) values ($1,'X','Y')`, [BOG])), /row-level security/);
});
await t('cotización con principal, adicional y tercero en USD: consecutivo, totales y cronograma', async () => {
  cot = await como(U.mauro, async (tx) => {
    const ids = Object.fromEntries((await tx.query(`select abreviatura, id from servicios`)).rows.map((x) => [x.abreviatura, x.id]));
    const fp = (await tx.query(`select id from formas_pago where nombre like '50%%'`)).rows[0].id;
    await tx.query(`update servicios set forma_pago_id=$1 where abreviatura='VA'`, [fp]);
    return (await tx.query(`select guardar_cotizacion($1::jsonb) id`, [JSON.stringify({
      oficina_id: BOG, cliente_id: cli, tasas: { USD: 4000 },
      items: [
        { servicio_id: ids.TR, cantidad: 2, descuento_tipo: 'valor', descuento_valor: 16000 },
        { servicio_id: ids.VA, descuento_tipo: 'pct', descuento_valor: 10 },
        { servicio_id: ids.MRV },
      ] })])).rows[0].id;
  });
  const c = (await db.query(`select * from cotizaciones where id=$1`, [cot])).rows[0];
  token = c.token_publico;
  const doy = (await db.query(`select lpad(extract(doy from app.hoy())::text,3,'0') d`)).rows[0].d;
  assert.match(c.consecutivo, new RegExp(`^BOG-${doy}-VA-MARIAC(-\\d{2})?$`));
  // VA 1.190.000 -10% = 1.071.000; TR 2×80.000=160.000 -16.000 = 144.000; MRV 185 USD×4000=740.000 + recargo 20×4000=80.000
  assert.equal(Number(c.subtotal_honorarios), 1190000 + 160000 + 80000);
  assert.equal(Number(c.descuento_total), 119000 + 16000);
  assert.equal(Number(c.total_terceros), 740000);
  assert.equal(Number(c.total), 1071000 + 144000 + 80000 + 740000);
  assert.equal(c.estado, 'borrador');
  assert.equal(c.cronograma.length, 2);
  assert.equal(c.cronograma[0].valor + c.cronograma[1].valor, Number(c.total));
  assert.equal(Number(c.tope_descuento_pct), 30);
});
await t('descuento por encima del 30% se bloquea', () =>
  falla(como(U.mauro, async (tx) => {
    const va = (await tx.query(`select id from servicios where abreviatura='VA'`)).rows[0].id;
    await tx.query(`select guardar_cotizacion($1::jsonb)`, [JSON.stringify({ oficina_id: BOG, cliente_id: cli, items: [{ servicio_id: va, descuento_valor: 31 }] })]);
  }), /supera el máximo/));
await t('empresa: tope del 40%', async () => {
  const id = await como(U.mauro, async (tx) => {
    const e = (await tx.query(`insert into empresas (oficina_id, razon_social) values ($1,'Acme Global SAS') returning id`, [BOG])).rows[0].id;
    const c2 = (await tx.query(`insert into clientes (oficina_id, nombres, apellidos, empresa_id) values ($1,'Luis','Pérez',$2) returning id`, [BOG, e])).rows[0].id;
    const va = (await tx.query(`select id from servicios where abreviatura='VA'`)).rows[0].id;
    return (await tx.query(`select guardar_cotizacion($1::jsonb) id`, [JSON.stringify({ oficina_id: BOG, cliente_id: c2, a_nombre_de_empresa: true, items: [{ servicio_id: va, descuento_valor: 40 }] })])).rows[0].id;
  });
  const c = (await db.query(`select consecutivo, descuento_pct, tope_descuento_pct from cotizaciones where id=$1`, [id])).rows[0];
  assert.equal(Number(c.descuento_pct), 40);
  assert.match(c.consecutivo, /-VA-ACMEG$/);
});
await t('falta TRM para un ítem en dólares → error claro', () =>
  falla(como(U.mauro, async (tx) => {
    const mrv = (await tx.query(`select id from servicios where abreviatura='MRV'`)).rows[0].id;
    await tx.query(`select guardar_cotizacion($1::jsonb)`, [JSON.stringify({ oficina_id: BOG, cliente_id: cli, items: [{ servicio_id: mrv }] })]);
  }), /TRM/));
await t('Barranquilla no puede cotizar para un cliente de Bogotá ni ver su cotización', async () => {
  await falla(como(U.baq, (tx) => tx.query(`select guardar_cotizacion($1::jsonb)`, [JSON.stringify({ oficina_id: BOG, cliente_id: cli, items: [] })])), /No tienes acceso/);
  const r = await como(U.baq, (tx) => tx.query('select id from cotizaciones'));
  assert.equal(r.rows.length, 0);
});
await t('borrador no es visible por el enlace público; enviada sí, sin datos internos', async () => {
  const antes = await db.query(`select cotizacion_publica($1) j`, [token]);
  assert.equal(antes.rows[0].j, null);
  await como(U.mauro, (tx) => tx.query(`select enviar_cotizacion($1)`, [cot]));
  const pub = await db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query(`select cotizacion_publica($1) j`, [token])).rows[0].j; });
  assert.equal(pub.vigente, true);
  assert.equal(pub.items.length, 3);
  assert.ok(!JSON.stringify(pub).includes('costo'));
});
await t('el cliente sin sesión no puede leer tablas, solo usar su enlace', async () => {
  await falla(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select * from cotizaciones'); }));
});
await t('editar una enviada crea versión nueva y vuelve a borrador', async () => {
  await como(U.mauro, async (tx) => {
    const va = (await tx.query(`select id from servicios where abreviatura='VA'`)).rows[0].id;
    await tx.query(`select guardar_cotizacion($1::jsonb)`, [JSON.stringify({ id: cot, oficina_id: BOG, cliente_id: cli, tasas: { USD: 4000 }, items: [{ servicio_id: va }] })]);
  });
  const c = (await db.query(`select version, estado, consecutivo from cotizaciones where id=$1`, [cot])).rows[0];
  assert.equal(c.version, 2); assert.equal(c.estado, 'borrador');
  assert.equal((await db.query(`select count(*)::int n from cotizacion_versiones where cotizacion_id=$1`, [cot])).rows[0].n, 1);
});
await t('vencida: se actualiza sola pero NO se envía; el cliente no puede aceptarla', async () => {
  await como(U.mauro, (tx) => tx.query(`select enviar_cotizacion($1)`, [cot]));
  await db.query(`update servicios set precio = 1300000 where abreviatura='VA'`);
  await db.query(`update cotizaciones set fecha_vencimiento = app.hoy() - 1 where id=$1`, [cot]);
  await falla(db.query(`select responder_cotizacion($1,'aceptar')`, [token]), /venció/);
  const n = (await db.query(`select app.actualizar_vencidas() n`)).rows[0].n;
  assert.equal(n, 1);
  const c = (await db.query(`select estado, version, total from cotizaciones where id=$1`, [cot])).rows[0];
  assert.equal(c.estado, 'por_reenviar'); assert.equal(c.version, 3); assert.equal(Number(c.total), 1300000);
  const pub = (await db.query(`select cotizacion_publica($1) j`, [token])).rows[0].j;
  assert.equal(pub.vigente, false);
});
await t('Reenviar → vigente de nuevo y el cliente la acepta', async () => {
  await como(U.mauro, (tx) => tx.query(`select enviar_cotizacion($1)`, [cot]));
  const r = await db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query(`select responder_cotizacion($1,'aceptar','¡Listo!') r`, [token])).rows[0].r; });
  assert.equal(r, 'aceptada');
  await falla(como(U.mauro, (tx) => tx.query(`select guardar_cotizacion($1::jsonb)`, [JSON.stringify({ id: cot, oficina_id: BOG, cliente_id: cli, items: [{ servicio_id: '00000000-0000-0000-0000-000000000000' }] })])), /no se puede editar/);
});

console.log(`\n${ok} pruebas superadas`);
