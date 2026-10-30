import type { Metadata } from 'next';
import { requerirAdminGeneral } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia, Vacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Auditoría' };

const TABLAS: Record<string, string> = {
  servicios: 'Servicio', servicio_costos: 'Costo de servicio', formas_pago: 'Forma de pago', medios_pago: 'Método de pago',
  configuracion: 'Regla', perfiles: 'Usuario', usuario_oficinas: 'Alcance de usuario', oficinas: 'Oficina', empresa: 'Empresa',
  categorias_servicio: 'Categoría', servicio_precios_oficina: 'Precio por oficina',
};
const ACC = { INSERT: ['Creó', 'ok'], UPDATE: ['Modificó', 'info'], DELETE: ['Eliminó', 'peligro'] } as const;

function resumen(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null) {
  const d = despues ?? antes ?? {};
  const nombre = (d.nombre ?? d.clave ?? d.concepto ?? d.correo ?? '') as string;
  if (!antes || !despues) return nombre;
  const cambios = Object.keys(despues).filter((k) => !['actualizado_en'].includes(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));
  return `${nombre}${cambios.length ? ` — ${cambios.map((k) => `${k}: ${JSON.stringify(antes[k])} → ${JSON.stringify(despues[k])}`).join('; ')}` : ''}`;
}

export default async function Auditoria({ searchParams }: { searchParams: Promise<{ tabla?: string }> }) {
  const { tabla } = await searchParams;
  await requerirAdminGeneral();
  const supabase = await createClient();
  let q = supabase.from('auditoria').select('*').order('fecha', { ascending: false }).limit(300);
  if (tabla && TABLAS[tabla]) q = q.eq('tabla', tabla);
  const [{ data }, { data: perfiles }] = await Promise.all([q, supabase.from('perfiles').select('id, nombre')]);
  const quien = (id: string | null) => perfiles?.find((p) => p.id === id)?.nombre ?? 'Sistema';

  return (
    <>
      <Encabezado titulo="Auditoría" descripcion="Quién hizo qué y cuándo. Los registros no se pueden editar ni borrar." />
      <div className="tarjeta space-y-4">
        <form className="flex flex-wrap items-end gap-2">
          <div><label className="etiqueta" htmlFor="tabla">Qué</label>
            <select id="tabla" name="tabla" defaultValue={tabla ?? ''} className="campo">
              <option value="">Todo</option>
              {Object.entries(TABLAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select></div>
          <button className="btn-secundario">Filtrar</button>
        </form>
        {!data?.length ? <Vacio>Sin registros.</Vacio> : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[760px]">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Qué</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.map((a) => {
                  const [t, tono] = ACC[a.accion as keyof typeof ACC];
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{new Date(a.fecha).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}</td>
                      <td>{quien(a.usuario_id)}</td>
                      <td><Insignia tono={tono}>{t}</Insignia></td>
                      <td>{TABLAS[a.tabla] ?? a.tabla}</td>
                      <td className="max-w-xl break-words text-xs text-suave">{resumen(a.antes, a.despues)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
