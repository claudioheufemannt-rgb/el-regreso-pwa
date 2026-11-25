// Detalle de ventas de Merch (/ventas/merch).
//
// Fuente: tabla `ventas` con categoria_producto = 'Merch' (growlers, vasos,
// jockeys, poleras, stickers, etc.). A diferencia del resto de Ventas, acá NO
// se filtran los clientes excluidos (esClienteExcluido): casi todo el merch se
// vende por "Cliente PDV" (tienda) y "Cliente Feria", que están excluidos de
// los KPIs comerciales. Si se filtraran, esta vista mostraría ~12% del merch
// real (verificado 2026-11-25: $3,4 M de $27,9 M).
//
// Montos siempre en neto (total_sin_impuesto), igual que el resto de la app.

export type OrigenMerch = 'PDV' | 'Ferias' | 'Clientes'
export const ORIGENES: OrigenMerch[] = ['PDV', 'Ferias', 'Clientes']

export interface FilaMerch {
  fecha_pedido: string
  producto: string | null
  nombre_fantasia: string | null
  total_sin_impuesto: number | string | null
  pedido: string | null
}

export interface ProductoMerch {
  producto: string
  neto: number
  /** Neto hasta el día/mes de hoy (para comparar el año en curso con el anterior). */
  netoCorte: number
  pedidos: number
  /** Última venta de este producto en CUALQUIER año (para detectar productos que dejaron de venderse). */
  ultimaGlobal: string
}

export interface ClienteMerch {
  nombre: string
  origen: OrigenMerch
  neto: number
  pedidos: number
  ultima: string
}

export interface VentaGrande {
  producto: string
  cliente: string
  fecha: string
  neto: number
}

export interface MerchPeriodo {
  /** Año, o 0 para "Todo". */
  anio: number
  neto: number
  netoCorte: number
  pedidos: number
  /** 12 meses (año) o un valor por año (Todo). */
  serie: { etiqueta: string; neto: number }[]
  origen: Record<OrigenMerch, { neto: number; netoCorte: number }>
  productos: ProductoMerch[]
  clientes: ClienteMerch[]
  /** Líneas sueltas que pesan ≥10% del año (y ≥$500 mil): distorsionan la comparación. */
  grandes: VentaGrande[]
}

