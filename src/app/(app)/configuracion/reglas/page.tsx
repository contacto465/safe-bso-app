import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado } from '@/components/ui';
import { FormReglas, FormCategoria, type Regla } from './forms';

export const metadata: Metadata = { title: 'Términos y reglas' };

const UNIDAD: Record<string, string> = {
  max_usuarios: 'usuarios', tope_descuento_pct: '%', tope_descuento_empresas_pct: '%', vigencia_cotizacion_dias: 'días',
  fondo_incentivos_pct: '%', comision_plataformas_pct: '%', iva_pct: '%', devolucion_horas: 'horas', inactividad_minutos: 'minutos',
};

export default async function Reglas() {
  const s = await requerirSesion();
  const supabase = await createClient();
  const [{ data: cfg }, { data: cats }] = await Promise.all([
    supabase.from('configuracion').select('clave, valor, descripcion'),
    supabase.from('categorias_servicio').select('id, nombre, tipo_proceso').order('nombre'),
  ]);
  const orden = Object.keys(UNIDAD);
  const reglas: Regla[] = (cfg ?? [])
    .filter((c) => UNIDAD[c.clave])
    .sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave))
    .map((c) => ({ clave: c.clave, valor: Number(c.valor), descripcion: c.descripcion, unidad: UNIDAD[c.clave] }));

  return (
    <>
      <Encabezado titulo="Términos y reglas" descripcion="Reglas del negocio que se cambian sin programar. Solo el administrador general las modifica." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">Reglas</h2>
          <FormReglas reglas={reglas} editable={s.esAdminGeneral} />
        </section>
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">Categorías de servicios</h2>
          <ul className="divide-y divide-borde text-sm">
            {(cats ?? []).map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-2"><span className="font-semibold">{c.nombre}</span><span className="text-suave">{c.tipo_proceso}</span></li>
            ))}
            {!cats?.length && <li className="py-2 text-suave">Aún no hay categorías. También se crean solas al cargar el catálogo.</li>}
          </ul>
          {s.esAdmin && <FormCategoria />}
        </section>
      </div>
    </>
  );
}
