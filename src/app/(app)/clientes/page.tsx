import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Clientes' };

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string }> }) {
  const f = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  let q = supabase.from('clientes').select('id, nombres, apellidos, celular, correo, estado_proceso, tipo_proceso, oficina_id, empresas(razon_social), creado_en')
    .order('creado_en', { ascending: false }).limit(300);
  if (f.q) {
    const t = f.q.replace(/[%,()]/g, '');
    q = q.or(`nombres.ilike.%${t}%,apellidos.ilike.%${t}%,documento.ilike.%${t}%,celular.ilike.%${t}%,correo.ilike.%${t}%`);
  }
  if (f.estado) q = q.eq('estado_proceso', f.estado);
  const { data } = await q;
  const oficina = (id: string) => s.oficinas.find((o) => o.id === id)?.ciudad ?? '';

  return (
    <>
      <Encabezado titulo="Clientes" descripcion="Una sola base de clientes. Cada oficina ve solo los suyos."
        acciones={<Link href="/clientes/nuevo" className="btn-primario">Nuevo cliente</Link>} />
      <div className="tarjeta space-y-4">
        <form className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={f.q} placeholder="Nombre, documento, celular o correo" className="campo w-72" />
          <button className="btn-secundario">Buscar</button>
        </form>
        {!data?.length ? <Vacio>No hay clientes {f.q ? 'con esa búsqueda' : 'todavía'}.</Vacio> : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[720px]">
              <thead><tr><th>Cliente</th><th>Contacto</th><th>Proceso</th><th>Estado</th>{s.perfil.ve_todo && <th>Oficina</th>}</tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/clientes/${c.id}`} className="font-bold text-info underline">{c.nombres} {c.apellidos}</Link>
                      {(c.empresas as unknown as { razon_social: string } | null) && <span className="block text-xs text-suave">{(c.empresas as unknown as { razon_social: string }).razon_social}</span>}</td>
                    <td className="text-sm">{c.celular}<span className="block text-xs text-suave">{c.correo}</span></td>
                    <td>{c.tipo_proceso ?? <span className="text-suave">—</span>}</td>
                    <td><Insignia tono="info">{c.estado_proceso}</Insignia></td>
                    {s.perfil.ve_todo && <td>{oficina(c.oficina_id)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
