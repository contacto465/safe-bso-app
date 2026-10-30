import type { Metadata } from 'next';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia } from '@/components/ui';
import { FormEmpresa } from './form';

export const metadata: Metadata = { title: 'Atención a empresas' };

export default async function Empresas() {
  const s = await requerirSesion();
  const supabase = await createClient();
  const [{ data: empresas }, { data: tope }, { data: benef }] = await Promise.all([
    supabase.from('empresas').select('*').order('razon_social'),
    supabase.from('configuracion').select('valor').eq('clave', 'tope_descuento_empresas_pct').maybeSingle(),
    supabase.from('clientes').select('empresa_id').not('empresa_id', 'is', null),
  ]);
  const oficinas = s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }));
  const n = (id: string) => (benef ?? []).filter((b) => b.empresa_id === id).length;
  return (
    <>
      <Encabezado titulo="Atención a empresas"
        descripcion={`Clientes corporativos: descuento de hasta el ${Number(tope?.valor ?? 40)}%, sin comisiones ni reserva del 10%. Sus beneficiarios se registran como clientes ligados a la empresa.`} />
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="tarjeta space-y-3"><h2 className="text-base font-extrabold">Nueva empresa</h2><FormEmpresa oficinas={oficinas} /></section>
        {(empresas ?? []).map((e) => (
          <section key={e.id} className="tarjeta space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">{e.razon_social}</h2>
              <Insignia tono="info">{n(e.id)} beneficiario(s)</Insignia>
            </div>
            <details><summary className="cursor-pointer text-sm font-semibold text-info">Editar</summary><div className="mt-3"><FormEmpresa e={e} oficinas={oficinas} /></div></details>
          </section>
        ))}
      </div>
    </>
  );
}
