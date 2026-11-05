import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Enlace de los correos de invitación, de acceso (sin contraseña) y de recuperación de contraseña.
// Invitación y acceso → entran directo (solo falta la verificación en dos pasos); recuperación → crear contraseña.
// Plantilla en Supabase: {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite (o recovery)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const supabase = await createClient();
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/auth/clave' : '/verificacion', request.url));
    return NextResponse.redirect(new URL('/ingreso?motivo=enlace-invalido', request.url));
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/verificacion', request.url));
    return NextResponse.redirect(new URL('/ingreso?motivo=enlace-invalido', request.url));
  }
  // Plantilla estándar: la sesión viene en el fragmento (#access_token=…), que solo lee el navegador.
  // El fragmento se conserva en la redirección y lo procesa la pantalla de ingreso.
  return NextResponse.redirect(new URL('/ingreso', request.url));
}
