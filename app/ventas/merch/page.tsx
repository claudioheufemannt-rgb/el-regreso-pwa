import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyISO } from '@/lib/cobranza'
import { resumirMerch, type FilaMerch } from '@/lib/merch'
import MerchClient from './MerchClient'

export const dynamic = 'force-dynamic'

// Detalle de ventas de Merch. Ver lib/merch.ts: incluye a propósito los
// clientes excluidos de los KPIs (Cliente PDV / Cliente Feria), que son
// por donde sale casi todo el merch.
export default async function MerchPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  // Service-role a propósito — ver lib/supabase/admin.ts. Se pagina porque
  // PostgREST corta en 1.000 filas (son ~5.000 líneas de merch en total).
  const supabase = createAdminClient()
  const filas: FilaMerch[] = []
  const PAGE = 1000
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from('ventas')
      .select('fecha_pedido, producto, nombre_fantasia, total_sin_impuesto, pedido')
      .eq('categoria_producto', 'Merch')
      .order('id', { ascending: true })
      .range(off, off + PAGE - 1)
    if (error) throw new Error(`No se pudieron cargar las ventas de merch: ${error.message}`)
    if (!data?.length) break
    filas.push(...(data as FilaMerch[]))
    if (data.length < PAGE) break
  }

  return <MerchClient resumen={resumirMerch(filas, hoyISO())} />
}
