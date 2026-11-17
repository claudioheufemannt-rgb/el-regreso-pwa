import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import ProduccionVista from './vista'

// Los tipos del módulo viven en vista.tsx; se re-exportan para no cambiar los
// `import type … from './page'` de los componentes.
export type * from './vista'

export const dynamic = 'force-dynamic'

export default async function ProduccionPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')
  // Mismo criterio que Rentabilidad: si no tiene acceso rebota al Hub sin
  // revelar que la ruta existe. Admins + equipo de Producción.
  if (!user.isAdmin && user.macroArea !== 'produccion') redirect('/')

  return <ProduccionVista esAdmin={user.isAdmin} nombreUsuario={user.nombre} inicialesUsuario={user.iniciales} />
}
