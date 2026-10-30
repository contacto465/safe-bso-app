'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function FormIngreso({ aviso }: { aviso?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [procesandoEnlace, setProcesandoEnlace] = useState(false);

  // Enlace del correo de invitación o recuperación (plantilla estándar de Supabase):
  // llega con la sesión en el fragmento #access_token=…&refresh_token=…&type=invite
  // El fragmento solo existe en el navegador, por eso se lee en un efecto al montar.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const access_token = h.get('access_token');
    const refresh_token = h.get('refresh_token');
    if (h.get('error_description')) {
      setError('El enlace venció o ya se usó. Pide al administrador una nueva invitación.');
      history.replaceState(null, '', window.location.pathname);
      return;
    }
    if (!access_token || !refresh_token) return;
    setProcesandoEnlace(true);
    const tipo = h.get('type');
    history.replaceState(null, '', window.location.pathname);
    createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) {
        setProcesandoEnlace(false);
        setError('El enlace venció o ya se usó. Pide al administrador una nueva invitación.');
        return;
      }
      window.location.href = tipo === 'invite' || tipo === 'recovery' ? '/auth/clave' : '/verificacion';
    });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (procesandoEnlace) return <p role="status" className="text-sm text-suave">Validando tu invitación…</p>;

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
