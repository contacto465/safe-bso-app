import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SAFE BSO · Contabilidad', template: '%s · SAFE BSO' },
  description: 'Contabilidad, cotizaciones y gestión comercial de SAFE BSO MIGRATION',
  applicationName: 'SAFE BSO',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0e2a3f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
