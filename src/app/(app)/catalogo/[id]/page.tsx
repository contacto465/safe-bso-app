import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requerirAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { listasCatalogo, parametrosPrecio, type Servicio, type CostoServicio } from '@/lib/catalogo';
import { Encabezado, Aviso } from '@/components/ui';
import { FormServicio } from '../form-servicio';

export const metadata: Metadata = { title: 'Editar servicio' };

export default async function EditarServicio({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string }>;
}) {
  const { id } = await params;
  const { guardado } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requerirAdmin();
  const supabase = await createClient();
  const [{ data: servicio }, { data: costos }, { data: adic }, { data: precios }, listas, prm] = await Promise.all([
    supabase.from('servicios').select('*').eq('id', id).maybeSingle<Servicio>(),
    supabase.from('servicio_costos').select('tipo, concepto, valor').eq('servicio_id', id).order('orden').returns<CostoServicio[]>(),
    supabase.from('servicio_adicionales').select('adicional_id').eq('principal_id', id).order('orden'),
    supabase.from('servicio_precios_oficina').select('oficina_id, precio').eq('servicio_id', id),
    listasCatalogo(),
    parametrosPrecio(),
  ]);
  if (!servicio) notFound();
  return (
    <>
      <Encabezado titulo={servicio.nombre} descripcion={`Abreviatura ${servicio.abreviatura}`} migas={[{ href: '/catalogo', texto: 'Catálogo' }]} />
      {guardado && <div className="mb-4"><Aviso tipo="ok">Servicio guardado. El cambio quedó registrado en la auditoría.</Aviso></div>}
      <FormServicio
        key={JSON.stringify(servicio)}
        servicio={{ ...servicio, precio: Number(servicio.precio), iva_pct: Number(servicio.iva_pct), recargo_gestion: Number(servicio.recargo_gestion) }}
        costos={(costos ?? []).map((c) => ({ ...c, valor: Number(c.valor) }))}
        adicionalesSel={(adic ?? []).map((a) => a.adicional_id as string)}
        preciosOficina={(precios ?? []).map((x) => ({ oficina_id: x.oficina_id as string, precio: Number(x.precio) }))}
        oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))}
        formas={listas.formas} categorias={listas.categorias} medios={listas.medios}
        opcionesAdicionales={listas.adicionales.filter((a) => a.id !== id)} params={prm} veCostos={s.veCostos}
      />
    </>
  );
}
