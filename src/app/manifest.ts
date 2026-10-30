import type { MetadataRoute } from 'next';

// Permite instalar la app en el celular y el computador (PWA)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SAFE BSO · Contabilidad',
    short_name: 'SAFE BSO',
    start_url: '/',
    display: 'standalone',
    background_color: '#eef1f4',
    theme_color: '#0e2a3f',
    lang: 'es-CO',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
