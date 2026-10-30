import type { Metadata } from 'next';
import { FormIngreso } from './form';

export const metadata: Metadata = { title: 'Ingreso' };

const MOTIVOS: Record<string, string> = {
  inactividad: 'Tu sesión se cerró por inactividad. Ingresa de nuevo.',
  'sin-acceso': 'Tu usuario no está activo o no tiene acceso. Habla con el administrador.',
  salida: 'Cerraste sesión.',
  'enlace-invalido': 'El enlace venció o ya se usó. Pide al administrador una nueva invitación.',
};

export default async function Ingreso({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  return <FormIngreso aviso={motivo ? MOTIVOS[motivo] : undefined} />;
}
