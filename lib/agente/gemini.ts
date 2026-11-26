import { CONSULTAS, ejecutarConsulta } from './consultas'
import type { ContextoConsulta } from './consultas/_base'
import { PARAMETROS, construirSystemPrompt } from './sistema'
import { HERRAMIENTAS_VENDEDOR } from './alcance'

export interface MensajeChat {
  rol: 'usuario' | 'agente'
  texto: string
}

export interface HerramientaUsada {
  nombre: string
  args: Record<string, unknown>
  ok: boolean
}

export interface UsoTokens {
  entrada: number
  salida: number
  /** Parte de la entrada que Gemini reutilizó de su caché implícita (se factura más barato). */
  cacheados: number
  rondas: number
  modelo: string | null
}

export interface RespuestaAgente {
  respuesta: string
  herramientas: HerramientaUsada[]
  uso: UsoTokens
}

export class ErrorAgente extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const errorTiempo = () =>
  new ErrorAgente('El asistente tardó demasiado en responder. Intenta de nuevo o acota la pregunta (una zona, un vendedor o menos días).', 504)

const esTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')

interface ParteGemini {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  [k: string]: unknown
}
interface ContenidoGemini { role: 'user' | 'model'; parts: ParteGemini[] }

interface MetaUso { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }
type RespuestaGemini = {
  candidates?: { content?: ContenidoGemini; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: MetaUso
}

const MAX_CHARS_RESULTADO = 20_000

/** Declaraciones de herramientas: idénticas en cada llamada (parte del prefijo que Gemini puede cachear). En modo vendedor, sólo las de su cartera. */
function declaraciones(modoVendedor: boolean) {
  return CONSULTAS.filter(c => !modoVendedor || HERRAMIENTAS_VENDEDOR.has(c.nombre)).map(c => {
    const requeridos = c.parametros.filter(p => p.requerido).map(p => p.nombre)
    return {
      name: c.nombre,
      description: c.descripcion,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(c.parametros.map(p => [p.nombre, {
          type: p.tipo === 'integer' ? 'INTEGER' : 'STRING',
          description: p.descripcion,
          ...(p.enum ? { enum: p.enum } : {}),
        }])),
        // Gemini rechaza `required: []`: se omite cuando todos son opcionales.
        ...(requeridos.length ? { required: requeridos } : {}),
      },
    }
  })
}

/** Modelos que Google rechazó para esta clave (404/403) en este proceso: no se vuelven a probar. */
const noDisponibles = new Set<string>()

