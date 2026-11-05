import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ESTADOS_COTIZACION } from '@/lib/cotizacion-calculo';
import { DocumentoCotizacion, type DocCotizacion } from '@/components/documento-cotizacion';
import { Encabezado, Aviso, Insignia } from '@/components/ui';
import { AccionesCotizacion } from './acciones-cliente';

export const metadata: Metadata = { title: 'Cotización' };
const n = (v: unknown) => Number(v ?? 0);

export default async function VerCotizacion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardada?: string }> }) {
  const { id } = await params;
  const { guardada } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requerirSesion();
  const supabase = await createClient();
  const { data: c } = await supabase.from('cotizaciones')
    .select('*, clientes(nombres, apellidos, documento, celular), empresas(razon_social, nit), oficinas(nombre, ciudad, direccion, telefono, correo), cotizacion_items(*)')
    .eq('id', id).maybeSingle();
  if (!c) notFound();
  const [{ data: emisor }, { data: medios }, { data: terminos }, { data: versiones }, { data: venta }] = await Promise.all([
    supabase.from('empresa').select('razon_social, nit').eq('id', 1).maybeSingle(),
    supabase.from('medios_pago').select('nombre, instrucciones, oficina_id, orden').eq('activo', true).order('orden'),
    supabase.from('configuracion').select('valor').eq('clave', 'terminos_cotizacion').maybeSingle(),
    supabase.from('cotizacion_versiones').select('version, motivo, creado_en').eq('cotizacion_id', id).order('version', { ascending: false }),
    supabase.from('ventas').select('id').eq('cotizacion_id', id).maybeSingle(),
  ]);
  const cl = c.clientes as { nombres: string; apellidos: string; documento: string | null; celular: string | null };
  const items = (c.cotizacion_items as Record<string, unknown>[]).sort((a, b) => n(a.orden) - n(b.orden));
  const d: DocCotizacion = {
    consecutivo: c.consecutivo, tipo: c.tipo, version: c.version, fecha_emision: c.fecha_emision, fecha_vencimiento: c.fecha_vencimiento,
    subtotal_honorarios: n(c.subtotal_honorarios), descuento_total: n(c.descuento_total), total_honorarios: n(c.total_honorarios),
    iva_incluido: n(c.iva_incluido), total_terceros: n(c.total_terceros), total: n(c.total), notas: c.notas, tasas: c.tasas, cronograma: c.cronograma,
    cliente: { nombre: `${cl.nombres} ${cl.apellidos}`, documento: cl.documento }, empresa: c.empresas, oficina: c.oficinas,
    emisor: emisor ?? { razon_social: 'SAFE BSO MIGRATION', nit: null },
    items: items.map((i) => ({ descripcion: String(i.descripcion), incluye: i.incluye as string | null, tipo: String(i.tipo), cantidad: n(i.cantidad), moneda: String(i.moneda),
      precio_unitario: n(i.precio_unitario), bruto: n(i.bruto), recargo: n(i.recargo), descuento: n(i.descuento), total: n(i.total) })),
    medios_pago: (medios ?? []).filter((m) => !m.oficina_id || m.oficina_id === c.oficina_id),
    terminos: (terminos?.valor as string) ?? null,
  };
  const h = await headers();
  const enlace = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}/c/${c.token_publico}`;
  const est = ESTADOS_COTIZACION[c.estado];
  const vencida = c.estado === 'enviada' && c.fecha_vencimiento < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  return (
    <>
      <div className="print:hidden">
        <Encabezado titulo={`${c.consecutivo} · v${c.version}`} migas={[{ href: '/cotizaciones', texto: 'Cotizaciones' }]}
          descripcion={`${cl.nombres} ${cl.apellidos}`}
          acciones={<Insignia tono={vencida ? 'alerta' : est.tono}>{vencida ? 'Vencida' : est.texto}</Insignia>} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {guardada && <div className="print:hidden"><Aviso tipo="ok">Cotización guardada en borrador. Revísala y márcala como enviada para compartirla.</Aviso></div>}
          {c.respuesta_comentario && <div className="print:hidden"><Aviso tipo={c.estado === 'aceptada' ? 'ok' : 'info'}>Comentario: {c.respuesta_comentario}</Aviso></div>}
          <AccionesCotizacion id={c.id} estado={c.estado} enlace={enlace} celular={cl.celular} consecutivo={c.consecutivo} nombre={cl.nombres.split(' ')[0]} ventaId={venta?.id ?? null} />
          <DocumentoCotizacion d={d} />
        </div>
        <aside className="space-y-4 print:hidden">
          <section className="tarjeta space-y-2 text-sm">
            <h2 className="text-base font-extrabold">Seguimiento</h2>
            <p>Creada: {new Date(c.creado_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
            {c.enviada_en && <p>Enviada: {new Date(c.enviada_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>}
            {c.actualizada_en && <p>Actualizada por vencimiento: {new Date(c.actualizada_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>}
            {c.respondida_en && <p>Respondida: {new Date(c.respondida_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>}
            <p>Descuento: {n(c.descuento_pct)}% (máx. {n(c.tope_descuento_pct)}%)</p>
            <Link href={`/clientes/${c.cliente_id}`} className="font-semibold text-info underline">Ver ficha del cliente</Link>
          </section>
          {!!versiones?.length && (
            <section className="tarjeta space-y-2 text-sm">
              <h2 className="text-base font-extrabold">Versiones anteriores</h2>
              <ul className="space-y-1">{versiones.map((v) => <li key={v.version}>v{v.version} · {v.motivo} · {new Date(v.creado_en).toLocaleDateString('es-CO')}</li>)}</ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
