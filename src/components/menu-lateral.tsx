'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { GRUPOS } from '@/lib/modulos';

export function MenuLateral({ esAdminGeneral }: { esAdminGeneral: boolean }) {
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const activo = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

  return (
    <nav aria-label="Módulos" className="bg-marca text-[#d3dee8] lg:min-h-screen lg:w-64 lg:shrink-0">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-acento text-sm font-extrabold text-marca">SB</span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-extrabold text-white">SAFE BSO</span>
            <span className="text-xs text-[#a9bdcf]">Contabilidad y CRM</span>
          </span>
        </Link>
        <button
          type="button"
          className="btn min-h-10 border border-white/20 px-3 text-white lg:hidden"
          aria-expanded={abierto}
          aria-controls="menu-modulos"
          onClick={() => setAbierto(!abierto)}
        >
          Menú
        </button>
      </div>
      <div id="menu-modulos" className={`${abierto ? 'block' : 'hidden'} space-y-4 px-3 pb-8 lg:block`}>
        {GRUPOS.map((g) => {
          const mods = g.modulos.filter((m) => !m.soloAdminGeneral || esAdminGeneral);
          if (!mods.length) return null;
          return (
            <div key={g.nombre}>
              <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-[#8fa8be]">{g.nombre}</p>
              <ul>
                {mods.map((m) =>
                  m.disponible ? (
                    <li key={m.id}>
                      <Link
                        href={m.href}
                        onClick={() => setAbierto(false)}
                        aria-current={activo(m.href) ? 'page' : undefined}
                        className={`flex min-h-9 items-center rounded-lg px-3 py-2 text-sm ${
                          activo(m.href) ? 'bg-marca-hover font-bold text-white' : 'hover:bg-white/5'
                        }`}
                      >
                        {m.nombre}
                      </Link>
                    </li>
                  ) : (
                    <li key={m.id} className="flex min-h-9 items-center justify-between gap-2 px-3 py-2 text-sm text-[#7f97ad]">
                      <span>{m.nombre}</span>
                      <span className="rounded-full border border-white/15 px-1.5 text-[10px] font-bold">F{m.fase}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
