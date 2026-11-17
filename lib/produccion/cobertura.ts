/**
 * Motor ÚNICO de cobertura y necesidad de producción (rediseño 4-oct-2026).
 *
 * Antes la pregunta "¿cuánto y cuándo producir?" se contestaba en seis lugares
 * del módulo (Calculadora de cobertura, Necesidad anticipada, tabla de Stock de
 * seguridad, Alarmas de quiebre, …), cada uno con su propia cuenta, y podían dar
 * cifras distintas para el mismo producto. Ahora la pestaña Hoy, la pestaña Plan
 * y los avisos leen TODOS de `calcularCobertura`, así que un producto tiene un
 * solo estado, un solo "a producir" y una sola fecha límite.
 *
 * Unidad de trabajo: producto × FAMILIA de envase (barril | lata). El barril de
 * 50 L se cubre con el de 30 L (traslado interno a BaseCamp), así que se suman;
 * la lata no se cubre con nada. "otros" (pintas, growlers) no tiene colchón.
 *
 * Sin dependencias de React ni de Supabase: lógica pura, con tests.
 */
import {
  inicioDeCiclo, finDeCiclo, ciclosDe, esDiaHabilISO, familiaEnvase, esLineaFija, estaFueraDeProduccion,
  LEAD_TIME_INSUMOS_SEMANAS, type EnvaseBucket, type FamiliaEnvase,
} from './reglas'

/* ── Fechas ────────────────────────────────────────────────────────────── */

const DIA_MS = 86_400_000
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function diffDiasISO(desdeISO: string, hastaISO: string): number {
  return Math.round((t(hastaISO) - t(desdeISO)) / DIA_MS)
}
export function sumarDiasCalISO(desdeISO: string, dias: number): string {
  return iso(t(desdeISO) + Math.round(dias) * DIA_MS)
}
/** Suma días hábiles (lun-vie sin feriados chilenos). */
export function sumarDiasHabilesISO(desdeISO: string, diasHabiles: number): string {
  let ms = t(desdeISO)
  let restantes = Math.max(0, Math.round(diasHabiles))
  while (restantes > 0) { ms += DIA_MS; if (esDiaHabilISO(iso(ms))) restantes-- }
  return iso(ms)
}
/** Resta días hábiles (lun-vie sin feriados chilenos). */
export function restarDiasHabilesISO(desdeISO: string, diasHabiles: number): string {
  let ms = t(desdeISO)
  let restantes = Math.max(0, Math.round(diasHabiles))
  while (restantes > 0) { ms -= DIA_MS; if (esDiaHabilISO(iso(ms))) restantes-- }
  return iso(ms)
}
/** Días hábiles en [desde, hasta], ambos incluidos. */
export function diasHabilesEntre(desdeISO: string, hastaISO: string): number {
  let n = 0
  for (let ms = t(desdeISO); ms <= t(hastaISO); ms += DIA_MS) if (esDiaHabilISO(iso(ms))) n++
  return n
}

/* ── Demanda proyectada ────────────────────────────────────────────────── */

export interface PuntoDemanda {
  mes: string
  tipo: 'historico' | 'forecast'
  litros: number
  litrosMin: number | null
  litrosMax: number | null
  estacionalidad: number | null
}
export interface SerieDemanda {
  producto: string | null
  envaseBucket: string | null
  categoria: string | null
  /** Litros vendidos en lo que va del ciclo en curso. */
  litrosMesEnCurso: number
  puntos: PuntoDemanda[]
}
export interface AvanceCiclo {
  /** yyyy-mm-01 del ciclo en curso (24→23). */
  mes: string
  diasHabilesTranscurridos: number
  diasHabilesEnCiclo: number
}
export interface DemandaConRango { media: number; min: number; max: number }