const dormir = (ms: number, signal?: AbortSignal) => new Promise<void>(r => {
  if (signal?.aborted) return r()
  const t = setTimeout(r, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
})

/**
 * Llama a Gemini con dos "carriles" en paralelo y se queda con la primera
 * respuesta buena (Claudio, 2026-11-26: "nunca funciona").
 *
 * Lo que pasaba: Flash-Lite (rápido, 3-20 s) respondía 503 "high demand" por
 * unos segundos, se pasaba a 3.8 Flash, que se colgaba 45 s, y como hubo un
 * timeout no se volvía a intentar Flash-Lite: error tras ~50 s sin respuesta.
 *
 * Ahora:
 *  · Carril principal: el primer modelo (Flash-Lite) se reintenta con esperas
 *    cortas (1,5 s, 3 s, 5 s, 8 s…) mientras quede presupuesto: sus 503 duran poco.
 *  · Carril de respaldo: los demás modelos parten cuando el principal falla
 *    por primera vez o tarda más de PARAMETROS.arranqueRespaldoMs, y también reintentan.
 *  · Gana el primero que responda bien; las demás llamadas se cancelan.
 */
async function llamarGemini(
  apiKey: string, system: string, contents: ContenidoGemini[],
  opciones: { herramientas: boolean; maxTokens: number; modoVendedor?: boolean; limite?: number }
): Promise<{ data: RespuestaGemini; modelo: string }> {
  const limite = opciones.limite ?? Date.now() + 60_000
  const disponibles = PARAMETROS.modelos.filter(m => !noDisponibles.has(m))
  const [principal, ...respaldos] = disponibles.length ? disponibles : PARAMETROS.modelos

  const pedir = (modelo: string, nivelRazonamiento: boolean, signal: AbortSignal) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        ...(opciones.herramientas ? { tools: [{ functionDeclarations: declaraciones(!!opciones.modoVendedor) }] } : {}),
        generationConfig: {
          temperature: PARAMETROS.temperatura,
          maxOutputTokens: opciones.maxTokens,
          // Serie 2.5: el razonamiento se apaga con thinkingBudget. Serie 3.x: no se puede apagar,
          // sólo bajar a "low" (menos latencia y menos cuota). Si Google rechaza el campo se reintenta sin él.
          ...(/gemini-2\.5/i.test(modelo) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...(nivelRazonamiento && /gemini-3/i.test(modelo) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
    }
  )

  // Se cancela al haber ganador (o error fatal): corta llamadas y esperas pendientes.
  const fin = new AbortController()
  // Estados de cada intento fallido (504 = no respondió a tiempo), para elegir el mensaje final.
  const estados: number[] = []
  let fatal: ErrorAgente | null = null
  let ganador: { data: RespuestaGemini; modelo: string } | null = null

  /** Un intento contra un modelo. true = ganó; false = falló de forma reintentable. */
  async function intentar(modelo: string): Promise<boolean> {
    const t0 = Date.now()
    const restante = Math.min(PARAMETROS.timeoutLlamadaMs, limite - t0)
    if (restante < 3000 || fin.signal.aborted) return false
    // Un solo timeout cubre el reintento sin thinkingLevel y la lectura del cuerpo.
    const signal = AbortSignal.any([fin.signal, AbortSignal.timeout(restante)])
    let res: Response
    try {
      res = await pedir(modelo, true, signal)
      if (res.status === 400 && /gemini-3/i.test(modelo)) {
        console.error(`[agente] ${modelo} rechazó thinkingLevel (400): se reintenta sin él`, (await res.text().catch(() => '')).slice(0, 300))
        res = await pedir(modelo, false, signal)
      }
      if (res.ok) {
        const data = await res.json() as RespuestaGemini
        if (fin.signal.aborted) return false
        ganador = { data, modelo }
        console.info(`[agente] ${modelo} respondió en ${Date.now() - t0} ms`)
        fin.abort()
        return true
      }
    } catch (e) {
      if (fin.signal.aborted) return false
      if (!esTimeout(e)) { fatal ??= e instanceof ErrorAgente ? e : new ErrorAgente('El servicio de IA no respondió. Intenta de nuevo.', 502); fin.abort(); return false }
      console.error(`[agente] ${modelo} no respondió en ${Date.now() - t0} ms`)
      estados.push(504)
      return false
    }
    estados.push(res.status)
    const detalle = await res.text().catch(() => '')
    console.error(`[agente] Gemini ${modelo} respondió ${res.status} tras ${Date.now() - t0} ms`, detalle.slice(0, 200))
    // Modelo no disponible para la clave: no se insiste con él en este proceso.
    if (res.status === 404 || res.status === 403) { noDisponibles.add(modelo); return false }
    // Cuota agotada de ESE modelo (429) o saturación (5xx): reintentable.
    if ([429, 500, 502, 503].includes(res.status)) return false
    fatal ??= new ErrorAgente('Gemini rechazó la solicitud. Revisa los registros del servidor.', 502)
    fin.abort()
    return false
  }

  const quedaTiempo = () => !fin.signal.aborted && limite - Date.now() >= 3000
  let avisarFallaPrincipal: () => void = () => {}
  const fallaPrincipal = new Promise<void>(r => { avisarFallaPrincipal = r })

  async function carrilPrincipal() {
    const esperas = [1500, 3000, 5000, 8000]
    for (let i = 0; quedaTiempo(); i++) {
      if (await intentar(principal)) return
      avisarFallaPrincipal()
      if (noDisponibles.has(principal)) return
      await dormir(esperas[Math.min(i, esperas.length - 1)], fin.signal)
    }
  }

  async function carrilRespaldo() {
    await Promise.race([fallaPrincipal, dormir(PARAMETROS.arranqueRespaldoMs, fin.signal)])
    // Primero una llamada NUEVA al principal (si la primera quedó colgada en Google,
    // otra suele volver en segundos) y después los otros modelos, que tienden a colgarse.
    const turnos = [principal, ...respaldos]
    while (quedaTiempo()) {
      for (const modelo of turnos) {
        if (!quedaTiempo()) return
        if (noDisponibles.has(modelo)) continue
        if (await intentar(modelo)) return
      }
      if (turnos.every(m => noDisponibles.has(m))) return
      await dormir(3000, fin.signal)
    }
  }

  await Promise.all([carrilPrincipal(), carrilRespaldo()])
  if (ganador) return ganador
  if (fatal) throw fatal

  // El mensaje sigue la causa más útil para el usuario, no la del último modelo probado.
  if (estados.some(e => e >= 500 && e !== 504)) throw new ErrorAgente('Gemini (Google) está saturado en este momento. Intenta de nuevo en un minuto.', 503)
  if (estados.length === 0 || estados.includes(504)) throw errorTiempo()
  if (estados.includes(429)) throw new ErrorAgente('Se agotó la cuota gratuita de Gemini por ahora. Intenta de nuevo en un minuto.', 429)
  if (estados.includes(403)) throw new ErrorAgente('Gemini no aceptó la clave. Revisa que GEMINI_API_KEY sea válida y esté habilitada.', 502)
  if (estados.every(e => e === 404)) throw new ErrorAgente('Ninguno de los modelos de Gemini configurados está disponible para esta clave (ver lib/agente/sistema.ts).', 502)
  throw new ErrorAgente('El servicio de IA no respondió. Intenta de nuevo.', 502)
}

/** Une mensajes seguidos del mismo rol y descarta un arranque de 'agente': Gemini espera turnos alternados que empiecen por el usuario. */
function normalizar(mensajes: MensajeChat[]): ContenidoGemini[] {
  const salida: ContenidoGemini[] = []
  for (const m of mensajes) {
    const role = m.rol === 'usuario' ? 'user' : 'model'
    if (salida.length === 0 && role === 'model') continue
    const ultimo = salida[salida.length - 1]
    if (ultimo && ultimo.role === role) ultimo.parts[0].text = `${ultimo.parts[0].text}\n${m.texto}`
    else salida.push({ role, parts: [{ text: m.texto }] })
  }
  return salida
}

function sumarUso(acc: UsoTokens, meta: MetaUso | undefined, modelo: string) {
  acc.entrada += meta?.promptTokenCount ?? 0
  acc.cacheados += meta?.cachedContentTokenCount ?? 0
  // El razonamiento se factura como salida aunque no se vea en la respuesta.
  acc.salida += (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0)
  acc.modelo = modelo
}

export async function responderPregunta(opts: {
  /** Mensajes recientes ya guardados (sin incluir la pregunta actual). */
  historial: MensajeChat[]
  pregunta: string
  /** Fecha, usuario, memoria y resumen: ver construirContexto(). Va como primer mensaje, no en el system prompt. */
  contexto: string
  apiKey: string
  ctx: ContextoConsulta
  /** Hora (epoch ms) en que hay que dejar de intentar: ver PARAMETROS.presupuestoMs. */
  limite: number
}): Promise<RespuestaAgente> {
  const system = construirSystemPrompt()
  const contents: ContenidoGemini[] = [
    { role: 'user', parts: [{ text: opts.contexto }] },
    { role: 'model', parts: [{ text: 'Contexto recibido.' }] },
    ...normalizar([...opts.historial, { rol: 'usuario', texto: opts.pregunta }]),
  ]

  const herramientas: HerramientaUsada[] = []
  const uso: UsoTokens = { entrada: 0, salida: 0, cacheados: 0, rondas: 0, modelo: null }
  const devolver = (respuesta: string): RespuestaAgente => ({ respuesta, herramientas, uso })

  for (let ronda = 0; ronda <= PARAMETROS.maxRondasHerramientas; ronda++) {
    if (opts.limite - Date.now() < 3000) throw errorTiempo()
    const { data, modelo } = await llamarGemini(opts.apiKey, system, contents, {
      herramientas: true, maxTokens: PARAMETROS.maxTokensRespuesta, modoVendedor: !!opts.ctx.alcance, limite: opts.limite,
    })
    sumarUso(uso, data.usageMetadata, modelo)
    uso.rondas = ronda + 1

    const candidato = data.candidates?.[0]
    if (!candidato?.content) {
      const motivo = data.promptFeedback?.blockReason
      return devolver(motivo ? 'No puedo responder esa consulta.' : 'No obtuve respuesta del modelo. Intenta reformular la pregunta.')
    }

    const llamadas = candidato.content.parts.filter(p => p.functionCall)
    if (llamadas.length === 0) {
      const texto = candidato.content.parts.map(p => p.text ?? '').join('').trim()
      return devolver(texto || 'No obtuve respuesta del modelo. Intenta reformular la pregunta.')
    }
    if (ronda === PARAMETROS.maxRondasHerramientas) {
      return devolver('La consulta requiere demasiados pasos. Intenta una pregunta más específica.')
    }

    // Se reenvía el turno del modelo tal cual vino (Gemini adjunta firmas de
    // razonamiento que hay que devolver intactas junto a la llamada).
    contents.push(candidato.content)
    const respuestas: ParteGemini[] = []
    for (const parte of llamadas) {
      const { name, args = {} } = parte.functionCall!
      const r = await ejecutarConsulta(name, args, opts.ctx)
      herramientas.push({ nombre: name, args, ok: r.ok })
      let cuerpo = JSON.stringify(r.ok ? r.datos : { error: r.error })
      if (cuerpo.length > MAX_CHARS_RESULTADO) {
        cuerpo = JSON.stringify({ advertencia: 'Resultado demasiado grande, se recortó.', parcial: cuerpo.slice(0, MAX_CHARS_RESULTADO) })
      }
      respuestas.push({ functionResponse: { name, response: { resultado: JSON.parse(cuerpo) } } })
    }
    contents.push({ role: 'user', parts: respuestas })
  }

  return devolver('No pude completar la consulta.')
}

/** Genera texto sin herramientas (usado para resumir conversaciones). */
export async function generarTexto(apiKey: string, instruccion: string, contenido: string): Promise<{ texto: string; uso: UsoTokens }> {
  const uso: UsoTokens = { entrada: 0, salida: 0, cacheados: 0, rondas: 1, modelo: null }
  const { data, modelo } = await llamarGemini(
    apiKey, instruccion, [{ role: 'user', parts: [{ text: contenido }] }], { herramientas: false, maxTokens: 2048 }
  )
  sumarUso(uso, data.usageMetadata, modelo)
  const texto = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
  return { texto, uso }
}
