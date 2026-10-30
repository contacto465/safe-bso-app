import Link from 'next/link';

export function Encabezado({
  titulo,
  descripcion,
  acciones,
  migas,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
  migas?: { href: string; texto: string }[];
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {migas && (
          <p className="mb-1 text-xs font-semibold text-suave">
            {migas.map((m, i) => (
              <span key={m.href}>
                <Link href={m.href} className="hover:underline">{m.texto}</Link>
                {i < migas.length - 1 && ' / '}
              </span>
            ))}
          </p>
        )}
        <h1 className="text-2xl font-extrabold">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-3xl text-sm text-suave">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </header>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'ok' | 'alerta' | 'peligro'; children: React.ReactNode }) {
  const c = {
    info: 'bg-info-fondo text-info',
    ok: 'bg-ok-fondo text-ok',
    alerta: 'bg-alerta-fondo text-alerta',
    peligro: 'bg-peligro-fondo text-peligro',
  }[tipo];
  return <div role={tipo === 'peligro' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm font-semibold ${c}`}>{children}</div>;
}

export function Insignia({ tono = 'gris', children }: { tono?: 'gris' | 'ok' | 'alerta' | 'peligro' | 'info'; children: React.ReactNode }) {
  const c = {
    gris: 'bg-superficie-2 text-suave',
    ok: 'bg-ok-fondo text-ok',
    alerta: 'bg-alerta-fondo text-alerta',
    peligro: 'bg-peligro-fondo text-peligro',
    info: 'bg-info-fondo text-info',
  }[tono];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${c}`}>{children}</span>;
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-borde px-4 py-10 text-center text-sm text-suave">{children}</div>;
}

export const TIPO_SERVICIO: Record<string, { texto: string; tono: 'info' | 'ok' | 'alerta' }> = {
  principal: { texto: 'Principal', tono: 'info' },
  adicional: { texto: 'Adicional', tono: 'ok' },
  tercero: { texto: 'Pago a tercero', tono: 'alerta' },
};
