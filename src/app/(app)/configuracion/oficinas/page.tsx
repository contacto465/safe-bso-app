import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia } from '@/components/ui';
import { FormEmpresa, FormOficina } from './forms';

export const metadata: Metadata = { title: 'Oficinas y empresa' };

export default async function Oficinas() {
  const s = await requerirSesion();
  const supabase = await createClient();
  const [{ data: empresa }, { data: oficinas }] = await Promise.all([
    supabase.from('empresa').select('*').eq('id', 1).maybeSingle(),
    supabase.from('oficinas').select('*').order('es_principal', { ascending: false }).order('nombre'),
  ]);
  const editable = s.esAdminGeneral;

  return (
    <>
      <Encabezado titulo="Oficinas y empresa"
        descripcion="Las dos sedes facturan con el mismo NIT, pero cada una ve solo su información. El código de la oficina es el inicio del consecutivo (BOG-303-VA)." />
      <div className="grid gap-5 xl:grid-cols-2">
        {empresa && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Empresa y marca</h2>
            <FormEmpresa e={empresa} editable={editable} />
            <p className="text-xs text-suave">El logo y los colores definitivos se aplicarán a la app y a los PDF cuando se entreguen.</p>
          </section>
        )}
        {(oficinas ?? []).map((o) => (
          <section key={o.id} className="tarjeta space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">{o.nombre}</h2>
              {o.es_principal && <Insignia tono="info">Sede principal</Insignia>}
            </div>
            <FormOficina o={o} editable={editable} />
          </section>
        ))}
        {editable && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Agregar oficina</h2>
            <FormOficina editable />
          </section>
        )}
      </div>
    </>
  );
}
