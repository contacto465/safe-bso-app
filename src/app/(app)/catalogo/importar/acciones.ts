'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mensajeError, requerirAdmin } from '@/lib/auth';
import type { FilaImportada } from '@/lib/importacion';

export type ResultadoImportacion = {
  creados: number;
  actualizados: number;
  enlaces: number;
  avisos: string[];
  errores: string[];
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function importarServicios(filas: FilaImportada[]): Promise<ResultadoImportacion> {
  await requerirAdmin();
  const supabase = await createClient();
  const r: ResultadoImportacion = { creados: 0, actualizados: 0, enlaces: 0, avisos: [], errores: [] };
  const validas = filas.filter((f) => f.errores.length === 0);
  if (validas.length > 500) return { ...r, errores: ['Máximo 500 filas por archivo.'] };

  const [{ data: cats }, { data: formas }, { data: existentes }] = await Promise.all([
    supabase.from('categorias_servicio').select('id, nombre'),
    supabase.from('formas_pago').select('id, nombre'),
    supabase.from('servicios').select('id, abreviatura, tipo'),
  ]);
  const catPorNombre = new Map((cats ?? []).map((c) => [norm(c.nombre), c.id as string]));
  const formaPorNombre = new Map((formas ?? []).map((f) => [norm(f.nombre), f.id as string]));
  const idPorAbrev = new Map((existentes ?? []).map((s) => [s.abreviatura as string, s.id as string]));
  const tipoPorAbrev = new Map((existentes ?? []).map((s) => [s.abreviatura as string, s.tipo as string]));

  for (const f of validas) {
    let categoria_id: string | undefined;
    if (f.categoria) {
      categoria_id = catPorNombre.get(norm(f.categoria));
      if (!categoria_id) {
        const { data, error } = await supabase.from('categorias_servicio').insert({ nombre: f.categoria }).select('id').single();
        if (error) { r.errores.push(`Línea ${f.linea}: categoría — ${mensajeError(error)}`); continue; }
        categoria_id = data.id as string;
        catPorNombre.set(norm(f.categoria), categoria_id);
      }
    }
    let forma_pago_id: string | undefined;
    if (f.forma_pago) {
      forma_pago_id = formaPorNombre.get(norm(f.forma_pago));
      if (!forma_pago_id) r.avisos.push(`Línea ${f.linea} (${f.abreviatura}): la forma de pago "${f.forma_pago}" no existe; créala y asígnala.`);
    } else if (f.tipo !== 'tercero') {
      r.avisos.push(`Línea ${f.linea} (${f.abreviatura}): sin forma de pago.`);
    }
    const id = idPorAbrev.get(f.abreviatura);
    const { data, error } = await supabase.rpc('guardar_servicio', {
      p: {
        id, tipo: f.tipo, nombre: f.nombre, abreviatura: f.abreviatura, descripcion: f.descripcion, incluye: f.incluye,
        categoria_id, moneda: f.moneda, precio: f.precio, iva_pct: f.iva, forma_pago_id,
        beneficiario: f.beneficiario, recargo_gestion: f.recargo_gestion, activo: true,
        ...(f.costos.length ? { costos: f.costos } : {}),
      },
    });
    if (error) { r.errores.push(`Línea ${f.linea} (${f.abreviatura}): ${mensajeError(error)}`); continue; }
    if (id) r.actualizados++; else r.creados++;
    idPorAbrev.set(f.abreviatura, data as string);
    tipoPorAbrev.set(f.abreviatura, f.tipo);
  }

  // Enlaces adicional → principal ("aplica_a")
  for (const f of validas.filter((x) => x.aplica_a.length && x.tipo !== 'principal')) {
    const adicional_id = idPorAbrev.get(f.abreviatura);
    if (!adicional_id) continue;
    for (const ab of f.aplica_a) {
      const principal_id = idPorAbrev.get(ab);
      if (!principal_id || tipoPorAbrev.get(ab) !== 'principal') {
        r.avisos.push(`Línea ${f.linea} (${f.abreviatura}): "${ab}" no es un servicio principal del catálogo.`);
        continue;
      }
      const { error } = await supabase.from('servicio_adicionales')
        .upsert({ principal_id, adicional_id }, { onConflict: 'principal_id,adicional_id', ignoreDuplicates: true });
      if (error) r.errores.push(`Línea ${f.linea}: enlace con ${ab} — ${mensajeError(error)}`);
      else r.enlaces++;
    }
  }
  revalidatePath('/catalogo');
  return r;
}