/**
 * Demanda de cada ciclo de una serie: el ciclo en curso con el ritmo real de lo
 * que va del ciclo (no tiene forecast: está incompleto) y los siguientes con el
 * forecast multiplicado por `factor` (el escenario de venta: 1 = el modelo,
 * 1,2 = un 20% más). El escenario no toca el ciclo en curso: eso ya es venta real.
 */
function ciclosDeDemanda(serie: SerieDemanda, avance: AvanceCiclo, factor = 1) {
  const ritmo = avance.diasHabilesTranscurridos > 0 ? serie.litrosMesEnCurso / avance.diasHabilesTranscurridos : 0
  const cicloActual = ritmo * avance.diasHabilesEnCiclo
  return [
    { mes: avance.mes, media: cicloActual, min: cicloActual, max: cicloActual },
    ...serie.puntos.filter(p => p.tipo === 'forecast' && p.mes > avance.mes).map(p => ({
      mes: p.mes, media: p.litros * factor, min: (p.litrosMin ?? p.litros) * factor, max: (p.litrosMax ?? p.litros) * factor,
    })),
  ]
}

/**
 * Litros que se van a vender entre dos fechas: suma el forecast ciclo a ciclo,
 * prorrateando por días los ciclos cortados. El ciclo en curso no tiene
 * forecast (está incompleto): ahí se usa el ritmo real de lo que va del ciclo.
 */
export function demandaProyectadaConRangoEnPeriodo(serie: SerieDemanda, avance: AvanceCiclo, desdeISO: string, hastaISO: string, factor = 1): DemandaConRango {
  const ciclos = ciclosDeDemanda(serie, avance, factor)
  let media = 0, min = 0, max = 0
  for (const c of ciclos) {
    const ini = inicioDeCiclo(c.mes), fin = finDeCiclo(c.mes)
    const a = ini > desdeISO ? ini : desdeISO
    const b = fin < hastaISO ? fin : hastaISO
    if (a > b) continue
    const frac = (diffDiasISO(a, b) + 1) / (diffDiasISO(ini, fin) + 1)
    media += c.media * frac; min += c.min * frac; max += c.max * frac
  }
  return { media, min, max }
}
export function demandaProyectadaEnPeriodo(serie: SerieDemanda, avance: AvanceCiclo, desdeISO: string, hastaISO: string, factor = 1): number {
  return demandaProyectadaConRangoEnPeriodo(serie, avance, desdeISO, hastaISO, factor).media
}

/**
 * Días HÁBILES que alcanzan `disponible` litros consumiendo la demanda ciclo a
 * ciclo: cada día hábil se descuenta la venta diaria de SU ciclo (litros del
 * ciclo ÷ días hábiles del ciclo). Así un stock que en noviembre "alcanza 60
 * días" al ritmo de noviembre se ve como lo que es si en diciembre la venta
 * sube 40%.
 *
 * Antes (hasta 17-nov-2026) se dividía el disponible por el ritmo de las
 * próximas 4 semanas: en la previa de la temporada alta todas las fechas de
 * quiebre quedaban optimistas.
 *
 * Devuelve `agotado: false` si el stock dura más allá del último ciclo con
 * forecast (los días son entonces los que hay hasta ese ciclo, un mínimo).
 */
export function diasHastaAgotar(series: SerieDemanda[], avance: AvanceCiclo, hoyISO: string, disponible: number, factor = 1): { dias: number; agotado: boolean } | null {
  // Venta por día hábil de cada ciclo, sumando las series del grupo.
  const tasa = new Map<string, number>()
  let ultimoMes = avance.mes
  for (const s of series) {
    for (const c of ciclosDeDemanda(s, avance, factor)) {
      const habiles = Math.max(1, diasHabilesEntre(inicioDeCiclo(c.mes), finDeCiclo(c.mes)))
      tasa.set(c.mes, (tasa.get(c.mes) ?? 0) + c.media / habiles)
      if (c.mes > ultimoMes) ultimoMes = c.mes
    }
  }
  if (![...tasa.values()].some(v => v > 0)) return null
  const fin = finDeCiclo(ultimoMes)
  let restante = disponible
  let dias = 0
  for (let d = sumarDiasCalISO(hoyISO, 1); d <= fin; d = sumarDiasCalISO(d, 1)) {
    if (!esDiaHabilISO(d)) continue
    const venta = tasa.get(ciclosDe(d)[0]) ?? 0
    if (venta > 0 && restante < venta) return { dias: dias + restante / venta, agotado: true }
    restante -= venta
    dias++
  }
  return { dias, agotado: false }
}

