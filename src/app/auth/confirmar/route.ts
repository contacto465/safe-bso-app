import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Enlace de los correos de invitación y de recuperación de contraseña.
// Plantilla en Supabase: {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite (o recovery)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL('/auth/clave', request.url));
  }
  return NextResponse.redirect(new URL('/ingreso?motivo=enlace-invalido', request.url));
}
