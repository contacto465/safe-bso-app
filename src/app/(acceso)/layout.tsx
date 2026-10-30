export default function AccesoLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-marca text-base font-extrabold text-acento">SB</span>
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-extrabold">SAFE BSO MIGRATION</span>
            <span className="text-sm text-suave">Contabilidad y gestión comercial</span>
          </span>
        </div>
        <div className="tarjeta shadow-sm">{children}</div>
        <p className="mt-4 text-center text-xs text-suave">Acceso solo para usuarios autorizados.</p>
      </div>
    </main>
  );
}
