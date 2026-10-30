import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia } from '@/components/ui';
import { FormMedio } from './form';

export const metadata: Metadata = { title: 'Métodos de pago' };

export default async function MediosPago() {
  const s = await requerirSesion();
  const supabase = await createClient();
  const { data: medios } = await supabase.from('medios_pago').select('*').order('activo', { ascending: false }).order('orden').order('nombre');
  const oficinas = s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }));
  const nombreOf = (id: string | null) => (id ? oficinas.find((o) => o.id === id)?.nombre ?? '—' : 'Todas las oficinas');

  return (
    <>
      <Encabezado titulo="Métodos de pago y tarifas"
        descripcion="Cómo pagan los clientes y cuánto cobra cada medio. La comisión va incluida en el pago del cliente: no se cobra aparte, pero el sistema la descuenta para saber cuánto entra de verdad. Las plataformas cobran 3%." />
      <div className="grid gap-5 xl:grid-cols-2">
        {s.esAdmin && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Nuevo método de pago</h2>
            <FormMedio oficinas={oficinas} />
          </section>
        )}
        {(medios ?? []).map((m) => (
          <section key={m.id} className={`tarjeta space-y-3 ${m.activo ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">{m.nombre}</h2>
              <div className="flex flex-wrap gap-1.5">
                <Insignia tono={Number(m.comision_pct) > 0 ? 'alerta' : 'ok'}>{Number(m.comision_pct)}%{Number(m.valor_fijo) > 0 ? ` + $${Number(m.valor_fijo).toLocaleString('es-CO')}` : ''}</Insignia>
                <Insignia>{nombreOf(m.oficina_id)}</Insignia>
                <Insignia>{(m.monedas as string[]).join(', ')}</Insignia>
              </div>
            </div>
            {s.esAdmin ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-info">Editar</summary>
                <div className="mt-3"><FormMedio medio={{ ...m, comision_pct: Number(m.comision_pct), valor_fijo: Number(m.valor_fijo) }} oficinas={oficinas} /></div>
              </details>
            ) : m.instrucciones && <p className="text-sm text-suave">{m.instrucciones}</p>}
          </section>
        ))}
      </div>
    </>
  );
}
