import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { MenuLateral } from '@/components/menu-lateral';
import { CierrePorInactividad } from '@/components/inactividad';
import { salir } from './acciones';

const ROLES = { admin: 'Administrador', finanzas: 'Finanzas', vendedor: 'Vendedor', operaciones: 'Operaciones' };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requerirSesion();
  const supabase = await createClient();
  const { data: cfg } = await supabase.from('configuracion').select('valor').eq('clave', 'inactividad_minutos').maybeSingle();
  const minutos = Number(cfg?.valor ?? 30) || 30;
  const alcance = s.perfil.ve_todo ? 'Todas las oficinas' : s.oficinas.map((o) => o.ciudad).join(', ') || 'Sin oficina asignada';

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MenuLateral esAdminGeneral={s.esAdminGeneral} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde bg-superficie px-5 py-3 lg:px-8">
          <div className="text-sm">
            <span className="font-bold">{s.perfil.nombre}</span>
            <span className="text-suave"> · {ROLES[s.perfil.rol]} · {alcance}</span>
          </div>
          <form action={salir}>
            <button type="submit" className="btn-secundario min-h-9 py-1.5">Cerrar sesión</button>
          </form>
        </div>
        <main className="flex-1 px-5 py-6 lg:px-8">{children}</main>
      </div>
      <CierrePorInactividad minutos={minutos} />
    </div>
  );
}
