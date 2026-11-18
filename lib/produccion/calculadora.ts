/**
 * "¿Cuánto producir?" (17-nov-2026): dónde y cuándo cocinar una cantidad.
 *
 * La pregunta de la calculadora de Plan es "¿cuánta Berry Menta hago para
 * llegar a febrero?". La cantidad sale del motor de cobertura; esto contesta
 * la segunda mitad: en qué fermentador cabe y desde cuándo está libre, y si
 * no cabe en uno, en cuántos lotes partirla.
 *
 * Lógica pura, sin React ni Supabase.
 */

export interface TanqueCalc {
  nombre: string
  categoria: 'cerveza' | 'kombucha'
  capacidadLitros: number
}
export interface OcupacionCalc {
  fermentador: string | null
  inicioISO: string
  /** Días corridos de ocupación. */
  dias: number
  /** Las sugerencias del modelo no ocupan un tanque: son propuestas. */
  tipo: 'confirmado' | 'sugerido' | 'en_tanque'
}
export interface LoteRecomendado {
  tanque: string
  capacidadLitros: number
  /** Primer día en que el tanque está libre (desde la fecha pedida). */
  inicioISO: string
  /** Litros de este lote (≤ capacidad). */
  litros: number
  /** Día en que el lote queda listo para envasar. */
  listoISO: string
  /** Queda listo después del límite para cocinar + fermentar: llega tarde. */
  tarde: boolean
}

const DIA = 86_400_000
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const sumar = (d: string, n: number) => iso(t(d) + n * DIA)

/** Tanques de línea: el bright tank y los de laboratorio no fermentan lotes de venta. */
export const esTanqueDeLinea = (nombre: string) => !/bright|lavoratorio|laboratorio/i.test(nombre)

/** Desde cuándo está libre cada tanque, mirando lo agendado y lo que hay en él. */
export function libreDesde(tanque: string, ocupacion: OcupacionCalc[], desdeISO: string): string {
  let libre = desdeISO
  for (const o of ocupacion) {
    if (o.fermentador !== tanque || o.tipo === 'sugerido') continue
    const fin = sumar(o.inicioISO, o.dias)
    if (fin > libre && o.inicioISO <= sumar(libre, 365)) libre = fin
  }
  return libre
}

/**
 * Reparte `litros` en lotes, eligiendo tanques de la línea: primero los que
 * se liberan antes y, entre los que se liberan el mismo día, el que menos
 * capacidad desperdicia. Si un tanque alcanza para todo, es un solo lote.
 *
 * `limiteISO` es la fecha en que el producto se queda sin stock (o el fin del
 * horizonte): un lote listo después de esa fecha llega tarde y se marca.
 */
export function recomendarLotes(
  litros: number, categoria: 'cerveza' | 'kombucha', tanques: TanqueCalc[], ocupacion: OcupacionCalc[],
  desdeISO: string, diasFermentacion: number, limiteISO: string | null, maxLotes = 4,
): LoteRecomendado[] {
  if (litros <= 0) return []
  const candidatos = tanques
    .filter(x => x.categoria === categoria && x.capacidadLitros > 0 && esTanqueDeLinea(x.nombre))
    .map(x => ({ ...x, libre: libreDesde(x.nombre, ocupacion, desdeISO) }))

  const lote = (x: (typeof candidatos)[number], l: number): LoteRecomendado => {
    const listo = sumar(x.libre, diasFermentacion)
    return { tanque: x.nombre, capacidadLitros: x.capacidadLitros, inicioISO: x.libre, litros: Math.round(l), listoISO: listo, tarde: limiteISO != null && listo > limiteISO }
  }

  // ¿Uno solo alcanza? El que se libera antes; a igual fecha, el más justo.
  const unSolo = candidatos.filter(x => x.capacidadLitros >= litros)
    .sort((a, b) => a.libre.localeCompare(b.libre) || a.capacidadLitros - b.capacidadLitros)[0]
  if (unSolo) return [lote(unSolo, litros)]

  // Si no, se parte: los tanques que se liberan antes, los más grandes primero.
  const orden = [...candidatos].sort((a, b) => a.libre.localeCompare(b.libre) || b.capacidadLitros - a.capacidadLitros)
  const out: LoteRecomendado[] = []
  let resto = litros
  for (const x of orden) {
    if (resto <= 0 || out.length >= maxLotes) break
    const l = Math.min(resto, x.capacidadLitros)
    out.push(lote(x, l))
    resto -= l
  }
  return out
}
