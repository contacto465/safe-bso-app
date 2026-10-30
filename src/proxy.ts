import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Rutas que no exigen sesión
const PUBLICAS = ['/ingreso', '/auth', '/c/'];
// Rutas que exigen sesión pero no la verificación en dos pasos completa
const SIN_2FA = ['/verificacion'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // sin configurar: las páginas muestran el aviso

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Valida el token con el servidor de autenticación y lo refresca si hace falta
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const redirigir = (destino: string) => {
    const r = NextResponse.redirect(new URL(destino, request.url));
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (PUBLICAS.some((p) => path.startsWith(p))) return response;
  if (!user) return redirigir('/ingreso');

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const completo = aal?.currentLevel === 'aal2';
  if (!completo && !SIN_2FA.some((p) => path.startsWith(p))) return redirigir('/verificacion');
  if (completo && SIN_2FA.some((p) => path.startsWith(p))) return redirigir('/');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.*|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
