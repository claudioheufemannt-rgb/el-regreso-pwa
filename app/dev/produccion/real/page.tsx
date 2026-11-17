import { notFound } from 'next/navigation'
import ProduccionVista from '@/app/produccion/vista'

/**
 * Producción con los datos de verdad, sin pasar por el login, para revisar el
 * módulo en local (mismo patrón que /dev/administracion). /dev/produccion y
 * /dev/produccion/completo siguen siendo con datos inventados.
 *
 * Sólo existe en desarrollo (proxy.ts bloquea /dev fuera de desarrollo y este
 * notFound es la segunda capa). Es de solo lectura en la práctica: los botones
 * que guardan llaman a las APIs, que sí exigen sesión.
 */
export const dynamic = 'force-dynamic'

export default async function DevProduccionRealPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <ProduccionVista esAdmin nombreUsuario="Banco de pruebas" inicialesUsuario="BP" />
}
