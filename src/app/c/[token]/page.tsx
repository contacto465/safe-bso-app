import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DocumentoCotizacion, type DocCotizacion } from '@/components/documento-cotizacion';
import { Respuesta } from './respuesta';

export const metadata: Metadata = { title: 'Cotización · SAFE BSO MIGRATION', robots: { index: false } };

// Página pública: el cliente la abre con su enlace único, sin iniciar sesión.
export default async function CotizacionPublica({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc('cotizacion_publica', { p_token: token });
  if (!data) notFound();
  const d = data as DocCotizacion & { vigente: boolean; estado: string; whatsapp: string | null };
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 print:max-w-none print:p-0">
      <Respuesta token={token} vigente={d.vigente} estado={d.estado} whatsapp={d.whatsapp} consecutivo={d.consecutivo} />
      <div id="metodos"><DocumentoCotizacion d={d} /></div>
    </main>
  );
}