/** ¿Algún ciclo del período trae un empuje estacional fuerte (≥15% del total)? */
export function vieneAltaDemanda(serie: SerieDemanda, desdeISO: string, hastaISO: string): boolean {
  return serie.puntos.some(p => {
    if (p.tipo !== 'forecast' || p.estacionalidad == null || p.litros <= 0) return false
    if (finDeCiclo(p.mes) < desdeISO || inicioDeCiclo(p.mes) > hastaISO) return false
    return p.estacionalidad > 0 && p.estacionalidad / p.litros >= 0.15
  })
}

/* ── Cobertura ─────────────────────────────────────────────────────────── */

/** Lo que trae `stock_seguridad` para el primer ciclo proyectado, por producto × envase. */
export interface ColchonEnvase {
  producto: string
  envase: string | null
  categoria: 'cerveza' | 'kombucha'
  stockActualLitros: number | null
  stockActualUnidades: number | null
  /** Litros ya cocinados que van a llegar a bodega (fermentando / declarados). */
  litrosEnProduccion: number
  stockSeguridadLitros: number
  puntoReordenLitros: number
  leadTimeSemanas: number
}

export type EstadoCobertura = 'urgente' | 'reponer' | 'ok' | 'sin_dato'

export const ESTADO_LABEL: Record<EstadoCobertura, string> = {
  urgente: 'Urgente', reponer: 'Reponer pronto', ok: 'Cubierto', sin_dato: 'Sin stock cargado',
}
export const PESO_ESTADO: Record<EstadoCobertura, number> = { urgente: 0, reponer: 1, sin_dato: 2, ok: 3 }

export interface CoberturaFamilia {
  familia: FamiliaEnvase
  /** Litros en bodega + en producción (null = el producto no aparece en el stock). */
  disponibleLitros: number | null
  /** Latas o barriles físicos en bodega (no incluye lo que viene en producción). */
  disponibleUnidades: number | null
  /** Parte del disponible que todavía está en tanque (fermentando / sin envasar). */
  enProduccionLitros: number
  /** Litros por envase de esta familia (30 en barril; promedio real en lata). */
  litrosPorUnidad: number | null
  stockSeguridadLitros: number
  puntoReordenLitros: number
  leadTimeSemanas: number
  /** Litros por día hábil esperados las próximas 4 semanas. */
  ritmoDiario: number
  /** Días HÁBILES que alcanza el disponible consumiendo la venta proyectada
   *  ciclo a ciclo (null = sin ventas). */
  diasCobertura: number | null
  /** El stock dura más que el último ciclo con forecast: `diasCobertura` es un mínimo. */
  duraMasQueElForecast: boolean
  fechaQuiebre: string | null
  /** Último día hábil para empezar a cocinar y llegar antes del quiebre. */
  fechaLimiteCocer: string | null
  /** Último día hábil para pedir los insumos (gestión + cocción antes del quiebre). */
  fechaLimiteInsumos: string | null
  /** Litros que se venden de hoy hasta la fecha elegida. */
  demandaHorizonte: number
  /** Demanda + colchón al final − disponible (≥ 0). */
  aProducirLitros: number
  estado: EstadoCobertura
  altaDemanda: boolean
  motivo: string
}

