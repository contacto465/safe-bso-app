import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { hoyBogota } from '@/lib/formato';
import { Encabezado } from '@/components/ui';
import { FormVenta } from './form';

export const metadata: Metadata = { title: 'Registrar venta' };

export default async function NuevaVenta({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  const [{ data: clientes }, { data: servicios }] = await Promise.all([
    supabase.from('clientes').select('id, nombres, apellidos, documento, oficina_id').order('nombres').limit(2000),
    supabase.from('servicios').select('id, nombre, abreviatura, precio, moneda, tipo, formas_pago(nombre)').eq('activo', true).neq('tipo', 'tercero').order('nombre'),
  ]);
  return (
    <>
      <Encabezado titulo="Registrar venta" migas={[{ href: '/ventas', texto: 'Ventas' }]}
        descripcion="Para ventas cerradas sin cotización en el sistema (por ejemplo, las de este mes). Si el cliente aceptó una cotización, conviértela desde la cotización." />
      <FormVenta
        hoy={hoyBogota()}
        oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))}
        clientes={(clientes ?? []).map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}${c.documento ? ` · ${c.documento}` : ''}`, oficina_id: c.oficina_id }))}
        servicios={(servicios ?? []).map((x) => ({ id: x.id, nombre: `${x.abreviatura} · ${x.nombre}`, precio: Number(x.precio), moneda: x.moneda,
          forma: (x.formas_pago as unknown as { nombre: string } | null)?.nombre ?? '' }))}
        clienteInicial={cliente}
      />
    </>
  );
}
