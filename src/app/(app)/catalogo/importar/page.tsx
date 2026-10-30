import type { Metadata } from 'next';
import { requerirAdmin } from '@/lib/auth';
import { Encabezado } from '@/components/ui';
import { CargaCatalogo } from './carga';

export const metadata: Metadata = { title: 'Cargar catálogo' };

export default async function Importar() {
  await requerirAdmin();
  return (
    <>
      <Encabezado
        titulo="Cargar catálogo desde archivo"
        descripcion="Sube un CSV guardado desde Excel o Google Sheets. Si la abreviatura ya existe, el servicio se actualiza; si no, se crea."
        migas={[{ href: '/catalogo', texto: 'Catálogo' }]}
      />
      <CargaCatalogo />
    </>
  );
}
