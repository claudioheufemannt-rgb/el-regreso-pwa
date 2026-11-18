'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Settings2, AlertTriangle, ChevronLeft, ChevronRight, Eye, X, Beaker, PackagePlus } from 'lucide-react'
import { useEstadoArrastre, type CargaArrastre, type DestinoArrastre, type StoreArrastre } from './useArrastreCalendario'
import FilaCobertura, { type NivelCobertura, type TramoCobertura } from './FilaCobertura'
import type { FamiliaEnvase } from '@/lib/produccion/reglas'

/**
 * Carta Gantt de ocupación de fermentadores.
 *
 * Reemplaza a las dos grillas de calendario que había antes ("Calendario de
 * Cocciones Sugeridas" y "Cronograma de Cocciones"), que mostraban la misma
 * planta en dos lugares y con dos criterios distintos. Acá hay una sola foto:
 * filas = tanques, columnas = días, bloques = cocciones.
 *
 * DÍAS CORRIDOS, NO HÁBILES. El Gantt que se llevaba en Excel usaba una
 * columna por día hábil, así que un bloque que en la realidad ocupa el tanque
 * 12 días corridos se veía de 10 y el sábado y domingo desaparecían del
 * cálculo. La fermentación no para el fin de semana: acá cada día es una
 * columna y el finde va sombreado, para que el ancho del bloque sea la
 * duración de verdad.
 *
 * Los bloques confirmados van sólidos y los sugeridos en punteado. Arrastrar
 * un sugerido lo confirma; arrastrar uno confirmado lo mueve de día y/o de
 * tanque, y eso se guarda en base (a diferencia de antes, que vivía en un
 * useState y se perdía al recargar).
 */

export interface FermentadorGantt {
  nombre: string
  tipo: string
  categoria: 'cerveza' | 'kombucha'
  capacidadLitros: number
  /** Litros que el ERP dice que tiene AHORA — para marcar el que ya está ocupado. */
  litrosActuales: number
}

export interface BloqueGantt {
  /** id del plan si está confirmado; una clave sintética si es sugerencia o
   *  detección de ERP. */
  id: string
  /** 'en_tanque': el ERP dice que hay litros físicos en ese fermentador
   *  ahora mismo, pero ningún lote del plan lo cubre — no hay id de lote que
   *  editar, así que no se arrastra ni se puede quitar. Su fecha de inicio es
   *  una ESTIMACIÓN (retrocedida desde el embarrilado estimado del ERP, o
   *  desde hoy si el ERP no trajo esa fecha): existe para que la ocupación
   *  real de la planta no quede invisible, no para reprogramar nada. */
  tipo: 'confirmado' | 'sugerido' | 'en_tanque'
  producto: string
  categoria: 'cerveza' | 'kombucha'
  litros: number
  inicioISO: string
  /** Días corridos de ocupación del tanque. */
  dias: number
  fermentador: string | null
  /** Para poder reconstruir la carga de arrastre de una sugerencia. */
  loteNro?: number
  motivo?: string | null
  atrasado?: boolean
  /** Sólo en tipo 'en_tanque' — código de lote del informe del ERP. Identifica
   *  esta cocción física, para poder guardar una corrección de fecha que le
   *  pertenezca a ELLA y no al tanque en general (ver ajuste_lote_tanque). */
  codigoLote?: string | null
}

export interface ConfigProducto {
  producto: string
  categoria: 'cerveza' | 'kombucha'
  diasFermentacion: number
  litrosObjetivo: number | null
  color: string
}

interface Props {
  fermentadores: FermentadorGantt[]
  bloques: BloqueGantt[]
  config: ConfigProducto[]
  /** Almacén del arrastre (ver useArrastreCalendario): el Gantt lo lee solo,
   *  así un movimiento del puntero no redibuja el módulo entero. */
  arrastreStore: StoreArrastre
  propsOrigen: (carga: CargaArrastre, habilitado?: boolean) => Record<string, unknown>
  onAbrirConfig: () => void
  /** Abre el modal de "Agregar producto" (ver ModalAgregarProducto.tsx) —
   *  vive fuera de este componente porque necesita `agregarLote`, que ya
   *  administra el estado de guardado/error de ProduccionClient. */
  onAgregarProducto?: () => void
  onAbrirBloque?: (bloque: BloqueGantt, rect?: DOMRect) => void
  /** Saca un lote YA CONFIRMADO de la programación. Antes de esto la única
   *  forma era ir a buscar la fila en Plan Maestro — acá se puede hacer donde
   *  se está mirando el problema, sin cambiar de pestaña. Sólo aplica a
   *  bloques confirmados: uno sugerido no está en el plan, así que no hay
   *  nada que "quitar" — simplemente no se confirma. */
  onQuitarBloque?: (bloque: BloqueGantt) => void
  /** id del bloque que se acaba de mover, para que aterrice con un latido.
   *  Lo informa quien hizo el movimiento — comparar posiciones entre renders
   *  obligaría a leer y escribir un ref durante el render, que React prohíbe. */
  bloqueRecienMovido?: string | null
  /** Movimientos de esta sesión que todavía no se reflejan en el plan. */
  anclasEnSesion?: number
  onLimpiarAnclas?: () => void
  /** Necesidad del paso 2 contra lo que hay agendado, por mes. Es lo que
   *  convierte al Gantt en tablero de control y no sólo en un calendario:
   *  responde "¿lo agendado cubre lo que dije que necesito?". */
  cobertura?: { mes: string; necesidad: number; planificado: number }[]
  /** Lo que hace falta de cada producto y a qué ritmo se vende. Con esto el
   *  Gantt calcula la FECHA DE COBERTURA — hasta cuándo alcanza el stock — y
   *  la dibuja sobre el mismo eje que las cocciones, que es lo que permite ver
   *  de un golpe si algo se acaba antes de que llegue su lote. */
  necesidad?: NecesidadProducto[]
  /** Último mes proyectado (yyyy-mm-01). La grilla llega hasta el final de ese
   *  mes en vez de cortar en una ventana fija: planificar con el forecast
   *  puesto y no poder verlo entero obliga a paginar a ciegas. */
  hastaMes?: string | null
  /** Mínimo de semanas a mostrar cuando no hay forecast cargado. */
  semanas?: number
}

export interface NecesidadProducto {
  producto: string
  categoria: 'cerveza' | 'kombucha'
  /** Litros disponibles hoy en cámara. */
  stockActual: number
  /** Ritmo de venta por mes, en litros/día. El mes EN CURSO es venta REAL de
   *  las últimas 4 semanas (auditado 21-sep-2026 contra el informe de venta
   *  detallada: el forecast subestimaba hasta 107%); los meses futuros de la
   *  proyección siguen viniendo del forecast, que es lo único que puede
   *  respetar la estacionalidad de un mes que todavía no pasó. */
  ritmo: { mes: string; litrosDia: number }[]
  /** Stock de seguridad del producto, en litros. Es el umbral bajo el cual la
   *  barra de cobertura pasa a ámbar. Opcional: sin él se usan siete días de
   *  venta, que es lo mismo pero sin la σ del producto. */
  colchon?: number
  /** Estado de HOY partido por familia de envase (barril vs lata) — ver
   *  familiaEnvase en reglas.ts. Vacío si el producto no tiene stock de
   *  seguridad por formato todavía.
   *
   *  Es deliberadamente una FOTO de hoy y no una curva proyectada como el
   *  resto de la fila: los litros que están fermentando no tienen formato
   *  asignado (eso se decide recién al envasar, en el Split de Envasado), así
   *  que proyectar una cobertura por familia hacia adelante sería inventar un
   *  reparto que nadie decidió todavía. La barra del calendario sigue siendo
   *  a granel, que es lo correcto — una cocción es a granel. */
  familias: { familia: FamiliaEnvase; stockActual: number; colchon: number }[]
}

const MS_DIA = 86_400_000
/* Dos densidades, no tres. El "amplio" de 40 px/día daba 2.800 px de ancho a
   diez semanas: nadie planifica scrolleando cuatro pantallas. Cada densidad
   define también el alto de fila — con 23 tanques, 44 px por fila eran mil
   píxeles de grilla antes de ver nada más. */