export interface CoberturaProducto {
  producto: string
  categoria: 'cerveza' | 'kombucha'
  lineaFija: boolean
  estado: EstadoCobertura
  familias: CoberturaFamilia[]
  aProducirLitros: number
  /** El menor de las familias: lo que primero se acaba. */
  diasCobertura: number | null
  fechaLimiteCocer: string | null
  fechaLimiteInsumos: string | null
  altaDemanda: boolean
}

export interface OpcionesCobertura {
  hoyISO: string
  /** Hasta qué fecha hay que llegar cubierto (para "a producir"). */
  hastaISO: string
  /** Días hábiles antes de la fecha límite de cocción en que ya se pide reponer. */
  avisoDiasHabiles?: number
  /** Escenario de venta: multiplica el forecast de los ciclos que vienen
   *  (1 = el modelo tal cual). No toca la venta real del ciclo en curso. */
  factorDemanda?: number
}

const fCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' })

/**
 * Cobertura de todos los productos que tienen colchón calculado.
 *
 * Reglas (las mismas en todo el módulo):
 *  - ritmo (lo que se muestra) = demanda proyectada de las próximas 4 semanas
 *    ÷ días hábiles de esas 4 semanas.
 *  - días de cobertura: se consume la demanda ciclo a ciclo (`diasHastaAgotar`),
 *    no el ritmo de las 4 semanas; quiebre = hoy + esos días hábiles.
 *  - toda la demanda futura se multiplica por `factorDemanda` (escenario).
 *  - los productos fuera de producción (reglas.ts) no entran.
 *  - fecha límite de cocción = quiebre − lead time; de insumos = quiebre −
 *    (lead time + gestión de insumos).
 *  - a producir = demanda hasta la fecha elegida + colchón − disponible.
 *  - urgente: disponible bajo el colchón, o la fecha límite de cocción ya pasó.
 *    reponer: disponible bajo el punto de reorden, o la fecha límite cae dentro
 *    del aviso (10 días hábiles). ok: lo demás. sin_dato: sin stock cargado.
 */
