'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// El usuario invitado (o que recupera su clave) define su contraseña
export default function DefinirClave() {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(form: FormData) {
    const clave = String(form.get('clave'));
    if (clave.length < 12) return setError('La contraseña debe tener al menos 12 caracteres.');
    if (clave !== String(form.get('repetir'))) return setError('Las contraseñas no coinciden.');
    setEnviando(true);
    const { error } = await createClient().auth.updateUser({ password: clave });
    if (error) {
      setEnviando(false);
      return setError(error.message);
    }
    window.location.href = '/verificacion';
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={guardar} className="tarjeta w-full max-w-md space-y-4 shadow-sm">
        <h1 className="text-xl font-extrabold">Define tu contraseña</h1>
        <p className="text-sm text-suave">Mínimo 12 caracteres. Después activarás la verificación en dos pasos.</p>
        <div>
          <label className="etiqueta" htmlFor="clave">Contraseña</label>
          <input id="clave" name="clave" type="password" autoComplete="new-password" required className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="repetir">Repetir contraseña</label>
          <input id="repetir" name="repetir" type="password" autoComplete="new-password" required className="campo" />
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
        <button type="submit" className="btn-primario w-full" disabled={enviando}>Guardar y continuar</button>
      </form>
    </main>
  );
}
