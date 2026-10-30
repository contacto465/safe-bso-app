import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { FormaPago } from '@/lib/catalogo';
import { Encabezado, Insignia } from '@/components/ui';
import { EditorFormaPago } from './editor';
import { archivarFormaPago } from './acciones';

export const metadata: Metadata = { title: 'Formas de pago' };

export default async function FormasPago() {
  const s = await requerirSesion();
  const supabase = await createClient();
  const { data: formas } = await supabase.from('formas_pago').select('*').order('activa', { ascending: false }).order('nombre').returns<FormaPago[]>();
  const { data: usos } = await supabase.from('servicios').select('forma_pago_id').eq('activo', true);
  const cuenta = (id: string) => (usos ?? []).filter((u) => u.forma_pago_id === id).length;

  return (
    <>
      <Encabezado titulo="Formas de pago"
        descripcion="Cada servicio del catálogo tiene su propia forma de pago. La cotización la toma de ahí y, al aceptarla, se convierte en el plan de pagos con fechas." />
      <div className="grid gap-5 xl:grid-cols-2">
        {s.esAdmin && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Nueva forma de pago</h2>
            <EditorFormaPago />
          </section>
        )}
        {(formas ?? []).map((f) => (
          <section key={f.id} className={`tarjeta space-y-3 ${f.activa ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">{f.nombre}</h2>
              <div className="flex items-center gap-2">
                <Insignia tono="info">{cuenta(f.id)} servicio(s)</Insignia>
                {!f.activa && <Insignia>Archivada</Insignia>}
                {s.esAdmin && (
                  <form action={archivarFormaPago.bind(null, f.id, !f.activa)}>
                    <button className="text-sm font-semibold text-info underline">{f.activa ? 'Archivar' : 'Reactivar'}</button>
                  </form>
                )}
              </div>
            </div>
            {s.esAdmin ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-info">
                  {f.cuotas.map((c) => `${c.porcentaje}%${c.dias ? ` a ${c.dias} días` : ' al aceptar'}`).join(' · ')} — editar
                </summary>
                <div className="mt-3"><EditorFormaPago forma={f} /></div>
              </details>
            ) : (
              <p className="text-sm">{f.cuotas.map((c) => `${c.porcentaje}%${c.dias ? ` a ${c.dias} días` : ' al aceptar'}`).join(' · ')}</p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