export function calcularCobertura(series: SerieDemanda[], colchones: ColchonEnvase[], avance: AvanceCiclo, op: OpcionesCobertura): CoberturaProducto[] {
  const { hoyISO, hastaISO } = op
  const aviso = op.avisoDiasHabiles ?? 10
  const factor = op.factorDemanda ?? 1
  const fin4 = sumarDiasCalISO(hoyISO, 27)
  const habiles4 = Math.max(1, diasHabilesEntre(hoyISO, fin4))
  const limiteAviso = sumarDiasHabilesISO(hoyISO, aviso)

  // Agrupa colchones y series por producto × familia.
  type Grupo = { producto: string; categoria: 'cerveza' | 'kombucha'; familia: FamiliaEnvase; colchones: ColchonEnvase[]; series: SerieDemanda[] }
  const grupos = new Map<string, Grupo>()
  for (const c of colchones) {
    const fam = familiaEnvase(c.envase)
    if (!fam || estaFueraDeProduccion(c.producto)) continue
    const k = `${c.producto}|${fam}`
    if (!grupos.has(k)) grupos.set(k, { producto: c.producto, categoria: c.categoria, familia: fam, colchones: [], series: [] })
    grupos.get(k)!.colchones.push(c)
  }
  for (const s of series) {
    if (!s.producto || !s.envaseBucket) continue
    const fam = familiaEnvase(s.envaseBucket as EnvaseBucket)
    const g = fam ? grupos.get(`${s.producto}|${fam}`) : undefined
    if (g) g.series.push(s)
  }

  const porProducto = new Map<string, CoberturaProducto>()
  for (const g of grupos.values()) {
    const conStock = g.colchones.filter(c => c.stockActualLitros != null)
    const disponible = conStock.length > 0
      ? g.colchones.reduce((s, c) => s + (c.stockActualLitros ?? 0) + c.litrosEnProduccion, 0)
      : null
    const unidades = g.colchones.some(c => c.stockActualUnidades != null)
      ? g.colchones.reduce((s, c) => s + (c.stockActualUnidades ?? 0), 0)
      : null
    const litrosBodega = g.colchones.reduce((s, c) => s + (c.stockActualLitros ?? 0), 0)
    const litrosPorUnidad = g.familia === 'barril' ? 30 : unidades && unidades > 0 && litrosBodega > 0 ? litrosBodega / unidades : null
    const ss = g.colchones.reduce((s, c) => s + c.stockSeguridadLitros, 0)
    const rop = g.colchones.reduce((s, c) => s + c.puntoReordenLitros, 0)
    const lead = Math.max(0, ...g.colchones.map(c => c.leadTimeSemanas))

    const demanda4 = g.series.reduce((s, x) => s + demandaProyectadaEnPeriodo(x, avance, hoyISO, fin4, factor), 0)
    const ritmo = demanda4 / habiles4
    const demandaHorizonte = hastaISO > hoyISO ? g.series.reduce((s, x) => s + demandaProyectadaEnPeriodo(x, avance, hoyISO, hastaISO, factor), 0) : 0
    const altaDemanda = hastaISO > hoyISO && g.series.some(x => vieneAltaDemanda(x, hoyISO, hastaISO))

    const agota = disponible != null ? diasHastaAgotar(g.series, avance, hoyISO, disponible, factor) : null
    const dias = agota ? agota.dias : null
    // Si el stock dura más que el forecast no hay fecha de quiebre que proyectar.
    const fechaQuiebre = agota?.agotado ? sumarDiasHabilesISO(hoyISO, agota.dias) : null
    const fechaLimiteCocer = fechaQuiebre ? restarDiasHabilesISO(fechaQuiebre, lead * 5) : null
    const fechaLimiteInsumos = fechaQuiebre ? restarDiasHabilesISO(fechaQuiebre, (lead + LEAD_TIME_INSUMOS_SEMANAS) * 5) : null
    const aProducir = disponible != null ? Math.max(0, Math.round(demandaHorizonte + ss - disponible)) : Math.round(demandaHorizonte + ss)

    let estado: EstadoCobertura
    if (disponible == null) estado = 'sin_dato'
    else if (disponible < ss || (fechaLimiteCocer != null && fechaLimiteCocer <= hoyISO)) estado = 'urgente'
    else if (disponible < rop || (fechaLimiteCocer != null && fechaLimiteCocer <= limiteAviso)) estado = 'reponer'
    else estado = 'ok'

    const partes: string[] = []
    if (disponible == null) partes.push('No aparece en el último informe de stock.')
    else {
      partes.push(`Hay ${Math.round(disponible)} L (colchón ${Math.round(ss)} L, reponer bajo ${Math.round(rop)} L).`)
      if (dias != null) partes.push(agota?.agotado
        ? `Las próximas 4 semanas se esperan ${ritmo.toFixed(1)} L por día hábil; con la venta proyectada ciclo a ciclo alcanza ${Math.round(dias)} días hábiles.`
        : `Alcanza más de ${Math.round(dias)} días hábiles: dura más allá del último mes con forecast.`)
      if (fechaLimiteCocer) partes.push(fechaLimiteCocer <= hoyISO ? `Debió cocinarse antes del ${fCorta(fechaLimiteCocer)}.` : `Cocinar antes del ${fCorta(fechaLimiteCocer)}.`)
    }
    if (altaDemanda) partes.push('Se viene temporada alta en el período.')

    const fila: CoberturaFamilia = {
      familia: g.familia, disponibleLitros: disponible != null ? Math.round(disponible) : null, disponibleUnidades: unidades,
      enProduccionLitros: Math.round(g.colchones.reduce((s, c) => s + c.litrosEnProduccion, 0)),
      litrosPorUnidad, stockSeguridadLitros: Math.round(ss), puntoReordenLitros: Math.round(rop), leadTimeSemanas: lead,
      ritmoDiario: Math.round(ritmo * 10) / 10, diasCobertura: dias != null ? Math.round(dias) : null,
      duraMasQueElForecast: agota != null && !agota.agotado,
      fechaQuiebre, fechaLimiteCocer, fechaLimiteInsumos, demandaHorizonte: Math.round(demandaHorizonte),
      aProducirLitros: aProducir, estado, altaDemanda, motivo: partes.join(' '),
    }

    const p = porProducto.get(g.producto) ?? {
      producto: g.producto, categoria: g.categoria, lineaFija: esLineaFija(g.producto), estado: 'ok' as EstadoCobertura,
      familias: [], aProducirLitros: 0, diasCobertura: null, fechaLimiteCocer: null, fechaLimiteInsumos: null, altaDemanda: false,
    }
    p.familias.push(fila)
    porProducto.set(g.producto, p)
  }

  const minFecha = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : a < b ? a : b)
  const out = [...porProducto.values()]
  for (const p of out) {
    p.familias.sort((a, b) => (a.familia === 'barril' ? 0 : 1) - (b.familia === 'barril' ? 0 : 1))
    p.estado = p.familias.reduce<EstadoCobertura>((peor, f) => (PESO_ESTADO[f.estado] < PESO_ESTADO[peor] ? f.estado : peor), 'ok')
    p.aProducirLitros = p.familias.reduce((s, f) => s + f.aProducirLitros, 0)
    const dias = p.familias.map(f => f.diasCobertura).filter((d): d is number => d != null)
    p.diasCobertura = dias.length ? Math.min(...dias) : null
    p.fechaLimiteCocer = p.familias.reduce<string | null>((m, f) => minFecha(m, f.fechaLimiteCocer), null)
    p.fechaLimiteInsumos = p.familias.reduce<string | null>((m, f) => minFecha(m, f.fechaLimiteInsumos), null)
    p.altaDemanda = p.familias.some(f => f.altaDemanda)
  }
  return out.sort((a, b) =>
    PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado]
    || Number(b.lineaFija) - Number(a.lineaFija)
    || (a.diasCobertura ?? 1e9) - (b.diasCobertura ?? 1e9)
    || a.producto.localeCompare(b.producto))
}

