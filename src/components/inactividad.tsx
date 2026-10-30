'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

// Cierra la sesión tras N minutos sin actividad (configurable en Términos y reglas)
export function CierrePorInactividad({ minutos }: { minutos: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cerrar = async () => {
      await createClient().auth.signOut();
      window.location.href = '/ingreso?motivo=inactividad';
    };
    const reiniciar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(cerrar, minutos * 60_000);
    };
    const eventos = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [minutos]);

  return null;
}
