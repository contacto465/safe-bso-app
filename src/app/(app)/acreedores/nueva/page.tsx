import type { Metadata } from 'next';
import { requerirCostos } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { hoyBogota } from '@/lib/formato';
import { Encabezado } from '@/components/ui';
import { FormDeuda } from '../form';

export const metadata: Metadata = { title: 'Registrar deuda' };

export default async function NuevaDeuda() {
  const s = await requerirCostos();
  const supabase = await createClient();
  const { data: corte } = await supabase.from('configuracion').select('valor').eq('clave', 'fecha_corte').maybeSingle();
  const principal = s.oficinas.find((o) => o.es_principal) ?? s.oficinas[0];
  return (
    <>
      <Encabezado titulo="Registrar deuda" migas={[{ href: '/acreedores', texto: 'Deudas y acreedores' }]}
        descripcion="Escribe el saldo que se debe a la fecha de corte (solo capital), no el valor original." />
      <FormDeuda veTodo={s.perfil.ve_todo} oficinas={s.oficinas.map((o) => ({ id: o.id, nombre: o.nombre }))} inicial={{
        acreedor: '', tipo: 'Banco', documento: '', concepto: '', fecha_prestamo: '', valor_original: '',
        fecha_corte: (corte?.valor as string | null) ?? hoyBogota(), saldo_inicial: '', tasa_pct: '', tasa_periodo: 'Mensual',
        cuota_valor: '', cuotas_restantes: '', proxima_fecha: '', asignacion: 'oficina', oficina_id: principal?.id ?? '', reparto: {},
        soporte: '', notas: '',
      }} />
    </>
  );
}
