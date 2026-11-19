import { ETIQUETA_CARTERA } from '@/lib/types'

/** Cliente activo = compró en los últimos 2 años (decisión de Claudio, 2026-10-30). */
export const ACTIVO_DIAS = 730

export type CarteraKey = 'rm' | 'lagos' | 'rios' | 'araucania' | 'retail' | 'online' | 'otros'

/** Carteras en el orden en que se muestran. `vendedor` = nombre canónico
 *  (vendedorCanonico); la etiqueta visible sale de ETIQUETA_CARTERA, así un
 *  cambio de etiqueta en lib/types.ts llega solo a esta pantalla. */
export const CARTERAS: { key: Exclude<CarteraKey, 'otros'>; vendedor: string; nombre: string; color: string }[] = [
  { key: 'rios',      vendedor: 'Nicol Delgado',     nombre: ETIQUETA_CARTERA['Nicol Delgado'].corta,     color: '#60A5FA' },
  { key: 'lagos',     vendedor: 'Marion Meza',       nombre: ETIQUETA_CARTERA['Marion Meza'].corta,       color: '#2DD4BF' },
  { key: 'araucania', vendedor: 'Marcelo Diaz',      nombre: ETIQUETA_CARTERA['Marcelo Diaz'].corta,      color: '#F97316' },
  { key: 'rm',        vendedor: 'Yadro Fabijancic',  nombre: ETIQUETA_CARTERA['Yadro Fabijancic'].corta,  color: '#A78BFA' },
  { key: 'retail',    vendedor: 'Claudio Heufemann', nombre: ETIQUETA_CARTERA['Claudio Heufemann'].corta, color: '#D4AF37' },
  { key: 'online',    vendedor: 'OnLine',            nombre: 'OnLine',                                    color: '#F472B6' },
]

/** Clientes cuyo vendedor (asignado y de su última compra) no es una cartera
 *  vigente: Inactivo, Incobrable, Douglas Koenig, CERVECERÍA, sin vendedor… */
export const CARTERA_OTROS = { key: 'otros' as const, nombre: 'Otros', color: '#8A847D' }

/** Región operativa (users.region / lib/regiones.ts) → zona de esta pantalla. */
const CARTERA_DE_REGION: Record<string, Exclude<CarteraKey, 'otros'>> = {
  'Metropolitana': 'rm',
  'La Araucanía':  'araucania',
  'Los Ríos':      'rios',
  'Los Lagos':     'lagos',
}

export function carteraDeRegion(region: string | null | undefined): Exclude<CarteraKey, 'otros'> | null {
  return region ? CARTERA_DE_REGION[region] ?? null : null
}

export function infoCartera(key: CarteraKey) {
  return CARTERAS.find(c => c.key === key) ?? CARTERA_OTROS
}

export type EstadoCliente = 'activo' | 'inactivo' | 'sin_compras'

export interface ClienteCartera {
  id: number | null
  nombre: string
  razonSocial: string | null
  categoria: string | null
  localidad: string | null
  provincia: string | null
  telefono: string | null
  cartera: CarteraKey
  /** Vendedor tal como lo trae el ERP — se muestra sólo en la cartera "Otros". */
  vendedorErp: string | null
  estado: EstadoCliente
  primeraCompra: string | null
  ultimaCompra: string | null
  diasSinComprar: number | null
  /** Días promedio entre compras (null si compró un solo día). */
  cicloDias: number | null
  /** Días distintos en que compró (el ERP parte una compra en varios pedidos). */
  compras: number
  litros: number
  /** Venta neta histórica (total sin impuestos). */
  monto: number
  litros12m: number
  monto12m: number
}

export interface DetalleCliente {
  anios: { anio: number; litros: number; monto: number; compras: number }[]
  productos: { producto: string; litros: number; monto: number; veces: number; ultima: string }[]
  /** Todas las compras, una por día, con sus facturas y lo que llevó en cada una. */
  historial: CompraHistorial[]
}

export interface ItemCompra { producto: string | null; envase: string | null; litros: number; monto: number }

/** Latas y barriles que representa una línea. El ERP no exporta cantidad,
 *  sólo litros + envase: "Lata (473 ml)" 2,8 L → 6 latas; "Barril" en
 *  múltiplos de 30 L (o de 50 L) → N barriles. Mismo criterio que
 *  bucketEnvase (lib/produccion/reglas.ts). Growlers del PDV (1–2 L en
 *  envase "Barril"), empaque y despacho no cuentan como unidades. */
export interface Unidades { latas: number; barriles: number }

export function unidadesDe(envase: string | null, litros: number): Unidades {
  if (!envase || litros <= 0) return { latas: 0, barriles: 0 }
  const ml = /^lata/i.test(envase) ? envase.match(/(\d+)\s*ml/i)?.[1] : undefined
  if (ml) return { latas: Math.round(litros / (Number(ml) / 1000)), barriles: 0 }
  if (/^barril/i.test(envase)) {
    for (const tam of [30, 50]) {
      const n = litros / tam
      // litros llegan redondeados a 1 decimal desde la RPC
      if (n >= 1 && Math.abs(n - Math.round(n)) < 0.01) return { latas: 0, barriles: Math.round(n) }
    }
  }
  return { latas: 0, barriles: 0 }
}

export function sumarUnidades(items: { envase: string | null; litros: number }[]): Unidades {
  return items.reduce<Unidades>((acc, it) => {
    const u = unidadesDe(it.envase, it.litros)
    return { latas: acc.latas + u.latas, barriles: acc.barriles + u.barriles }
  }, { latas: 0, barriles: 0 })
}

/** ["24 latas", "2 barriles"] — vacío si la línea no son latas ni barriles. */
export function textoUnidades(u: Unidades): string[] {
  const out: string[] = []
  if (u.latas > 0) out.push(`${u.latas.toLocaleString('es-CL')} ${u.latas === 1 ? 'lata' : 'latas'}`)
  if (u.barriles > 0) out.push(`${u.barriles.toLocaleString('es-CL')} ${u.barriles === 1 ? 'barril' : 'barriles'}`)
  return out
}

export interface CompraHistorial {
  fecha: string; litros: number; monto: number
  /** Un documento por factura; si aún no se factura, por N° de pedido. */
  docs: { factura: string | null; pedidos: string | null; litros: number; monto: number; items: ItemCompra[] }[]
}