const DENSIDAD = {
  compacto: { dia: 14, fila: 26, etiqueta: 10 },
  normal: { dia: 24, fila: 34, etiqueta: 11 },
  // Amplio (17-nov-2026): bloques de dos líneas (producto / litros y fecha de
  // listo) para leer el plan sin pasar el mouse por cada bloque.
  amplio: { dia: 34, fila: 48, etiqueta: 12 },
} as const
type Zoom = keyof typeof DENSIDAD
const ORDEN_ZOOM: Zoom[] = ['compacto', 'normal', 'amplio']
// 168 alcanzaba de sobra para "F. T13", pero en la fila de cobertura dejaba
// ~144px útiles para el nombre completo del producto MÁS el número de stock
// — con nombres largos ("Kombucha Maracuyá Cardamomo") el truncado cortaba
// justo donde todos empiezan igual ("Kombucha Ma...") y quedaban
// indistinguibles entre sí sin pasar el mouse. Se comparte una sola
// constante entre las dos secciones (cobertura y tanques) a propósito: son
// columnas sticky una debajo de la otra, y si tuvieran anchos distintos la
// grilla de días de una quedaría corrida contra la de la otra.
const ANCHO_TANQUE = 240

function isoADate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function dateAIso(d: Date) {
  return d.toISOString().slice(0, 10)
}
function sumarDias(iso: string, n: number) {
  return dateAIso(new Date(isoADate(iso).getTime() + n * MS_DIA))
}
function diffDias(desdeISO: string, hastaISO: string) {
  return Math.round((isoADate(hastaISO).getTime() - isoADate(desdeISO).getTime()) / MS_DIA)
}
function hoyISO() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Negro o blanco según qué contraste mejor sobre el color del bloque. La
 *  paleta la elige el usuario desde la configuración, así que el texto no
 *  puede asumir un fondo oscuro. */
/** Litros abreviados para las cabeceras: con seis datos en una línea, los
 *  miles completos empujan el resto fuera de pantalla. */
function fLitros(n: number) {
  return n >= 10000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : Math.round(n).toLocaleString('es-CL')
}

