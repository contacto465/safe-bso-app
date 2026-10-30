// Mapa de módulos de la plataforma (mismo orden que el tablero aprobado).
// `disponible` se activa a medida que se construye cada fase.

export type Modulo = {
  id: string;
  nombre: string;
  href: string;
  fase: number;
  disponible?: boolean;
  soloAdminGeneral?: boolean;
};
export type GrupoModulos = { nombre: string; modulos: Modulo[] };

export const GRUPOS: GrupoModulos[] = [
  {
    nombre: 'Comercial',
    modulos: [
      { id: 'inicio', nombre: 'Tablero', href: '/', fase: 1, disponible: true },
      { id: 'clientes', disponible: true, nombre: 'Clientes', href: '/clientes', fase: 2 },
      { id: 'empresas', disponible: true, nombre: 'Atención a empresas', href: '/empresas', fase: 2 },
      { id: 'procesos', nombre: 'Control de procesos', href: '/procesos', fase: 6 },
      { id: 'documentos', nombre: 'Documentos y fechas', href: '/documentos', fase: 6 },
      { id: 'cotizaciones', disponible: true, nombre: 'Cotizaciones y prefacturas', href: '/cotizaciones', fase: 2 },
      { id: 'contratos', nombre: 'Contratos', href: '/contratos', fase: 2 },
      { id: 'ventas', nombre: 'Ventas', href: '/ventas', fase: 3 },
      { id: 'metas', nombre: 'Metas de ventas', href: '/metas', fase: 7 },
      { id: 'seguimiento', nombre: 'Seguimiento', href: '/seguimiento', fase: 5 },
      { id: 'satisfaccion', nombre: 'Satisfacción y referidos', href: '/satisfaccion', fase: 5 },
    ],
  },
  {
    nombre: 'Dinero que entra',
    modulos: [
      { id: 'abonos', nombre: 'Abonos y cartera', href: '/abonos', fase: 3 },
      { id: 'terceros', nombre: 'Pagos a embajadas', href: '/terceros', fase: 3 },
      { id: 'devoluciones', nombre: 'Devoluciones', href: '/devoluciones', fase: 3 },
      { id: 'fondo', nombre: 'Fondo 10%', href: '/fondo', fase: 3 },
    ],
  },
  {
    nombre: 'Dinero que sale',
    modulos: [
      { id: 'gastos', nombre: 'Gastos', href: '/gastos', fase: 4 },
      { id: 'reembolsos', nombre: 'Reembolsos a empleados', href: '/reembolsos', fase: 4 },
      { id: 'cxp', nombre: 'Proveedores y cuentas por pagar', href: '/proveedores', fase: 4 },
      { id: 'cajamenor', nombre: 'Caja menor', href: '/caja-menor', fase: 4 },
    ],
  },
  {
    nombre: 'Acreedores (lo que debemos)',
    modulos: [
      { id: 'acreedores', nombre: 'Acreedores', href: '/acreedores', fase: 4 },
      { id: 'calendario', nombre: 'Calendario de pagos', href: '/calendario-pagos', fase: 4 },
    ],
  },
  {
    nombre: 'Deudores (lo que nos deben)',
    modulos: [
      { id: 'deudores', nombre: 'Deudores', href: '/deudores', fase: 4 },
      { id: 'prestamos', nombre: 'Préstamos a empleados', href: '/prestamos-empleados', fase: 4 },
    ],
  },
  {
    nombre: 'Control',
    modulos: [
      { id: 'conciliacion', nombre: 'Conciliación bancaria', href: '/conciliacion', fase: 4 },
      { id: 'facturacion', nombre: 'Factura electrónica', href: '/facturacion', fase: 3 },
      { id: 'tributario', nombre: 'Calendario tributario', href: '/tributario', fase: 4 },
      { id: 'reportes', nombre: 'Tesorería y reportes', href: '/reportes', fase: 7 },
    ],
  },
  {
    nombre: 'Configuración',
    modulos: [
      { id: 'catalogo', nombre: 'Catálogo de servicios', href: '/catalogo', fase: 1, disponible: true },
      { id: 'formas', nombre: 'Formas de pago', href: '/configuracion/formas-pago', fase: 1, disponible: true },
      { id: 'medios', nombre: 'Métodos de pago y tarifas', href: '/configuracion/medios-pago', fase: 1, disponible: true },
      { id: 'pasarela', nombre: 'Pasarela de pagos', href: '/pasarela', fase: 8 },
      { id: 'oficinas', nombre: 'Oficinas y empresa', href: '/configuracion/oficinas', fase: 1, disponible: true },
      { id: 'usuarios', nombre: 'Usuarios y accesos', href: '/configuracion/usuarios', fase: 1, disponible: true, soloAdminGeneral: true },
      { id: 'reglas', nombre: 'Términos y reglas', href: '/configuracion/reglas', fase: 1, disponible: true },
      { id: 'integraciones', nombre: 'Integraciones', href: '/integraciones', fase: 6 },
      { id: 'plantillas', nombre: 'Plantillas de correo', href: '/plantillas', fase: 5 },
      { id: 'respaldos', nombre: 'Copias de seguridad', href: '/respaldos', fase: 7, soloAdminGeneral: true },
      { id: 'auditoria', nombre: 'Auditoría', href: '/configuracion/auditoria', fase: 1, disponible: true, soloAdminGeneral: true },
    ],
  },
];
