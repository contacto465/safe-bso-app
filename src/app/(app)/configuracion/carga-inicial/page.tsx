import type { Metadata } from 'next';
import { requerirAdmin } from '@/lib/auth';
import { Encabezado } from '@/components/ui';
import { CargaInicialForm } from './carga';

export const metadata: Metadata = { title: 'Carga inicial' };

export default async function CargaInicial() {
  await requerirAdmin();
  return (
    <>
      <Encabezado titulo="Carga inicial desde Excel" descripcion="Sube de una vez las deudas que tiene la empresa, sus pagos, las ventas de este mes (y las anteriores con saldo) y los abonos de los clientes. Se carga todo o nada: si una fila tiene un error, no se guarda nada y te dice cuál es." />
      <CargaInicialForm />
    </>
  );
}
