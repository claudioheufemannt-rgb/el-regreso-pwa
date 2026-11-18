/**
 * Proyección por tipo de cliente (18-nov-2026), para la pestaña Demanda.
 *
 * El forecast se entrena por producto y formato, no por canal. Para ver "cuánto
 * va a comprar el BaseCamp" se reparte la proyección TOTAL según el peso de
 * cada canal (pronóstico jerárquico de arriba hacia abajo, con proporciones):
 *
 *   peso(canal, ciclo) = peso del canal en el MISMO ciclo del año anterior
 *                        × (peso en los últimos 3 ciclos cerrados
 *                           ÷ peso en esos 3 ciclos un año antes)
 *
 * El primer factor trae la estacionalidad propia de cada canal (el BaseCamp y
 * el PDV pesan más en verano que el retail); el segundo, cómo viene cambiando
 * su participación. Los pesos se normalizan para que los canales sumen el
 * total, así la suma por canal cuadra siempre con el gráfico consolidado.
 *
 * Canales (función SQL produccion_litros_por_canal_ciclo): BaseCamp y PDV por
 * nombre de cliente; HORECA, Retail y Distribuidor por el rubro del local
 * (ventas.categoria_negocio). Lo que no calza va a "otros" (no se ofrece como
 * filtro, pero cuenta para los pesos).
 */

export const CANALES = [
  { id: 'basecamp', label: 'BaseCamp', ayuda: 'BaseCamp El Regreso y BaseCamp Pucón' },
  { id: 'pdv', label: 'PDV', ayuda: 'Punto de venta propio, ferias, eventos y venta directa' },
  { id: 'horeca', label: 'HORECA', ayuda: 'Bares, restaurantes, cafeterías y turismo' },
  { id: 'retail', label: 'Retail', ayuda: 'Supermercados, minimarkets, almacenes y botillerías' },
  { id: 'distribuidor', label: 'Distribuidor', ayuda: 'Distribuidores' },
] as const
export type CanalId = (typeof CANALES)[number]['id']

export interface LitrosCanalCiclo {
  /** yyyy-mm-01 del ciclo 24→23 */
  ciclo: string
  canal: string
  litros: number
}

export interface PuntoCanal {
  mes: string
  tipo: 'historico' | 'forecast'
  litros: number
  litrosMin: number | null
  litrosMax: number | null
}

const MIN_FACTOR = 0.5
const MAX_FACTOR = 2

function mesesAtras(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number)
  const total = y * 12 + (m - 1) - n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * Pesos por canal de un ciclo futuro `mes`, ya normalizados (suman 1).
 * `porCiclo` = litros por canal de cada ciclo cerrado; `cerrados` = ciclos
 * cerrados ordenados.
 */
export function pesosCanal(mes: string, porCiclo: Map<string, Map<string, number>>, cerrados: string[]): Map<string, number> {
  const canales = new Set<string>()
  for (const m of porCiclo.values()) for (const c of m.keys()) canales.add(c)
  const total = (ciclo: string) => [...(porCiclo.get(ciclo)?.values() ?? [])].reduce((a, b) => a + b, 0)
  const peso = (c: string, ciclos: string[]) => {
    const t = ciclos.reduce((a, x) => a + total(x), 0)
    return t > 0 ? ciclos.reduce((a, x) => a + (porCiclo.get(x)?.get(c) ?? 0), 0) / t : 0
  }
  const recientes = cerrados.slice(-3)
  const anioAntes = recientes.map(x => mesesAtras(x, 12))
  const mismoMes = mesesAtras(mes, 12)

  const crudos = new Map<string, number>()
  for (const c of canales) {
    const pReciente = peso(c, recientes)
    const pAntes = peso(c, anioAntes)
    // Sin historia del año anterior (canal nuevo, o el ciclo no existe) se usa
    // el peso reciente tal cual: no hay estacionalidad propia que copiar.
    const base = total(mismoMes) > 0 && pAntes > 0 ? peso(c, [mismoMes]) : pReciente
    const factor = pAntes > 0 ? Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, pReciente / pAntes)) : 1
    crudos.set(c, base * factor)
  }
  const suma = [...crudos.values()].reduce((a, b) => a + b, 0)
  return new Map([...crudos].map(([c, v]) => [c, suma > 0 ? v / suma : 0]))
}

/**
 * Serie de un canal: lo vendido en cada ciclo cerrado y, para los ciclos
 * proyectados del consolidado, su parte según `pesosCanal`.
 */
export function serieDeCanal(
  canal: CanalId,
  filas: LitrosCanalCiclo[],
  general: { mes: string; tipo: 'historico' | 'forecast'; litros: number; litrosMin: number | null; litrosMax: number | null }[],
  mesEnCurso: string,
): { puntos: PuntoCanal[]; litrosMesEnCurso: number; pesoProximo: number | null } {
  const porCiclo = new Map<string, Map<string, number>>()
  for (const f of filas) {
    const m = porCiclo.get(f.ciclo) ?? new Map<string, number>()
    m.set(f.canal, (m.get(f.canal) ?? 0) + Number(f.litros))
    porCiclo.set(f.ciclo, m)
  }
  const cerrados = [...porCiclo.keys()].filter(c => c < mesEnCurso).sort()
  const historico: PuntoCanal[] = cerrados.map(c => ({ mes: c, tipo: 'historico', litros: Math.round(porCiclo.get(c)?.get(canal) ?? 0), litrosMin: null, litrosMax: null }))

  let pesoProximo: number | null = null
  const forecast: PuntoCanal[] = general
    .filter(p => p.tipo === 'forecast' && p.mes >= mesEnCurso)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map(p => {
      const w = pesosCanal(p.mes, porCiclo, cerrados).get(canal) ?? 0
      if (pesoProximo == null && p.mes > mesEnCurso) pesoProximo = w
      return {
        mes: p.mes, tipo: 'forecast' as const, litros: Math.round(p.litros * w),
        litrosMin: p.litrosMin != null ? Math.round(p.litrosMin * w) : null,
        litrosMax: p.litrosMax != null ? Math.round(p.litrosMax * w) : null,
      }
    })

  return { puntos: [...historico, ...forecast], litrosMesEnCurso: Math.round(porCiclo.get(mesEnCurso)?.get(canal) ?? 0), pesoProximo }
}
