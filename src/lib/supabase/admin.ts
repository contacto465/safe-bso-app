import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Cliente con la llave de servicio: SALTA las políticas RLS.
// Solo se usa en el servidor, DESPUÉS de verificar que quien llama es administrador general
// (invitar o desactivar usuarios en el sistema de autenticación).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (ver README, paso 2).');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