function textoSobre(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Luminancia relativa aproximada (coeficientes ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#1a1a1a' : '#ffffff'
}

export default function GanttProduccion({
  fermentadores, bloques, config, arrastreStore, propsOrigen,
  onAbrirConfig, onAgregarProducto, onAbrirBloque, onQuitarBloque, bloqueRecienMovido = null,
  anclasEnSesion = 0, onLimpiarAnclas, cobertura = [],
  necesidad = [], hastaMes = null, semanas = 10,
}: Props) {
  const arrastre = useEstadoArrastre(arrastreStore)
  const [zoom, setZoom] = useState<Zoom>('normal')
  /** Grupos plegados. Plegar NO esconde información: la cabecera del grupo
   *  lleva su propio resumen (ocupados, litros, % de capacidad), así que
   *  cerrar Laboratorio deja de costar 4 filas y no cuesta saber cómo está. */
  const [plegados, setPlegados] = useState<Set<string>>(new Set(['Laboratorio']))
  /** Los tanques sin nada agendado en la ventana son la mitad de la grilla y
   *  no aportan a leer el plan. Se esconden por defecto y se cuentan en la
   *  cabecera del grupo, que es donde importan: "quedan 8 libres". */
  const [ocultarLibres, setOcultarLibres] = useState(true)
  /** Filtro de línea. Cervecería y kombuchería son procesos separados con
   *  tanques que no se intercambian: mirar una sola a la vez es cómo se
   *  planifica de verdad. */
  const [linea, setLinea] = useState<'todas' | 'cerveza' | 'kombucha'>('todas')
  /** Las sugerencias del modelo se pueden apagar: al ordenar el plan estorban,
   *  y al armarlo son justamente lo que se busca. */
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false)
  /** Las filas "hasta cuándo alcanza" de cada producto: apagadas por defecto
   *  (17-nov-2026). Mezcladas con los tanques duplicaban el alto de la carta, y
   *  la pregunta que contestan ahora la responde "¿Cuánto producir?" en Plan. */
  const [mostrarCobertura, setMostrarCobertura] = useState(false)
  const alternarGrupo = useCallback((titulo: string) => {
    setPlegados(p => {
      const n = new Set(p)
      if (n.has(titulo)) n.delete(titulo); else n.add(titulo)
      return n
    })
  }, [])
  /** Arranca mostrando ENTERO lo que ya está en curso. Antes la ventana
   *  siempre partía en la semana de hoy, así que una cocción o una detección
   *  del ERP que empezó antes quedaba recortada por el borde izquierdo — se
   *  veía que el tanque estaba ocupado, pero no desde cuándo. Ahora el punto
   *  de partida es el lunes de la semana de hoy O el lunes de la semana del
   *  bloque real más antiguo, el que sea anterior.
   *
   *  Sólo bloques REALES (confirmado o detectado en el ERP) mueven el punto
   *  de partida — un sugerido es una propuesta del modelo, nunca arranca
   *  antes de hoy, así que no puede ser el más antiguo.
   *
   *  Se calcula una sola vez al montar (useState perezoso), no con un
   *  useEffect que lo recalcule: si el usuario navega semanas y después
   *  llega un dato nuevo, no tiene que saltar de vuelta — eso pelearía
   *  contra la navegación en vez de ayudarla. */
  const [offsetSemanas, setOffsetSemanas] = useState(() => {
    const hoy0 = hoyISO()
    const reales = bloques.filter(b => b.tipo !== 'sugerido').map(b => b.inicioISO)
    if (reales.length === 0) return 0
    const masAntiguo = reales.reduce((a, b) => (b < a ? b : a))
    if (masAntiguo >= hoy0) return 0
    const lunesDe = (iso: string) => {
      const d = isoADate(iso)
      return sumarDias(iso, -((d.getUTCDay() + 6) % 7))
    }
    return Math.floor(diffDias(lunesDe(hoy0), lunesDe(masAntiguo)) / 7)
  })
  const scrollRef = useRef<HTMLDivElement>(null)

  /** Dirección del último salto de semanas, para que la grilla entre desde
   *  el lado hacia el que se viaja en vez de aparecer sin más. */
  const [sentido, setSentido] = useState<'izq' | 'der' | null>(null)
  const irASemana = useCallback((delta: number) => {
    setSentido(delta === 0 ? null : delta > 0 ? 'der' : 'izq')
    setOffsetSemanas(o => (delta === 0 ? 0 : o + delta))
    // "Hoy" vuelve también el desplazamiento horizontal al inicio de la
    // ventana (el lunes de esta semana): antes cambiaba la ventana pero el
    // scroll quedaba donde estaba y hoy podía seguir fuera de la vista.
    if (delta === 0) scrollRef.current?.scrollTo({ left: 0 })
  }, [])

  const { dia: anchoDia, fila: altoFila, etiqueta: tamEtiqueta } = DENSIDAD[zoom]

  /* ── Navegación con mouse y teclado (17-nov-2026) ──
     · Arrastrar el FONDO de la grilla la desplaza (los bloques siguen siendo
       arrastrables: el paneo sólo arranca fuera de un bloque o un botón).
     · Ctrl/⌘ + rueda cambia el zoom; la rueda sola sigue bajando la página
       y Shift + rueda (o el trackpad) va de lado, como en todo navegador.
     · Con la grilla enfocada, ← y → mueven una semana.
     El paneo es 1:1 con el puntero y sin animación: es manipulación directa. */
  const [paneando, setPaneando] = useState(false)
  const paneandoRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let inicio: { x: number; y: number; left: number; top: number; id: number } | null = null
    const vertical = () => el.closest<HTMLElement>('[data-autoscroll="y"]')
    const abajo = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return
      const t = e.target as HTMLElement
      if (t.closest('button, [role="button"], a, input, select, textarea')) return
      inicio = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: vertical()?.scrollTop ?? 0, id: e.pointerId }
    }
    const mover = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return
      const dx = e.clientX - inicio.x, dy = e.clientY - inicio.y
      if (!paneandoRef.current && Math.hypot(dx, dy) < 4) return // un clic no es un paneo
      if (!paneandoRef.current) {
        paneandoRef.current = true
        setPaneando(true)
        try { el.setPointerCapture(e.pointerId) } catch { /* el puntero ya no existe: se panea igual */ }
      }
      el.scrollLeft = inicio.left - dx
      const v = vertical()
      if (v) v.scrollTop = inicio.top - dy
    }
    const arriba = (e: PointerEvent) => {
      if (inicio && e.pointerId === inicio.id && paneandoRef.current) {
        paneandoRef.current = false
        setPaneando(false)
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      }
      inicio = null
    }
    const rueda = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault() // si no, el navegador hace zoom de la página entera
      setZoom(z => {
        const i = ORDEN_ZOOM.indexOf(z) + (e.deltaY < 0 ? 1 : -1)
        return ORDEN_ZOOM[Math.max(0, Math.min(ORDEN_ZOOM.length - 1, i))]
      })
    }
    el.addEventListener('pointerdown', abajo)
    el.addEventListener('pointermove', mover)
    el.addEventListener('pointerup', arriba)
    el.addEventListener('pointercancel', arriba)
    el.addEventListener('wheel', rueda, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', abajo)
      el.removeEventListener('pointermove', mover)
      el.removeEventListener('pointerup', arriba)
      el.removeEventListener('pointercancel', arriba)
      el.removeEventListener('wheel', rueda)
    }
  }, [])
  const teclaGrilla = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return // las teclas de un bloque enfocado son suyas
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.currentTarget.scrollBy({ left: (e.key === 'ArrowRight' ? 7 : -7) * DENSIDAD[zoom].dia })
    }
  }, [zoom])
  const hoy = hoyISO()

  const colorPorProducto = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of config) m.set(c.producto, c.color)
    return m
  }, [config])

  /** La ventana arranca el lunes de la semana de hoy, para que las columnas
   *  caigan siempre en el mismo día de la semana al paginar. */
  const inicioVentana = useMemo(() => {
    const d = isoADate(hoy)
    const lunes = (d.getUTCDay() + 6) % 7
    return sumarDias(hoy, -lunes + offsetSemanas * 7)
  }, [hoy, offsetSemanas])

  const dias = useMemo(() => {
    // Hasta el último día del último mes proyectado. Se redondea a semanas
    // completas para que las columnas sigan cayendo siempre en el mismo día
    // de la semana al paginar hacia atrás.
    let total = semanas * 7
    if (hastaMes) {
      const d = isoADate(hastaMes)
      const finMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      const dias = diffDias(inicioVentana, dateAIso(finMes)) + 1
      if (dias > total) total = Math.ceil(dias / 7) * 7
    }
    return Array.from({ length: total }, (_, i) => {
      const iso = sumarDias(inicioVentana, i)
      const d = isoADate(iso)
      const dow = d.getUTCDay()
      return {
        iso, i,
        dow,
        finde: dow === 0 || dow === 6,
        dia: d.getUTCDate(),
        mes: d.getUTCMonth(),
        esHoy: iso === hoy,
        // Primer día del mes visible: sirve para cortar la banda de meses.
        primeroDeMes: d.getUTCDate() === 1 || i === 0,
      }
    })
  }, [inicioVentana, semanas, hoy, hastaMes])

  const finVentana = dias[dias.length - 1]?.iso ?? inicioVentana

  /** Tramos de mes para la banda superior: {label, desdeIdx, cols}. */
  const bandaMeses = useMemo(() => {
    const out: { label: string; desde: number; cols: number }[] = []
    for (const d of dias) {
      const label = isoADate(d.iso).toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const ultimo = out[out.length - 1]
      if (!ultimo || ultimo.label !== label) out.push({ label, desde: d.i, cols: 1 })
      else ultimo.cols++
    }
    return out
  }, [dias])

  /** Bloques por tanque, ya recortados a la ventana visible. Los que no tienen
   *  fermentador asignado van aparte, en una fila "sin asignar" — si no,
   *  desaparecerían del Gantt y nadie sabría que quedaron sueltos. */
  const bloquesVisibles = useMemo(
    () => (mostrarSugerencias ? bloques : bloques.filter(b => b.tipo !== 'sugerido')),
    [bloques, mostrarSugerencias]
  )

  const { porTanque, sinAsignar, solapes, noCaben } = useMemo(() => {
    const porTanque = new Map<string, BloqueGantt[]>()
    const sinAsignar: BloqueGantt[] = []
    for (const b of bloquesVisibles) {
      const fin = sumarDias(b.inicioISO, b.dias - 1)
      if (fin < inicioVentana || b.inicioISO > finVentana) continue
      if (!b.fermentador) { sinAsignar.push(b); continue }
      if (!porTanque.has(b.fermentador)) porTanque.set(b.fermentador, [])
      porTanque.get(b.fermentador)!.push(b)
    }
    // Dos cocciones en el mismo tanque a la vez es físicamente imposible: se
    // marcan las dos para que se vea que el plan está mal, en vez de dibujar
    // un bloque encima del otro y que parezca normal.
    const solapes = new Set<string>()
    for (const lista of porTanque.values()) {
      const orden = [...lista].sort((a, b) => a.inicioISO.localeCompare(b.inicioISO))
      for (let i = 1; i < orden.length; i++) {
        const prevFin = sumarDias(orden[i - 1].inicioISO, orden[i - 1].dias - 1)
        if (orden[i].inicioISO <= prevFin) { solapes.add(orden[i].id); solapes.add(orden[i - 1].id) }
      }
    }
    // Un bloque cuyo litraje supera la capacidad del tanque tampoco es
    // ejecutable. Se cuenta acá y no sólo se marca en la fila: con 23 filas,
    // un aviso que vive dentro de una de ellas no se ve.
    let noCaben = 0
    for (const [nombre, lista] of porTanque) {
      const cap = fermentadores.find(f => f.nombre === nombre)?.capacidadLitros ?? 0
      if (cap > 0) noCaben += lista.filter(b => b.litros > cap).length
    }
    return { porTanque, sinAsignar, solapes, noCaben }
  }, [bloquesVisibles, inicioVentana, finVentana, fermentadores])

  /**
   * Fecha de cobertura por producto: hasta cuándo alcanza lo que hay.
   *
   * Se simula día a día desde hoy: se descuenta el ritmo de venta proyectado
   * de ese mes —por mes, no un promedio plano, así diciembre consume más
   * rápido que septiembre— y se suma cada cocción el día que queda LISTA
   * (inicio + días de ocupación), no el día que entra al tanque: mientras
   * fermenta no se puede vender.
   *
   * Se calcula acá dentro y no se recibe ya resuelto a propósito: depende de
   * dónde están los bloques, así que al arrastrar una cocción la fecha de
   * cobertura se mueve en vivo. Eso es lo que responde "¿me conviene
   * adelantarla?" sin tener que confirmar para ver qué pasa.
   */
  const coberturaProducto = useMemo(() => {
    if (necesidad.length === 0) return []
    const finGrilla = dias[dias.length - 1]?.iso ?? hoy

    const mesHoy = hoy.slice(0, 8) + '01'

    return necesidad.map(n => {
      const ritmoPorMes = new Map(n.ritmo.map(r => [r.mes, r.litrosDia]))
      const ultimoRitmo = n.ritmo[n.ritmo.length - 1]?.litrosDia ?? 0
      const ritmoDe = (fecha: string) => ritmoPorMes.get(fecha.slice(0, 8) + '01') ?? ultimoRitmo

      /* La velocidad que se muestra es la de ESTE mes, no el promedio del
         horizonte: es la que sirve para decidir hoy. El promedio de cuatro
         meses con estacionalidad adentro no describe ninguno de los cuatro. */
      const velocidad = ritmoPorMes.get(mesHoy) ?? ultimoRitmo

      /* Umbral del ámbar: el stock de seguridad que el propio modelo
         dimensionó para este producto —con su σ y su nivel de servicio— y
         siete días de venta cuando no hay uno cargado.

         NO es un porcentaje del stock inicial. Un 30% fijo sería 150 días de
         cobertura en un producto lento y 4 en uno rápido: el mismo color
         significaría dos cosas opuestas según la fila que se esté mirando. */
      const colchonEstimado = !(n.colchon != null && n.colchon > 0)
      const colchon = colchonEstimado ? velocidad * 7 : (n.colchon as number)

      // Cuándo queda listo cada lote de este producto, con sus litros.
      const entradas = new Map<string, number>()
      for (const b of bloquesVisibles) {
        if (b.producto !== n.producto) continue
        const listo = sumarDias(b.inicioISO, b.dias)
        entradas.set(listo, (entradas.get(listo) ?? 0) + b.litros)
      }

      let stock = n.stockActual
      let agota: string | null = null
      let minimo = stock
      const llegadas: { fecha: string; litros: number }[] = []
      const tramos: TramoCobertura[] = []

      for (let i = 0; i <= diffDias(hoy, finGrilla); i++) {
        const fecha = sumarDias(hoy, i)
        const entra = entradas.get(fecha)
        if (entra) { stock += entra; llegadas.push({ fecha, litros: entra }) }
        stock -= ritmoDe(fecha)
        if (stock < minimo) minimo = stock
        if (stock <= 0 && !agota) agota = fecha

        /* La simulación NO se corta en el primer cero: sigue hasta el final de
           la grilla. Eso es lo que permite dibujar el tramo que existe sólo
           gracias a un lote agendado después del quiebre — la respuesta a
           "¿hasta cuándo me alcanza si dejo esta cocción acá?", que es la
           pregunta que se hace arrastrando un bloque. */
        const nivel: NivelCobertura = stock <= 0 ? 'cero' : stock <= colchon ? 'bajo' : 'ok'
        // Un tramo en cero nunca es "rescatado": es el agujero, no el rescate.
        const rescatado = nivel !== 'cero' && agota != null && fecha > agota
        const ultimo = tramos[tramos.length - 1]
        if (ultimo && ultimo.nivel === nivel && ultimo.rescatado === rescatado) {
          ultimo.hasta = sumarDias(fecha, 1)
        } else {
          tramos.push({ desde: fecha, hasta: sumarDias(fecha, 1), nivel, rescatado })
        }
      }

      // La primera llegada DESPUÉS del quiebre es la que habría que adelantar.
      const rescate = agota ? llegadas.find(l => l.fecha > agota!) ?? null : null
      return {
        ...n, agota, minimo, llegadas, rescate, tramos, velocidad, colchon, colchonEstimado,
        /* Días de inventario: cuánto dura lo que hay HOY, ignorando todo lo
           agendado. Junto a la fecha de quiebre —que sí lo cuenta— separa
           "aguanta poco" de "aguanta poco y no viene nada". */
        doi: velocidad > 0 ? Math.max(0, Math.floor(n.stockActual / velocidad)) : null,
        // Días que el producto pasaría en cero si nadie mueve nada.
        diasEnCero: agota && rescate ? diffDias(agota, rescate.fecha) : 0,
      }
    }).sort((a, b) => {
      // Primero lo que se agota antes: es el orden en que hay que decidir.
      if (a.agota && b.agota) return a.agota.localeCompare(b.agota)
      if (a.agota) return -1
      if (b.agota) return 1
      return a.producto.localeCompare(b.producto)
    })
  }, [necesidad, bloquesVisibles, dias, hoy])

  const grupos = useMemo(() => {
    const esLab = (n: string) => /lavoratorio|laboratorio/i.test(n)
    // Las filas van por número de tanque (K-1, K-2… / T1, T2…), como en la
    // planta. `fermentadores` llega ordenado por ocupación (ocupacionPlanta),
    // y eso dejaba K-4 entre K-1 y K-2. "Bright tank T4" cae entre T3 y T5.
    const codigo = (n: string) => n.match(/([A-Za-z])-?(\d+)\s*$/)
    const porNumero = (a: FermentadorGantt, b: FermentadorGantt) => {
      const ca = codigo(a.nombre), cb = codigo(b.nombre)
      if (ca && cb) return ca[1].localeCompare(cb[1]) || Number(ca[2]) - Number(cb[2])
      return a.nombre.localeCompare(b.nombre, 'es', { numeric: true })
    }
    const tanquesDe = (f: (t: FermentadorGantt) => boolean) => fermentadores.filter(f).sort(porNumero)
    const crudos: { titulo: string; categoria: 'cerveza' | 'kombucha' | null; tanques: FermentadorGantt[] }[] = [
      { titulo: 'Cervecería', categoria: 'cerveza' as const, tanques: tanquesDe(f => f.categoria === 'cerveza' && !esLab(f.nombre)) },
      { titulo: 'Kombuchería', categoria: 'kombucha' as const, tanques: tanquesDe(f => f.categoria === 'kombucha') },
      { titulo: 'Laboratorio', categoria: null, tanques: tanquesDe(f => esLab(f.nombre)) },
    ].filter(g => g.tanques.length > 0)

    // El resumen es lo que permite plegar sin perder nada: un encargado que
    // cierra un grupo sigue sabiendo cuántos tanques tiene tomados, cuántos
    // litros hay comprometidos y qué proporción de su capacidad es eso.
    return crudos.map(g => {
      const conBloques = g.tanques.filter(t => (porTanque.get(t.nombre) ?? []).length > 0)
      const litros = g.tanques.reduce(
        (a, t) => a + (porTanque.get(t.nombre) ?? []).reduce((x, b) => x + b.litros, 0), 0)
      const capacidad = g.tanques.reduce((a, t) => a + t.capacidadLitros, 0)
      const alertas = g.tanques.reduce((a, t) => a + (porTanque.get(t.nombre) ?? [])
        .filter(b => solapes.has(b.id) || b.litros > t.capacidadLitros).length, 0)
      return {
        ...g,
        ocupados: conBloques.length,
        libres: g.tanques.length - conBloques.length,
        litros, capacidad, alertas,
        pct: capacidad > 0 ? Math.round((litros / capacidad) * 100) : 0,
        visibles: ocultarLibres ? conBloques : g.tanques,
        // La cobertura de los productos de ESTA línea vive dentro del grupo:
        // los tanques de cerveza no fermentan kombucha, así que mezclar las
        // dos en una lista única obligaba a leer 23 filas para encontrar las
        // 6 que importan cuando estás ordenando una sola línea.
        cobertura: g.categoria
          ? coberturaProducto.filter(c => c.categoria === g.categoria)
          : [],
      }
    }).filter(g => linea === 'todas' || g.categoria === linea || g.categoria === null)
  }, [fermentadores, porTanque, solapes, ocultarLibres, coberturaProducto, linea])

  const anchoGrilla = dias.length * anchoDia

  const cargaDe = useCallback((b: BloqueGantt): CargaArrastre => (
    b.tipo === 'confirmado'
      // El id ES el de plan_produccion (ver bloquesGantt en ProduccionClient):
      // es la clave que identifica ESTE lote sin ambigüedad, a diferencia del
      // producto solo, que colisiona en cuanto hay dos cocciones confirmadas
      // del mismo producto en la cola.
      ? { tipo: 'coccion', id: b.id, producto: b.producto, loteNro: b.loteNro ?? 1, categoria: b.categoria, litros: b.litros, idBloque: b.id, dias: b.dias }
      : { tipo: 'sugerencia', producto: b.producto, categoria: b.categoria, litros: b.litros, motivo: b.motivo ?? null, idBloque: b.id, dias: b.dias }
  ), [])

  const destinoActivo = arrastre?.destino ?? null
  /** Cabecera de días memorizada: son ~240 celdas que no cambian al arrastrar. */
  const cabeceraDias = useMemo(() => (
          <div className="flex border-b border-(--p-line) bg-(--p-card)">
            <div style={{ width: ANCHO_TANQUE, flexShrink: 0 }}
              className="sticky left-0 z-20 flex items-center bg-(--p-card) px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-(--p-text-3)">
              Fermentador <span className="ml-auto normal-case text-(--p-text-4)">cap. L</span>
            </div>
            {dias.map(d => (
              <div key={d.iso} style={{ width: anchoDia, flexShrink: 0 }}
                className={`border-l py-1 text-center text-[10px] font-semibold leading-tight ${
                  d.esHoy ? 'border-[#C9A227] bg-[#C9A227]/15 text-(--p-accent)'
                  : d.finde ? 'border-(--p-line) bg-(--p-line)/70 text-(--p-text-3)'
                  : 'border-(--p-line-2) text-(--p-text-3)'
                }`}>
                {anchoDia >= 24 && <div className="text-[9px] font-medium text-(--p-text-4)">{'LMXJVSD'[(d.dow + 6) % 7]}</div>}
                <div>{d.dia}</div>
              </div>
            ))}
          </div>
  ), [dias, anchoDia])
  /** La carga del arrastre sólo llega a las filas que la necesitan: la de
   *  origen (para apagar el bloque) y la de destino (para el contorno). Así,
   *  levantar un bloque no redibuja las otras 20 filas. */
  const carga = arrastre?.carga ?? null
  const cargaParaFila = (tanque: string | null, bloquesFila: BloqueGantt[] | undefined) => {
    if (!carga) return null
    if (destinoActivo && destinoActivo.fermentador === tanque) return carga
    return bloquesFila?.some(b => b.id === carga.idBloque) ? carga : null
  }

  return (
    <div data-arrastrando={arrastre ? '' : undefined} className="flex flex-col overflow-hidden rounded-xl border border-(--p-line) bg-(--p-card) shadow-sm">
      {/* ── Cabecera ─────────────────────────────────────────────────────
          Dos filas (17-nov-2026): arriba qué es y qué anda mal, con las dos
          acciones; abajo cómo se mira (línea, semanas, zoom y qué mostrar).
          Antes eran ocho controles en una sola fila que se partía sola. */}
      <div className="flex flex-col gap-3 border-b border-(--p-line-2) bg-(--p-card) px-4 py-3.5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-[15px] font-bold tracking-tight text-(--p-text)">Ocupación de fermentadores</h3>
            <span className="text-[12px] tabular-nums text-(--p-text-3)">
              {bloques.filter(b => b.tipo === 'confirmado').length} en el plan · {bloques.filter(b => b.tipo === 'en_tanque').length} en tanque según el ERP
              {mostrarSugerencias ? ` · ${bloques.filter(b => b.tipo === 'sugerido').length} sugeridas` : ''}
            </span>
            {anclasEnSesion > 0 && onLimpiarAnclas && (
              <button type="button" onClick={onLimpiarAnclas}
                className="prod-press flex items-center gap-1 rounded-full border border-(--p-accent-line) bg-(--p-accent-soft) px-2.5 py-0.5 text-[11px] font-bold text-(--p-accent)"
                title="Volver al plan que propone el modelo">
                {anclasEnSesion} {anclasEnSesion === 1 ? 'cocción movida' : 'cocciones movidas'}: deshacer
              </button>
            )}
            {solapes.size > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-(--p-bad-line) bg-(--p-bad-soft) px-2 py-0.5 text-[11px] font-bold text-(--p-bad)">
                <AlertTriangle size={12} />
                {solapes.size / 2} choque{solapes.size / 2 === 1 ? '' : 's'} de tanque
              </span>
            )}
            {noCaben > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-(--p-bad-line) bg-(--p-bad-soft) px-2 py-0.5 text-[11px] font-bold text-(--p-bad)">
                <AlertTriangle size={12} />
                {noCaben} no cabe{noCaben === 1 ? '' : 'n'} en su tanque
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onAbrirConfig}
              className="prod-press flex items-center gap-1.5 rounded-lg border border-(--p-line) px-2.5 py-1.5 text-[12px] font-bold text-(--p-text-2) hover:bg-(--p-hover)">
              <Settings2 size={14} />
              Productos
            </button>
            {/* Crea un lote SIN tanque asignado — aparece en "sin asignar",
                listo para arrastrarlo. */}
            {onAgregarProducto && (
              <button type="button" onClick={onAgregarProducto}
                className="prod-press prod-accion flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-bold">
                <PackagePlus size={14} />
                Agregar cocción
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmento
            etiqueta="Línea"
            valor={linea}
            onCambiar={setLinea}
            opciones={[['todas', 'Todas'], ['cerveza', 'Cerveza'], ['kombucha', 'Kombucha']]}
          />
          <div className="flex items-center gap-0.5 rounded-lg border border-(--p-line) p-0.5" role="group" aria-label="Semanas">
            <button type="button" onClick={() => irASemana(-2)} aria-label="Dos semanas atrás"
              className="prod-press rounded-md p-1.5 text-(--p-text-3) hover:bg-(--p-hover) hover:text-(--p-text)">
              <ChevronLeft size={15} />
            </button>
            <button type="button" onClick={() => irASemana(0)}
              className="prod-press rounded-md px-2.5 py-1 text-[12px] font-bold text-(--p-text-2) hover:bg-(--p-hover)">
              Hoy
            </button>
            <button type="button" onClick={() => irASemana(2)} aria-label="Dos semanas adelante"
              className="prod-press rounded-md p-1.5 text-(--p-text-3) hover:bg-(--p-hover) hover:text-(--p-text)">
              <ChevronRight size={15} />
            </button>
          </div>
          <Segmento
            etiqueta="Zoom"
            valor={zoom}
            onCambiar={setZoom}
            opciones={[['compacto', 'Compacto'], ['normal', 'Normal'], ['amplio', 'Amplio']]}
          />
          <span className="hidden h-5 w-px bg-(--p-line) md:block" />
          <Interruptor activo={mostrarCobertura} onCambiar={setMostrarCobertura} titulo="Mostrar hasta cuándo alcanza el stock de cada producto, sobre la misma línea de tiempo">
            Cobertura
          </Interruptor>
          <Interruptor activo={mostrarSugerencias} onCambiar={setMostrarSugerencias} titulo="Mostrar las cocciones que propone el modelo">
            Sugerencias
          </Interruptor>
          <Interruptor activo={!ocultarLibres} onCambiar={v => setOcultarLibres(!v)} titulo="Mostrar también los tanques sin nada agendado">
            Tanques libres
          </Interruptor>
        </div>
      </div>

      {/* ── Cobertura contra la necesidad ────────────────────────────────
          Sin esto el Gantt dice dónde va cada cocción pero no si alcanzan.
          Un encargado no necesita sumar litros a mano para saber que a
          noviembre todavía le faltan 4.000 L por agendar. */}
      {cobertura.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--p-line-2) bg-(--p-card) px-4 py-2.5 lg:px-6">
          <span className="text-[10px] font-bold uppercase tracking-wide text-(--p-text-3)">
            Agendado vs. necesidad
          </span>
          {cobertura.map(c => {
            const pct = c.necesidad > 0 ? Math.round((c.planificado / c.necesidad) * 100) : 100
            const falta = Math.max(0, c.necesidad - c.planificado)
            return (
              <div key={c.mes} className="flex items-center gap-1.5"
                title={`${fLitros(c.planificado)} L agendados de ${fLitros(c.necesidad)} L necesarios`}>
                <span className="text-[10.5px] font-bold uppercase text-(--p-text-3)">
                  {new Date(c.mes + 'T00:00:00Z').toLocaleDateString('es-CL', { month: 'short', timeZone: 'UTC' }).replace('.', '')}
                </span>
                <span className="h-1.5 w-14 overflow-hidden rounded-full bg-(--p-line)">
                  <span className="block h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      background: pct >= 100 ? '#22C55E' : pct >= 60 ? '#E5A922' : '#DC2626',
                    }} />
                </span>
                <span className={`text-[10.5px] font-bold tabular-nums ${
                  pct >= 100 ? 'text-(--p-accent)' : 'text-(--p-text-2)'
                }`}>{pct}%</span>
                {falta > 0 && (
                  <span className="text-[10.5px] tabular-nums text-(--p-text-3)">falta {fLitros(falta)} L</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Grilla ───────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={teclaGrilla}
        aria-label="Carta Gantt de fermentadores. Flechas izquierda y derecha: una semana."
        data-paneando={paneando ? '' : undefined}
        className="prod-gantt-grilla overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--p-accent)"
        data-autoscroll="x" data-autoscroll-izq={ANCHO_TANQUE}
      >
        <div style={{ minWidth: ANCHO_TANQUE + anchoGrilla }}>

          {/* Banda de meses */}
          <div className="flex border-b border-(--p-line-2) bg-(--p-card-2)/60">
            <div style={{ width: ANCHO_TANQUE, flexShrink: 0 }} className="sticky left-0 z-20 bg-(--p-card-2)/95 backdrop-blur" />
            {bandaMeses.map(m => (
              <div key={m.desde} style={{ width: m.cols * anchoDia, flexShrink: 0 }}
                className="border-l border-(--p-line) px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-(--p-text-2)">
                {m.cols * anchoDia > 70 ? m.label : ''}
              </div>
            ))}
          </div>

          {/* Días */}
          {cabeceraDias}

          {/* Filas por grupo */}
          {grupos.map(grupo => {
            const plegado = plegados.has(grupo.titulo)
            return (
              <div key={grupo.titulo}>
                {/* Cabecera del grupo: es a la vez el control de plegado y el
                    resumen. Va como <button> de ancho completo y no como un
                    ícono chico — el objetivo es abrir y cerrar rápido, no
                    apuntarle a una flecha de 12 px. */}
                {/* El botón ocupa el ancho de la grilla (más ancho que la
                    vista), así que no puede quedar pegado a la izquierda: lo
                    que se pega es su contenido, para que al desplazar la carta
                    se siga leyendo "Cervecería · 10 de 17…". */}
                <button
                  type="button"
                  onClick={() => alternarGrupo(grupo.titulo)}
                  className="prod-press flex w-full items-center border-b border-(--p-line) bg-(--p-chip)/80 py-1.5 text-left hover:bg-(--p-hover)"
                  style={{ width: ANCHO_TANQUE + anchoGrilla }}
                >
                  <span className="sticky left-0 flex items-center gap-2 px-3">
                  <ChevronRight size={13}
                    className={`shrink-0 text-(--p-text-3) transition-transform duration-200 ${plegado ? '' : 'rotate-90'}`} />
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-(--p-text-2)">
                    {grupo.titulo}
                  </span>

                  <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-(--p-text-3)">
                    {grupo.ocupados}/{grupo.tanques.length} con carga
                  </span>

                  {/* Barra de ocupación: es el dato que un encargado mira
                      primero, y es lo que hace que plegar no cueste nada. */}
                  <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-(--p-text-4)">
                    <span className="block h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.min(grupo.pct, 100)}%`,
                        background: grupo.pct >= 90 ? '#DC2626' : grupo.pct >= 70 ? '#C9A227' : '#D4AF37',
                      }} />
                  </span>
                  <span className="shrink-0 text-[10.5px] font-bold tabular-nums text-(--p-text-2)">
                    {grupo.pct}%
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-(--p-text-3)">
                    {fLitros(grupo.litros)} de {fLitros(grupo.capacidad)} L
                  </span>

                  {grupo.alertas > 0 && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-(--p-bad-soft) px-1.5 py-px text-[10px] font-bold text-(--p-bad)">
                      <AlertTriangle size={9} />{grupo.alertas}
                    </span>
                  )}
                  {plegado && grupo.libres > 0 && (
                    <span className="shrink-0 text-[10.5px] text-(--p-text-3)">
                      · {grupo.libres} {grupo.libres === 1 ? 'libre' : 'libres'}
                    </span>
                  )}
                  </span>
                </button>

                {/* Primero qué falta y para cuándo; después dónde meterlo.
                    Comparten el eje de tiempo, así que un producto cuya barra
                    muere antes del rombo de su lote se lee sin cruzar fechas. */}
                {!plegado && mostrarCobertura && grupo.cobertura.length > 0 && (
                  // Fundido corto al prenderlas: aparecen de golpe varias filas
                  // y la carta se corre; el fundido evita el salto (140 ms).
                  <div className="prod-enter">
                    <div className="sticky left-0 z-10 flex items-center gap-1.5 border-b border-(--p-line-2) bg-(--p-card)/90 px-3 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-(--p-text-3)"
                      style={{ width: ANCHO_TANQUE + anchoGrilla }}>
                      Hasta cuándo alcanza
                      {(() => {
                        // Dos problemas distintos, dos avisos distintos: uno se
                        // arregla moviendo una cocción que ya existe, el otro
                        // exige agendar una que no existe.
                        const cruzados = grupo.cobertura.filter(c => c.agota && c.rescate && c.diasEnCero > 0).length
                        const huerfanos = grupo.cobertura.filter(c => c.agota && !c.rescate).length
                        return (
                          <>
                            {cruzados > 0 && (
                              <span className="flex items-center gap-1 rounded-full bg-(--p-warn-soft) px-1.5 text-[9.5px] font-bold text-(--p-warn)"
                                title="El stock se acaba antes de que llegue el lote que venía a reponerlo. Se arregla adelantando esa cocción.">
                                <AlertTriangle size={8} />{cruzados} quiebre{cruzados === 1 ? '' : 's'} cruzado{cruzados === 1 ? '' : 's'}
                              </span>
                            )}
                            {huerfanos > 0 && (
                              <span className="flex items-center gap-1 rounded-full bg-(--p-bad-soft) px-1.5 text-[9.5px] font-bold text-(--p-bad)"
                                title="Se agotan y no hay ninguna cocción agendada después.">
                                <AlertTriangle size={8} />{huerfanos} sin lote
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </div>
                    {grupo.cobertura.map((c, i) => (
                      <FilaCobertura
                        key={c.producto} cobertura={c} dias={dias} anchoDia={anchoDia}
                        /* Las filas de cobertura llevan dos líneas (nombre, y
                           velocidad + DOI debajo), así que no pueden usar el
                           alto de una fila de tanque: en compacto son 26 px y
                           la segunda línea quedaba cortada. */
                        altoFila={Math.max(altoFila, 34)} tamEtiqueta={tamEtiqueta} hoy={hoy}
                        color={colorPorProducto.get(c.producto) ?? '#8C8C8C'} fila={i}
                        anchoEtiqueta={ANCHO_TANQUE}
                      />
                    ))}
                    <div className="sticky left-0 z-10 border-b border-(--p-line-2) bg-(--p-card)/90 px-3 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-(--p-text-3)"
                      style={{ width: ANCHO_TANQUE + anchoGrilla }}>
                      Tanques
                    </div>
                  </div>
                )}

                {!plegado && grupo.visibles.map((t, i) => (
                  <FilaTanque
                    key={t.nombre} tanque={t} bloques={porTanque.get(t.nombre) ?? SIN_BLOQUES} dias={dias}
                    anchoDia={anchoDia} altoFila={altoFila} tamEtiqueta={tamEtiqueta}
                    inicioVentana={inicioVentana} hoy={hoy}
                    colorPorProducto={colorPorProducto} solapes={solapes}
                    destinoActivo={destinoActivo?.fermentador === t.nombre ? destinoActivo : null} propsOrigen={propsOrigen}
                    cargaDe={cargaDe} onAbrirBloque={onAbrirBloque} onQuitarBloque={onQuitarBloque}
                    fila={i} recienMovido={bloqueRecienMovido} sentido={sentido}
                    cargaArrastrada={cargaParaFila(t.nombre, porTanque.get(t.nombre))}
                  />
                ))}

                {/* Los libres escondidos se anuncian, no desaparecen: si no,
                    alguien buscaría un tanque que existe y no está en pantalla. */}
                {!plegado && ocultarLibres && grupo.libres > 0 && (
                  <button type="button" onClick={() => setOcultarLibres(false)}
                    className="sticky left-0 z-10 flex w-full items-center gap-1.5 border-b border-(--p-line-2) bg-(--p-card) px-3 py-1 text-left text-[10.5px] text-(--p-text-3) hover:bg-(--p-hover) hover:text-(--p-text-2)"
                    style={{ width: ANCHO_TANQUE + anchoGrilla }}>
                    <Eye size={11} />
                    {grupo.libres} {grupo.libres === 1 ? 'tanque libre' : 'tanques libres'} — mostrar
                  </button>
                )}
              </div>
            )
          })}

          {/* Sin tanque asignado — no se esconden: si un lote quedó suelto hay
              que verlo, porque es trabajo que nadie agendó en ningún tanque. */}
          {sinAsignar.length > 0 && (
            <div>
              <div className="flex border-b border-t border-(--p-warn-line) bg-(--p-warn-soft)">
                <div style={{ width: ANCHO_TANQUE, flexShrink: 0 }}
                  className="sticky left-0 z-20 bg-(--p-warn-soft) px-3 py-1 text-[10px] font-black uppercase tracking-wider text-(--p-warn)">
                  Sin tanque asignado
                </div>
                <div style={{ width: anchoGrilla, flexShrink: 0 }} className="bg-(--p-warn-soft)" />
              </div>
              <FilaTanque
                tanque={{ nombre: '— sin asignar —', tipo: '', categoria: 'cerveza', capacidadLitros: 0, litrosActuales: 0 }}
                bloques={sinAsignar} dias={dias} anchoDia={anchoDia}
                altoFila={altoFila} tamEtiqueta={tamEtiqueta} inicioVentana={inicioVentana}
                hoy={hoy} colorPorProducto={colorPorProducto} solapes={solapes}
                destinoActivo={destinoActivo && destinoActivo.fermentador == null ? destinoActivo : null} propsOrigen={propsOrigen} cargaDe={cargaDe}
                onAbrirBloque={onAbrirBloque} onQuitarBloque={onQuitarBloque} fila={0} recienMovido={bloqueRecienMovido}
                sentido={sentido} cargaArrastrada={cargaParaFila(null, sinAsignar)} sinCapacidad
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--p-line-2) bg-(--p-card-2)/60 px-4 py-1.5 text-[10.5px] text-(--p-text-3) lg:px-6">
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm prod-primario" /> en el plan</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm border border-dashed border-(--p-accent-line) bg-(--p-accent-soft)" /> sugerida</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-(--p-text-4)" /> finde</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#C9A227]" /> tanque con producto hoy</span>
        <span className="ml-auto">Arrastra un bloque para moverlo · arrastra el fondo para recorrer la carta · Ctrl + rueda: zoom · ← →: una semana · Supr quita el bloque seleccionado.</span>
      </div>
    </div>
  )
}

/* ── Una fila = un tanque ─────────────────────────────────────────────── */

/** Arreglo vacío estable: `?? []` crearía uno nuevo en cada render y
 *  rompería la memorización de las filas sin bloques. */
const SIN_BLOQUES: BloqueGantt[] = []

/** Fila memorizada: durante un arrastre sólo se redibujan las filas cuyo
 *  destino cambió (la que el puntero dejó y a la que llegó), no las 20. */
const FilaTanque = memo(function FilaTanque({
  tanque, bloques, dias, anchoDia, altoFila, tamEtiqueta, inicioVentana, hoy, colorPorProducto,
  solapes, destinoActivo, propsOrigen, cargaDe, onAbrirBloque, onQuitarBloque, sinCapacidad,
  fila, recienMovido, sentido, cargaArrastrada,
}: {
  tanque: FermentadorGantt
  bloques: BloqueGantt[]
  dias: { iso: string; finde: boolean; esHoy: boolean }[]
  anchoDia: number
  altoFila: number
  tamEtiqueta: number
  inicioVentana: string
  hoy: string
  colorPorProducto: Map<string, string>
  solapes: Set<string>
  destinoActivo: DestinoArrastre | null
  propsOrigen: (carga: CargaArrastre, habilitado?: boolean) => Record<string, unknown>
  cargaDe: (b: BloqueGantt) => CargaArrastre
  onAbrirBloque?: (b: BloqueGantt, rect?: DOMRect) => void
  onQuitarBloque?: (b: BloqueGantt) => void
  sinCapacidad?: boolean
  /** Índice dentro del grupo, para escalonar la entrada. */
  fila: number
  recienMovido: string | null
  sentido: 'izq' | 'der' | null
  cargaArrastrada: CargaArrastre | null
}) {
  // La fila entera se resalta mientras el puntero arrastra sobre ella: con
  // 23 filas de 44px, acertarle al tanque correcto sin esa guía es difícil.
  const filaActiva = !sinCapacidad && destinoActivo?.fermentador === tanque.nombre

  // Contorno de dónde va a caer el bloque, con su largo real. En rojo si
  // pisa otra cocción de este tanque o si el tanque es chico para el lote.
  const contorno = (() => {
    if (!destinoActivo || !cargaArrastrada) return null
    const largo = cargaArrastrada.dias ?? 1
    const desdeIdx = diffDias(inicioVentana, destinoActivo.fecha)
    if (desdeIdx < 0 || desdeIdx >= dias.length) return null
    const finDestino = sumarDias(destinoActivo.fecha, largo)
    const choca = bloques.some(b => b.id !== cargaArrastrada.idBloque && b.tipo !== 'sugerido'
      && b.inicioISO < finDestino && sumarDias(b.inicioISO, b.dias) > destinoActivo.fecha)
    const noCabe = !sinCapacidad && tanque.capacidadLitros > 0 && cargaArrastrada.litros > tanque.capacidadLitros
    return { desdeIdx, ancho: Math.min(largo, dias.length - desdeIdx) * anchoDia, malo: choca || noCabe, choca, noCabe }
  })()

  return (
    <div
      style={{ ['--fila' as string]: fila }}
      className={`prod-gantt-fila flex border-b border-(--p-line-2) last:border-b-0 ${
        filaActiva ? 'bg-(--p-accent-soft)' : 'hover:bg-(--p-hover)'
      }`}
    >
      {/* Nombre del tanque */}
      <div style={{ width: ANCHO_TANQUE, flexShrink: 0, height: altoFila }}
        className="sticky left-0 z-10 flex items-center gap-1.5 border-r border-(--p-line-2) bg-(--p-card) px-3"
        title={!sinCapacidad && tanque.litrosActuales > 0
          ? `${tanque.nombre} · ${tanque.capacidadLitros.toLocaleString('es-CL')} L · ${tanque.litrosActuales.toLocaleString('es-CL')} L ocupados hoy`
          : tanque.nombre}>
        {/* Punto lleno = el ERP dice que HOY tiene producto adentro. Es el
            dato que antes ocupaba una segunda línea de texto entera. */}
        {!sinCapacidad && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tanque.litrosActuales > 0 ? 'bg-[#C9A227]' : 'bg-(--p-line)'}`} />
        )}
        <span className="truncate font-bold text-(--p-text)" style={{ fontSize: tamEtiqueta + 1 }}>
          {tanque.nombre.replace(/^Fermentador /, 'F. ').replace(/^Lavoratorio /, 'Lab. ')}
        </span>
        {!sinCapacidad && (
          <span className="ml-auto shrink-0 tabular-nums text-(--p-text-3)" style={{ fontSize: tamEtiqueta - 1 }}>
            {fLitros(tanque.capacidadLitros)}
          </span>
        )}
      </div>

      {/* Pista de días + bloques encima */}
      <div
        key={inicioVentana}
        className={`relative ${sentido === 'der' ? 'prod-gantt-ventana-der' : sentido === 'izq' ? 'prod-gantt-ventana-izq' : ''}`}
        style={{ width: dias.length * anchoDia, flexShrink: 0, height: altoFila }}
      >
        <div className="absolute inset-0 flex">
          {dias.map(d => {
            return (
              <div
                key={d.iso}
                data-dia-calendario={d.iso}
                data-fermentador={sinCapacidad ? undefined : tanque.nombre}
                style={{ width: anchoDia, flexShrink: 0 }}
                className={`border-l ${
                  d.esHoy ? 'border-[#C9A227] bg-[#C9A227]/10'
                  : d.finde ? 'border-(--p-line) bg-(--p-line)/70'
                  : 'border-(--p-line-2)'
                }`}
              />
            )
          })}
        </div>

        {contorno && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-md border-2 border-dashed"
            style={{
              left: contorno.desdeIdx * anchoDia + 1, width: Math.max(contorno.ancho - 2, 8), top: 2, height: 'calc(100% - 4px)',
              borderColor: contorno.malo ? '#EF4444' : '#D4AF37',
              background: contorno.malo ? 'rgba(239,68,68,0.12)' : 'rgba(212,175,55,0.14)',
            }}
          >
            {contorno.malo && contorno.ancho > 70 && (
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9.5px] font-bold text-[#EF4444]">
                {contorno.noCabe ? 'No cabe en este tanque' : 'Se pisa con otra cocción'}
              </span>
            )}
          </div>
        )}

        {bloques.map(b => {
          const desdeIdx = Math.max(0, diffDias(inicioVentana, b.inicioISO))
          const recorteIzq = Math.max(0, diffDias(b.inicioISO, inicioVentana))
          const visibles = Math.min(b.dias - recorteIzq, dias.length - desdeIdx)
          if (visibles <= 0) return null

          const color = colorPorProducto.get(b.producto) ?? '#8C8C8C'
          const choca = solapes.has(b.id)
          const noCabe = !sinCapacidad && tanque.capacidadLitros > 0 && b.litros > tanque.capacidadLitros
          const ancho = visibles * anchoDia
          // Por id: antes se comparaba por producto y se apagaban TODOS los
          // lotes del mismo producto mientras se arrastraba uno solo.
          const arrastrandoEste = cargaArrastrada?.idBloque === b.id

          return (
            <BloqueCoccion
              key={b.id}
              bloque={b} color={color} choca={choca} noCabe={noCabe}
              capacidadTanque={tanque.capacidadLitros}
              desdeIdx={desdeIdx} anchoDia={anchoDia} ancho={ancho}
              propsOrigen={propsOrigen} cargaDe={cargaDe} hoy={hoy}
              onAbrirBloque={onAbrirBloque} onQuitarBloque={onQuitarBloque}
              recienMovido={recienMovido === b.id} arrastrandoEste={arrastrandoEste}
              dosLineas={altoFila >= 44}
            />
          )
        })}
      </div>
    </div>
  )
})

/* ── Un bloque de cocción dentro de una fila ─────────────────────────────
 *
 * Vive separado de FilaTanque porque necesita estado propio: el botón de
 * "quitar" es de dos pasos (armar, después confirmar) para que un clic
 * accidental no borre un lote del plan, y ese estado tiene que resetearse
 * solo si el mouse se va del bloque. Meterlo en el .map() de FilaTanque
 * habría significado un hook por iteración sin un componente que lo sostenga,
 * que React no permite. */
const BloqueCoccion = memo(function BloqueCoccion({
  bloque: b, color, choca, noCabe, capacidadTanque, desdeIdx, anchoDia, ancho,
  propsOrigen, cargaDe, hoy, onAbrirBloque, onQuitarBloque, recienMovido, arrastrandoEste, dosLineas = false,
}: {
  bloque: BloqueGantt
  color: string
  choca: boolean
  noCabe: boolean
  capacidadTanque: number
  desdeIdx: number
  anchoDia: number
  ancho: number
  propsOrigen: (carga: CargaArrastre, habilitado?: boolean) => Record<string, unknown>
  cargaDe: (b: BloqueGantt) => CargaArrastre
  hoy: string
  onAbrirBloque?: (b: BloqueGantt, rect?: DOMRect) => void
  onQuitarBloque?: (b: BloqueGantt) => void
  recienMovido: boolean
  arrastrandoEste: boolean
  /** Zoom amplio: producto arriba, litros y fecha de listo abajo. */
  dosLineas?: boolean
}) {
  const sugerido = b.tipo === 'sugerido'
  // En un bloque angosto "Kombucha " se come el nombre: la fila ya dice que es
  // un tanque de kombucha.
  const nombre = ancho < 150 ? b.producto.replace(/^Kombucha /, '') : b.producto
  const listo = sumarDias(b.inicioISO, b.dias)
  // Detectado en el ERP, sin lote del plan detrás: no hay id que editar, así
  // que no se arrastra y no hay nada que "quitar" — la única acción posible
  // sería trackearlo como lote de verdad, que no es lo que este botón hace.
  const enTanqueErp = b.tipo === 'en_tanque'
  // Quitar es un solo clic (o Supr con el bloque enfocado): el aviso con
  // "Deshacer" reemplaza al viejo doble clic de confirmación.
  const puedeQuitar = b.tipo === 'confirmado' && !!onQuitarBloque

  return (
    <button
      type="button"
      {...propsOrigen(cargaDe(b), !enTanqueErp && (b.inicioISO >= hoy || b.tipo === 'sugerido'))}
      onClick={e => onAbrirBloque?.(b, e.currentTarget.getBoundingClientRect())}
      onKeyDown={e => {
        if (puedeQuitar && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onQuitarBloque?.(b) }
      }}
      aria-label={`${b.producto}, ${b.litros.toLocaleString('es-CL')} litros desde ${b.inicioISO}${puedeQuitar ? '. Supr para quitar del plan' : ''}`}
      title={`${b.producto} · ${b.litros.toLocaleString('es-CL')} L · ${b.dias} días desde ${b.inicioISO}` +
        (noCabe ? `\n⚠ No cabe: el tanque es de ${capacidadTanque.toLocaleString('es-CL')} L` : '') +
        (choca ? '\n⚠ Se pisa con otra cocción en este mismo tanque' : '') +
        (b.motivo ? `\n${b.motivo}` : '')}
      style={{
        position: 'absolute',
        left: desdeIdx * anchoDia + 1,
        width: Math.max(ancho - 2, 8),
        top: 3,
        height: 'calc(100% - 6px)',
        // Los sugeridos van translúcidos para distinguirse de lo confirmado,
        // pero a 18% el texto no se leía. 38% sobre blanco deja el color
        // reconocible y el texto legible; el borde va al color pleno para
        // que el punteado se vea. Lo detectado en el ERP lleva un rayado
        // diagonal sobre el color pleno — ni "confirmado por la app" (sólido)
        // ni "propuesta del modelo" (punteado): es un HECHO que la app no
        // registró, el tercer estado necesita su propia textura.
        background: sugerido
          ? `${color}61`
          : enTanqueErp
            ? `repeating-linear-gradient(45deg, ${color} 0 6px, ${color}CC 6px 12px)`
            : color,
        borderColor: choca || noCabe ? '#DC2626' : color,
        borderStyle: sugerido ? 'dashed' : 'solid',
        borderWidth: choca || noCabe ? 2 : 1,
        color: sugerido ? '#1f2937' : textoSobre(color),
        // 'pointer' y no 'default': ya no es de sólo lectura — un clic abre
        // el editor de fechas (ver onAbrirBloque en ProduccionClient).
        cursor: enTanqueErp ? 'pointer' : undefined,
        touchAction: 'none',
      }}
      className={[
        'prod-press prod-gantt-bloque group/bloque relative flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-left text-[10px] font-bold leading-none shadow-sm',
        // Un plan imposible late hasta que alguien lo arregle.
        (choca || noCabe) ? 'prod-gantt-alerta' : '',
        // Acaba de cambiar de día o de tanque: un latido y listo.
        recienMovido ? 'prod-gantt-aterriza' : '',
        // Mientras se arrastra, el bloque de origen se apaga: el que
        // manda es el ghost que sigue al puntero.
        arrastrandoEste ? 'prod-gantt-bloque-fantasma' : '',
      ].filter(Boolean).join(' ')}
    >
      {(choca || noCabe) && <AlertTriangle size={10} className="shrink-0 text-(--p-bad)" />}
      {enTanqueErp && <Beaker size={9} className="shrink-0 opacity-80" />}
      {dosLineas && ancho > 60 ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[12px] leading-tight">{nombre}</span>
          <span className="truncate text-[10.5px] font-semibold leading-tight opacity-80">
            {b.litros.toLocaleString('es-CL')} L{ancho > 120 ? ` · listo ${isoADate(listo).getUTCDate()}/${isoADate(listo).getUTCMonth() + 1}` : ''}
          </span>
        </span>
      ) : (
        <span className="truncate">
          {nombre}
          {ancho > 90 && ` · ${b.litros.toLocaleString('es-CL')} L`}
        </span>
      )}

      {/* Quitar de la programación — sólo para lotes YA confirmados: un
          sugerido no está en el plan y uno detectado en el ERP no tiene un
          lote detrás, así que en ninguno de los dos hay nada que sacar de
          ahí. Se ve al pasar el mouse para no ensuciar la lectura normal de
          la carta, y exige un segundo clic para de verdad quitarlo. */}
      {puedeQuitar && ancho > 30 && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Quitar ${b.producto} del plan`}
          // El bloque escucha pointerdown para arrancar el arrastre: sin cortar
          // la propagación, apretar la X armaría un arrastre en vez de quitar.
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onQuitarBloque?.(b) }}
          title="Quitar de la programación (se puede deshacer)"
          className="prod-gantt-quitar absolute right-0.5 top-1/2 flex h-5 w-5 shrink-0 -translate-y-1/2 items-center justify-center rounded bg-black/30 text-white hover:bg-red-600"
        >
          <X size={11} strokeWidth={3} />
        </span>
      )}
    </button>
  )
})

/* ── Controles de la cabecera ─────────────────────────────────────────── */

/** Selector de opción única en una píldora (línea, zoom). */
function Segmento<T extends string>({ etiqueta, valor, onCambiar, opciones }: {
  etiqueta: string; valor: T; onCambiar: (v: T) => void; opciones: readonly (readonly [T, string])[]
}) {
  return (
    <div role="group" aria-label={etiqueta} className="flex items-center gap-0.5 rounded-lg border border-(--p-line) p-0.5">
      {opciones.map(([v, texto]) => (
        <button key={v} type="button" onClick={() => onCambiar(v)} aria-pressed={valor === v}
          className={`prod-press rounded-md px-2.5 py-1 text-[12px] font-bold ${valor === v ? 'bg-(--p-accent-soft) text-(--p-accent)' : 'text-(--p-text-3) hover:bg-(--p-hover) hover:text-(--p-text)'}`}>
          {texto}
        </button>
      ))}
    </div>
  )
}

/** Mostrar u ocultar una capa de la carta: interruptor con su punto de estado. */
function Interruptor({ activo, onCambiar, titulo, children }: { activo: boolean; onCambiar: (v: boolean) => void; titulo: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => onCambiar(!activo)} aria-pressed={activo} title={titulo}
      className={`prod-press flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold ${activo ? 'border-(--p-accent-line) bg-(--p-accent-soft) text-(--p-accent)' : 'border-(--p-line) text-(--p-text-3) hover:bg-(--p-hover) hover:text-(--p-text)'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${activo ? 'bg-(--p-accent)' : 'bg-(--p-text-4)'}`} />
      {children}
    </button>
  )
}
