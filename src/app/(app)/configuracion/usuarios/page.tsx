import type { Metadata } from 'next';
import { requerirAdminGeneral } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Insignia, Aviso } from '@/components/ui';
import { FormInvitar, FormUsuario } from './forms';

export const metadata: Metadata = { title: 'Usuarios y accesos' };

export default async function Usuarios() {
  const s = await requerirAdminGeneral();
  const supabase = await createClient();
  const [{ data: perfiles }, { data: uo }, { data: max }, { data: ingresos }] = await Promise.all([
    supabase.from('perfiles').select('*').order('activo', { ascending: false }).order('creado_en'),
    supabase.from('usuario_oficinas').select('usuario_id, oficina_id'),
    supabase.from('configuracion').select('valor').eq('clave', 'max_usuarios').maybeSingle(),
    supabase.from('ingresos').select('usuario_id, fecha, dispositivo_nuevo').order('fecha', { ascending: false }).limit(200),
  ]);
  const limite = Number(max?.valor ?? 3);
  const activos = (perfiles ?? []).filter((p) => p.activo).length;
  const oficinas = s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }));
  const alcanceDe = (id: string, veTodo: boolean) => (veTodo ? 'todo' : (uo ?? []).find((x) => x.usuario_id === id)?.oficina_id ?? '');
  const ultimo = (id: string) => (ingresos ?? []).find((i) => i.usuario_id === id);
  const fecha = (f: string) => new Date(f).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

  return (
    <>
      <Encabezado titulo="Usuarios y accesos"
        descripcion={`Solo ${limite} personas pueden usar la aplicación. Nadie puede registrarse por su cuenta: solo tú invitas, y cada cambio queda en la auditoría.`} />
      <div className="space-y-5">
        <Aviso tipo={activos >= limite ? 'alerta' : 'info'}>{activos} de {limite} usuarios activos.</Aviso>
        <section className="tarjeta space-y-3">
          <h2 className="text-base font-extrabold">Invitar usuario</h2>
          <FormInvitar oficinas={oficinas} deshabilitado={activos >= limite} />
        </section>
        <div className="grid gap-5 xl:grid-cols-2">
          {(perfiles ?? []).map((p) => {
            const u = ultimo(p.id);
            return (
              <section key={p.id} className={`tarjeta space-y-3 ${p.activo ? '' : 'opacity-70'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold">{p.nombre} {p.id === s.perfil.id && <span className="text-suave">(tú)</span>}</h2>
                    <p className="text-sm text-suave">{p.correo}</p>
                    <p className="text-xs text-suave">{u ? `Último ingreso: ${fecha(u.fecha)}` : 'Aún no ha ingresado'}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {p.activo ? <Insignia tono="ok">Activo</Insignia> : <Insignia tono="peligro">Desactivado</Insignia>}
                    {u?.dispositivo_nuevo && <Insignia tono="alerta">Dispositivo nuevo</Insignia>}
                  </div>
                </div>
                <FormUsuario u={p} oficinas={oficinas} alcance={alcanceDe(p.id, p.ve_todo)} esYo={p.id === s.perfil.id} />
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
