import { PLANTILLA_CSV } from '@/lib/importacion';

// Plantilla para cargar el catálogo desde Excel (separador punto y coma, con BOM para tildes)
export function GET() {
  return new Response('﻿' + PLANTILLA_CSV + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="plantilla-catalogo-safe-bso.csv"',
    },
  });
}
