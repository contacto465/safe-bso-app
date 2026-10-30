import type { Metadata } from 'next';
import { requerirAdmin } from '@/lib/auth';
import { listasCatalogo, parametrosPrecio } from '@/lib/catalogo';
import { Encabezado } from '@/components/ui';
import { FormServicio } from '../form-servicio';

export const metadata: Metadata = { title: 'Nuevo servicio' };

export default async function NuevoServicio() {
  const s = await requerirAdmin();
  const [listas, params] = await Promise.all([listasCatalogo(), parametrosPrecio()]);
  return (
    <>
      <Encabezado titulo="Nuevo servicio" migas={[{ href: '/catalogo', texto: 'Catálogo' }]} />
      <FormServicio
        costos={[]} adicionalesSel={[]} preciosOficina={[]}
        oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))}
        formas={listas.formas} categorias={listas.categorias} medios={listas.medios}
        opcionesAdicionales={listas.adicionales} params={params} veCostos={s.veCostos}
      />
    </>
  );
}
