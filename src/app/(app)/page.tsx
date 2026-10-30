import Link from 'next/link';
import { requerirSesion } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Encabezado, Aviso } from '@/components/ui';

const AVISOS: Record<string, string> = {
  'solo-administradores': 'Esa sección es solo para administradores.',
  'solo-administrador-general': 'Esa sección es solo para el administrador general.',
};

export default async function Inicio({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const { aviso } = await searchParams;
  const s = await requerirSesion();
  const supabase = await createClient();
  const contar = async (tabla: string, filtro?: [string, string]) => {
    let q = supabase.from(tabla).select('*', { count: 'exact', head: true });
    if (filtro) q = q.eq(filtro[0], filtro[1]);
    return (await q).count ?? 0;
  };
  const [principales, adicionales, terceros, sinFormaPago] = await Promise.all([
    contar('servicios', ['tipo', 'principal']),
    contar('servicios', ['tipo', 'adicional']),
    contar('servicios', ['tipo', 'tercero']),
    supabase.from('servicios').select('*', { count: 'exact', head: true }).eq('activo', true).neq('tipo', 'tercero').is('forma_pago_id', null).then((r) => r.count ?? 0),
  ]);

  const tarjetas = [
    { t: 'Servicios principales', v: principales, href: '/catalogo?tipo=principal' },
    { t: 'Servicios adicionales', v: adicionales, href: '/catalogo?tipo=adicional' },
    { t: 'Pagos a terceros', v: terceros, href: '/catalogo?tipo=tercero' },
    { t: 'Oficinas visibles', v: s.oficinas.length, href: '/configuracion/oficinas' },
  ];

  return (
    <>
      <Encabezado
        titulo={`Hola, ${s.perfil.nombre.split(' ')[0]}`}
        descripcion="En funcionamiento: clientes, empresas, cotizaciones y la configuración (catálogo, formas y métodos de pago, oficinas, usuarios y reglas). Los módulos en gris se irán activando por fases (F3, F4…)."
      />
      <div className="space-y-5">
        {aviso && AVISOS[aviso] && <Aviso tipo="alerta">{AVISOS[aviso]}</Aviso>}
        {sinFormaPago > 0 && (
          <Aviso tipo="alerta">
            {sinFormaPago} servicio(s) activos no tienen forma de pago. Cada servicio debe tener la suya para poder cotizarlo.{' '}
            <Link href="/catalogo?sin_forma=1" className="underline">Revisar</Link>
          </Aviso>
        )}
        <section className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4" aria-label="Resumen del catálogo">
          {tarjetas.map((c) => (
            <Link key={c.t} href={c.href} className="tarjeta block transition hover:shadow-md">
              <p className="text-sm font-semibold text-suave">{c.t}</p>
              <p className="mt-1 text-3xl font-extrabold">{c.v}</p>
            </Link>
          ))}
        </section>
        {s.esAdmin && (
          <section className="tarjeta space-y-3">
            <h2 className="text-base font-extrabold">Para dejar lista la fase 1</h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li><Link className="font-semibold underline" href="/catalogo/importar">Cargar el catálogo de servicios</Link> (uno por uno o con el archivo CSV).</li>
              <li><Link className="font-semibold underline" href="/configuracion/formas-pago">Crear las formas de pago</Link> y asignar una a cada servicio.</li>
              <li><Link className="font-semibold underline" href="/configuracion/medios-pago">Revisar los métodos de pago</Link> y su comisión (3% en plataformas).</li>
              <li><Link className="font-semibold underline" href="/configuracion/oficinas">Completar los datos de la empresa y las oficinas</Link>, incluida la marca.</li>
              {s.esAdminGeneral && <li><Link className="font-semibold underline" href="/configuracion/usuarios">Invitar a los otros 2 usuarios</Link> y asignar su alcance.</li>}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}