export interface MerchResumen {
  hoy: string
  periodos: MerchPeriodo[]
  ultimaVenta: string | null
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function origenDe(cliente: string | null): OrigenMerch {
  const c = (cliente ?? '').trim()
  if (c === 'Cliente PDV') return 'PDV'
  if (/feria/i.test(c)) return 'Ferias'
  return 'Clientes'
}

interface Acum {
  neto: number
  netoCorte: number
  pedidos: Set<string>
}
const nuevoAcum = (): Acum => ({ neto: 0, netoCorte: 0, pedidos: new Set() })

export function resumirMerch(filas: FilaMerch[], hoy: string): MerchResumen {
  const corteMD = hoy.slice(5) // 'MM-DD'
  const ultimaPorProducto = new Map<string, string>()
  let ultimaVenta: string | null = null

  for (const f of filas) {
    const p = f.producto ?? '(sin nombre)'
    const prev = ultimaPorProducto.get(p)
    if (!prev || f.fecha_pedido > prev) ultimaPorProducto.set(p, f.fecha_pedido)
    if (!ultimaVenta || f.fecha_pedido > ultimaVenta) ultimaVenta = f.fecha_pedido
  }

  const anios = [...new Set(filas.map(f => Number(f.fecha_pedido.slice(0, 4))))].sort((a, b) => b - a)

  const construir = (anio: number, subset: FilaMerch[]): MerchPeriodo => {
    const total = nuevoAcum()
    const origen = Object.fromEntries(ORIGENES.map(o => [o, { neto: 0, netoCorte: 0 }])) as MerchPeriodo['origen']
    const prods = new Map<string, Acum>()
    const clis = new Map<string, Acum & { ultima: string }>()
    const serie = anio === 0
      ? [...anios].sort((a, b) => a - b).map(a => ({ etiqueta: String(a), neto: 0 }))
      : MESES.map(m => ({ etiqueta: m, neto: 0 }))

    for (const f of subset) {
      const neto = Number(f.total_sin_impuesto) || 0
      const enCorte = f.fecha_pedido.slice(5) <= corteMD
      const pedido = f.pedido ?? `${f.fecha_pedido}-${f.nombre_fantasia}`
      const o = origenDe(f.nombre_fantasia)
      const p = f.producto ?? '(sin nombre)'
      const c = f.nombre_fantasia ?? '(sin cliente)'

      total.neto += neto
      if (enCorte) total.netoCorte += neto
      total.pedidos.add(pedido)
      origen[o].neto += neto
      if (enCorte) origen[o].netoCorte += neto

      const ap = prods.get(p) ?? nuevoAcum()
      ap.neto += neto
      if (enCorte) ap.netoCorte += neto
      ap.pedidos.add(pedido)
      prods.set(p, ap)

      const ac = clis.get(c) ?? { ...nuevoAcum(), ultima: f.fecha_pedido }
      ac.neto += neto
      ac.pedidos.add(pedido)
      if (f.fecha_pedido > ac.ultima) ac.ultima = f.fecha_pedido
      clis.set(c, ac)

      const idx = anio === 0
        ? serie.findIndex(s => s.etiqueta === f.fecha_pedido.slice(0, 4))
        : Number(f.fecha_pedido.slice(5, 7)) - 1
      if (idx >= 0) serie[idx].neto += neto
    }

    // ≥10% del año Y al menos $500 mil: en años chicos (2023) el 10% solo
    // marcaba ventas normales como "puntuales".
    const umbralGrande = Math.max(total.neto * 0.1, 500_000)
    const grandes: VentaGrande[] = anio === 0 ? [] : subset
      .filter(f => (Number(f.total_sin_impuesto) || 0) >= umbralGrande)
      .map(f => ({
        producto: f.producto ?? '(sin nombre)',
        cliente: f.nombre_fantasia ?? '(sin cliente)',
        fecha: f.fecha_pedido,
        neto: Number(f.total_sin_impuesto) || 0,
      }))
      .sort((a, b) => b.neto - a.neto)

    return {
      anio,
      neto: total.neto,
      netoCorte: total.netoCorte,
      pedidos: total.pedidos.size,
      serie,
      origen,
      productos: [...prods.entries()]
        .map(([producto, a]) => ({
          producto, neto: a.neto, netoCorte: a.netoCorte, pedidos: a.pedidos.size,
          ultimaGlobal: ultimaPorProducto.get(producto) ?? '',
        }))
        .filter(p => Math.abs(p.neto) >= 1)
        .sort((a, b) => b.neto - a.neto),
      clientes: [...clis.entries()]
        .map(([nombre, a]) => ({ nombre, origen: origenDe(nombre), neto: a.neto, pedidos: a.pedidos.size, ultima: a.ultima }))
        .sort((a, b) => b.neto - a.neto)
        .slice(0, 20),
      grandes,
    }
  }

  const periodos = anios.map(a => construir(a, filas.filter(f => f.fecha_pedido.startsWith(String(a)))))
  periodos.push(construir(0, filas))
  return { hoy, periodos, ultimaVenta }
}

/** $14,1 M · $992 mil · $5.336 */
export function fmtMonto(n: number): string {
  const abs = Math.abs(n)
  const signo = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${signo}$${(abs / 1_000_000).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`
  if (abs >= 10_000) return `${signo}$${Math.round(abs / 1000).toLocaleString('es-CL')} mil`
  return `${signo}$${Math.round(abs).toLocaleString('es-CL')}`
}

/** Variación % o null si no hay base para comparar. */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null
  return ((actual - anterior) / anterior) * 100
}

export function fmtFechaCorta(iso: string): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-').map(Number)
  return `${d}-${MESES[m - 1].toLowerCase()}${a !== new Date().getFullYear() ? `-${String(a).slice(2)}` : ''}`
}

export function diasDesde(iso: string, hoy: string): number {
  return Math.round((Date.parse(hoy) - Date.parse(iso)) / 86_400_000)
}