/**
 * Para abrir el modal "Programar cocción" (que ya existía y trabaja con el
 * formato de las alarmas): una fila por familia que necesita producción.
 */
export function aSugerencias(p: CoberturaProducto, hoyISO: string) {
  return p.familias
    .filter(f => f.aProducirLitros > 0 || f.estado === 'urgente' || f.estado === 'reponer')
    .map(f => ({
      producto: p.producto,
      envase: (f.familia === 'barril' ? 'barril_30' : 'lata') as EnvaseBucket,
      categoria: p.categoria,
      disponibleLitros: f.disponibleLitros ?? 0,
      disponibleUnidades: f.disponibleUnidades,
      litrosSugeridos: f.aProducirLitros,
      leadTimeSemanas: f.leadTimeSemanas,
      ritmoDiarioActual: f.ritmoDiario,
      diasHastaQuiebre: f.diasCobertura,
      fechaEstimadaQuiebre: f.fechaQuiebre,
      motivo: f.motivo,
      lineaFija: p.lineaFija,
      litrosFermentando: 0,
      fechaFermentandoListo: null,
      fechaLimiteInicio: f.fechaLimiteCocer,
      atrasado: f.estado === 'urgente' && f.fechaLimiteCocer != null && f.fechaLimiteCocer <= hoyISO,
      puntoReordenLitros: f.puntoReordenLitros,
      fechaLimiteGestion: f.fechaLimiteInsumos,
      atrasadoGestion: f.fechaLimiteInsumos != null && f.fechaLimiteInsumos <= hoyISO,
    }))
}
