'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { registrarIngreso } from './acciones';

type Estado =
  | { paso: 'cargando' }
  | { paso: 'inscribir'; factorId: string; qr: string; secreto: string }
  | { paso: 'verificar'; factorId: string }
  | { paso: 'error'; mensaje: string };

// Verificación en dos pasos obligatoria (app autenticadora: Google Authenticator, Microsoft Authenticator…)
export default function Verificacion() {
  const [estado, setEstado] = useState<Estado>({ paso: 'cargando' });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) return setEstado({ paso: 'error', mensaje: error.message });
      const verificado = data.totp.find((f) => f.status === 'verified');
      if (verificado) return setEstado({ paso: 'verificar', factorId: verificado.id });
      // Limpia inscripciones a medias y crea una nueva
      const todos = (data.all ?? []) as { id: string; status: string }[];
      for (const f of todos.filter((f) => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
      const ins = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SAFE BSO ${new Date().toISOString().slice(0, 10)}` });
      if (ins.error) return setEstado({ paso: 'error', mensaje: ins.error.message });
      setEstado({ paso: 'inscribir', factorId: ins.data.id, qr: ins.data.totp.qr_code, secreto: ins.data.totp.secret });
    })();
  }, []);

  async function verificar(form: FormData) {
    if (estado.paso !== 'inscribir' && estado.paso !== 'verificar') return;
    setEnviando(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: estado.factorId,
      code: String(form.get('codigo')).replace(/\s/g, ''),
    });
    if (error) {
      setEnviando(false);
      setError('Código incorrecto o vencido. Escribe el código que muestra la app en este momento.');
      return;
    }
    await registrarIngreso();
    window.location.href = '/';
  }

  async function salir() {
    await createClient().auth.signOut();
    window.location.href = '/ingreso';
  }

  if (estado.paso === 'cargando') return <p className="text-sm text-suave">Preparando la verificación…</p>;
  if (estado.paso === 'error')
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-semibold text-peligro">{estado.mensaje}</p>
        <button type="button" onClick={salir} className="btn-secundario w-full">Volver al ingreso</button>
      </div>
    );

  return (
    <form action={verificar} className="space-y-4">
      <h1 className="text-xl font-extrabold">Verificación en dos pasos</h1>
      {estado.paso === 'inscribir' ? (
        <div className="space-y-3 text-sm">
          <p>Es tu primer ingreso. Activa la verificación en dos pasos:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Abre en tu celular Google Authenticator o Microsoft Authenticator.</li>
            <li>Escanea este código.</li>
            <li>Escribe el código de 6 dígitos que aparece.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={estado.qr} alt="Código QR para la app autenticadora" className="mx-auto size-48 rounded-lg border border-borde bg-white p-2" />
          <p className="text-center text-xs text-suave">
            ¿No puedes escanear? Escribe esta clave: <code className="font-bold break-all">{estado.secreto}</code>
          </p>
        </div>
      ) : (
        <p className="text-sm">Escribe el código de 6 dígitos de tu app autenticadora.</p>
      )}
      <div>
        <label className="etiqueta" htmlFor="codigo">Código</label>
        <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required
          className="campo text-center text-lg tracking-[0.4em]" autoFocus />
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-peligro">{error}</p>}
      <button type="submit" className="btn-primario w-full" disabled={enviando}>{enviando ? 'Verificando…' : 'Verificar'}</button>
      <button type="button" onClick={salir} className="btn-secundario w-full">Usar otra cuenta</button>
    </form>
  );
}
