# SAFE BSO MIGRATION · Contabilidad, cotizaciones y CRM

Plataforma interna de SAFE BSO MIGRATION. **Fase 1** (esta versión): ingreso seguro, catálogo de servicios,
formas de pago, métodos de pago y tarifas, oficinas, usuarios y reglas del negocio.

- **Stack:** Next.js 16 (React, TypeScript) · Supabase (PostgreSQL, autenticación, RLS) · Tailwind · Netlify
- **Documento de requerimientos:** proyecto «SOFTWARE CONTABLE» en Claude (`requerimientos-software-contable.md`)

## Seguridad (la garantiza la base de datos, no solo la pantalla)

| Regla | Dónde se aplica |
|---|---|
| Máximo 3 usuarios activos; nadie se registra solo | Disparador `perfiles_limite`; la app solo invita |
| Verificación en dos pasos obligatoria | Sin nivel `aal2` las políticas RLS no devuelven datos |
| Barranquilla solo ve Barranquilla; nadie de allá ve el consolidado | `app.puede_ver_oficina()` en cada política |
| Solo administradores editan el catálogo; vendedores no ven costos | Políticas `admin` y `servicio_costos.ver` |
| Solo el administrador general cambia usuarios, alcances y reglas | `app.es_admin_general()` |
| Todo cambio queda registrado | Disparador `auditar` en cada tabla |
| Cierre de sesión por inactividad (30 min, configurable) | `CierrePorInactividad` |

## Puesta en marcha (una sola vez, ~20 minutos)

### 1. Base de datos (Supabase)
1. Crea un proyecto en Supabase (región `South America (São Paulo)`).
2. **SQL Editor** → ejecuta en orden los archivos de `supabase/migrations/`.
3. **Authentication → Providers → Email:** desactiva *Allow new users to sign up* (nadie se registra solo).
4. **Authentication → Multi-Factor:** activa *TOTP (App Authenticator)*.
5. **Authentication → URL Configuration:** *Site URL* = la dirección final de la app (ej. `https://contabilidad-safe.netlify.app`) y en *Redirect URLs* agrega esa misma dirección seguida de `/**`.
6. **Correo (SMTP propio, recomendado):** el acceso es sin contraseña, con un enlace que llega al correo. El correo integrado de Supabase solo envía unos pocos mensajes por hora y únicamente a los miembros del equipo de Supabase; para que lleguen a cualquier usuario configura un SMTP propio en **Authentication → Emails → SMTP Settings** (Gmail/Google Workspace con contraseña de aplicación, o Resend).
7. **Authentication → Users → Add user → Send invitation** a tu correo, y ejecuta `supabase/primer_administrador.sql`.

### 2. Publicación (Netlify)
1. Sube este código a GitHub y en Netlify: *Add new site → Import from GitHub*.
2. **Site configuration → Environment variables:** las tres de `.env.example`
   (Supabase → Project Settings → API). La `SUPABASE_SERVICE_ROLE_KEY` es secreta: solo va aquí.
3. Publica y abre la dirección: entras con el enlace del correo de invitación (sin contraseña) y activas la verificación en dos pasos. Después, para entrar, escribes tu correo y abres el enlace que te llega.

### 3. Primeros pasos en la app
1. **Formas de pago:** crea las que usas (cada servicio debe tener la suya).
2. **Catálogo → Cargar desde archivo:** descarga la plantilla, llénala en Excel y súbela.
3. **Métodos de pago:** ajusta cuentas, instrucciones y comisiones (plataformas al 3%).
4. **Oficinas y empresa:** NIT, direcciones, teléfonos y colores de la marca.
5. **Usuarios:** invita a las otras 2 personas con su correo y asigna su alcance. Con abrir el enlace entran.
6. **Carga inicial (Excel):** descarga la plantilla y sube de una vez deudas, pagos de deudas, ventas del mes y abonos.

### Actualizaciones de la base de datos
Cada fase trae un archivo `supabase/FASE*.sql` para pegar una sola vez en el SQL Editor (fase 3: `FASE3_ventas_acreedores.sql`).

## Desarrollo

```bash
cp .env.example .env.local   # completa las llaves
npm install
npm run dev                  # http://localhost:3000
npm test                     # cálculos + 24 pruebas de seguridad de la base de datos (Postgres embebido)
npm run build
```

- **Marca:** cambiar colores y tipografía en `src/app/theme.css` actualiza toda la app.
- **Módulos:** `src/lib/modulos.ts` controla el menú; cada fase activa los suyos.
- **Migraciones nuevas:** un archivo nuevo en `supabase/migrations/` por cada cambio (nunca editar los ya aplicados).

## Fases
1. ✅ Catálogo, costos, IVA, formas y métodos de pago, oficinas, usuarios, reglas, auditoría, carga masiva
2. Clientes, empresas, cotizaciones y prefacturas (consecutivo BOG-303-VA-MARIAC, vigencia 3 días, PDF), contratos
3. Ventas, abonos y cartera, pagos a embajadas, fondo 10%, devoluciones, paz y salvo, factura electrónica
4. Gastos, proveedores, caja menor, acreedores, deudores, préstamos, conciliación, calendario tributario
5. Seguimiento, alertas, correos, satisfacción y referidos
6. Integraciones (Control de procesos, Sheets, webhooks), documentos del caso
7. Tesorería, reportes, metas, copias de seguridad
8. Pasarela de pagos
