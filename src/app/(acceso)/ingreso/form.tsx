'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function FormIngreso({ aviso }: { aviso?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ingresar(form: FormData) {
    setCargando(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get('correo')).trim(),
      password: String(form.get('clave')),
    });
    setCargando(false);
    if (error) {
      // Supabase bloquea temporalmente tras varios intentos fallidos
      setError(/rate|too many/i.test(error.message)
        ? 'Demasiados intentos. Espera unos minutos y vuelve a intentar.'
        : 'Correo o contraseña incorrectos.');
      return;
    }
    router.replace('/verificacion');
    router.refresh();
  }

  return (
    <form action={ingresar} className="space-y-4">
      <h1 className="text-xl font-extrabold">Ingresar</h1>
      {aviso && <p role="status" className="rounded-lg bg-info-fondo px-3 py-2 text-sm font-semibold text-info">{aviso}</p>}
      <div>
        <label className="etiqueta" htmlFor="correo">Correo</label>
        <input id="correo" name="correo" type="email" autoComplete="email" required className="campo" />
      </div>
      <div>
        <label className="etiqueta" htmlFor="clave">Contraseña</label>
        <input id="clave" name="clave" type="password" autoComplete="current-password" required className="campo" />
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
      <button type="submit" className="btn-primario w-full" disabled={cargando}>
        {cargando ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
