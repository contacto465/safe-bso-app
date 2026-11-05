'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function FormIngreso({ aviso }: { aviso?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [procesandoEnlace, setProcesandoEnlace] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);

  // Enlace del correo de invitación o recuperación (plantilla estándar de Supabase):
  // llega con la sesión en el fragmento #access_token=…&refresh_token=…&type=invite
  // El fragmento solo existe en el navegador, por eso se lee en un efecto al montar.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const access_token = h.get('access_token');
    const refresh_token = h.get('refresh_token');
    if (h.get('error_description')) {
      setError('El enlace venció o ya se usó. Pide un enlace nuevo.');
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
      // Invitación o enlace de acceso: entra directo. Solo «recuperar contraseña» pide crear una.
      window.location.href = tipo === 'recovery' ? '/auth/clave' : '/verificacion';
    });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (procesandoEnlace) return <p role="status" className="text-sm text-suave">Validando tu enlace…</p>;

  // Acceso solo con el correo: se envía un enlace y con abrirlo se entra (sin contraseña)
  async function enviarEnlace(form: FormData) {
    setCargando(true);
    setError(null);
    const correo = String(form.get('correo')).trim().toLowerCase();
    const { error } = await createClient().auth.signInWithOtp({
      email: correo,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirmar` },
    });
    setCargando(false);
    if (error) {
      setError(/rate|too many|seconds/i.test(error.message)
        ? 'Ya te enviamos un enlace hace poco. Espera un minuto y vuelve a intentar.'
        : /signups not allowed|not found|otp_disabled/i.test(error.message)
          ? 'Ese correo no tiene acceso. Pídele al administrador que te invite.'
          : 'No se pudo enviar el enlace. Intenta de nuevo.');
      return;
    }
    setEnviado(correo);
  }

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

  if (enviado) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-extrabold">Revisa tu correo</h1>
        <p role="status" className="rounded-lg bg-ok-fondo px-3 py-2 text-sm font-semibold text-ok">
          Enviamos un enlace de acceso a <b>{enviado}</b>. Ábrelo en este mismo dispositivo y entrarás directo.
        </p>
        <p className="text-sm text-suave">Si no llega en un par de minutos, revisa la carpeta de spam o promociones.</p>
        <button type="button" className="btn-secundario w-full" onClick={() => setEnviado(null)}>Usar otro correo</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={enviarEnlace} className="space-y-4">
        <h1 className="text-xl font-extrabold">Ingresar</h1>
        {aviso && <p role="status" className="rounded-lg bg-info-fondo px-3 py-2 text-sm font-semibold text-info">{aviso}</p>}
        <div>
          <label className="etiqueta" htmlFor="correo">Tu correo autorizado</label>
          <input id="correo" name="correo" type="email" autoComplete="email" required className="campo" />
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
        <button type="submit" className="btn-primario w-full" disabled={cargando}>
          {cargando ? 'Enviando…' : 'Enviarme el enlace de acceso'}
        </button>
        <p className="text-xs text-suave">Sin contraseña: te llega un enlace al correo y con abrirlo entras.</p>
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-info">Entrar con contraseña</summary>
        <form action={ingresar} className="mt-3 space-y-3">
          <div>
            <label className="etiqueta" htmlFor="correo-clave">Correo</label>
            <input id="correo-clave" name="correo" type="email" autoComplete="email" required className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="clave">Contraseña</label>
            <input id="clave" name="clave" type="password" autoComplete="current-password" required className="campo" />
          </div>
          <button type="submit" className="btn-secundario w-full" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </details>
    </div>
  );
}
