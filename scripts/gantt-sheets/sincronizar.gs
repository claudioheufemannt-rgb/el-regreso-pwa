/**
 * Gantt Produccion (Google Sheets) → El Regreso PWA
 * ==================================================
 * Lee las barras de la hoja "Diagrama de Gantt" y las manda a la app
 * (POST /api/produccion/gantt-sheets). Manda el Sheets: lo que se mueve o
 * borra acá se mueve o borra en la app. Reglas en lib/produccion/ganttSheets.ts.
 *
 * Instalación (una sola vez):
 *  1. En la planilla: Extensiones → Apps Script → pegar este archivo.
 *  2. Configuración del proyecto (engranaje) → Propiedades de la secuencia
 *     de comandos → agregar:
 *       GANTT_SECRET = valor de UPLOAD_SECRET_GANTT en Vercel
 *       GANTT_URL    = https://el-regreso-pwa-psi.vercel.app/api/produccion/gantt-sheets
 *  3. Ejecutar la función instalarDisparadores y aceptar los permisos.
 *
 * Desde ahí sincroniza sola al editar la planilla y cada hora. También queda
 * el menú "Gantt → Sincronizar con la app" para forzarlo.
 *
 * Cómo lee la hoja:
 *  - Tanques: filas cuya columna C empieza con Fermentador / Bright / Lavoratorio.
 *    El nombre es lo que va antes del paréntesis ("Fermentador K-1").
 *  - Fechas: la columna donde empieza el primer mes (fila 6) es el día 1 de
 *    ese mes; cada columna siguiente es un día más. Se verifica contra los
 *    números de día de la fila 7 — si no calzan (alguien insertó una columna)
 *    no se manda nada y se avisa.
 *  - Barras: rangos combinados en las filas de tanque, con su texto.
 */

const HOJA = 'Diagrama de Gantt'
const FILA_MESES = 6
const FILA_DIAS = 7
const ANIO_PRIMER_MES = 2026
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
  'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Gantt')
    .addItem('Sincronizar con la app', 'sincronizarConAviso')
    .addToUi()
}

function instalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t))
  const ss = SpreadsheetApp.getActive()
  ScriptApp.newTrigger('sincronizarPorCambio').forSpreadsheet(ss).onEdit().create()
  ScriptApp.newTrigger('sincronizarPorCambio').forSpreadsheet(ss).onChange().create()
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create()
  sincronizarConAviso()
}

/** Al editar se espera unos segundos y se junta todo en una sola corrida. */
function sincronizarPorCambio() {
  const cache = CacheService.getScriptCache()
  if (cache.get('gantt_pendiente')) return
  cache.put('gantt_pendiente', '1', 20)
  Utilities.sleep(15000)
  cache.remove('gantt_pendiente')
  sincronizar()
}

function sincronizarConAviso() {
  const r = sincronizar()
  const omit = (r.omitidas || []).map(o => `• ${o.tanque} ${o.inicio} "${o.texto}": ${o.motivo}`).join('\n')
  SpreadsheetApp.getUi().alert(r.error
    ? `No se sincronizó: ${r.error}`
    : `Listo. ${r.lotes} lotes en la app (${r.insertados} nuevos, ${r.actualizados} actualizados, ${r.eliminados} borrados).` +
      (omit ? `\n\nOmitidas:\n${omit}` : ''))
}

function sincronizar() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) return { error: 'otra sincronización en curso' }
  try {
    const props = PropertiesService.getScriptProperties()
    const secret = props.getProperty('GANTT_SECRET')
    const url = props.getProperty('GANTT_URL')
    if (!secret || !url) return { error: 'faltan GANTT_SECRET o GANTT_URL en las propiedades del script' }

    const barras = leerBarras()
    // Red de seguridad: la app borra los lotes planificados que no vengan en
    // la lista, así que una lectura vacía (planilla rota, hoja renombrada)
    // NO se manda: se avisa y no se toca el plan.
    if (barras.length === 0) return { error: 'la planilla no trae ninguna barra: no se sincronizó para no borrar el plan' }
    const resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({ barras }),
    })
    const json = JSON.parse(resp.getContentText() || '{}')
    if (resp.getResponseCode() !== 200) return { error: json.error || ('HTTP ' + resp.getResponseCode()) }
    return json
  } catch (e) {
    return { error: String(e && e.message || e) }
  } finally {
    lock.releaseLock()
  }
}

function leerBarras() {
  const sh = SpreadsheetApp.getActive().getSheetByName(HOJA)
  if (!sh) throw new Error('no existe la hoja "' + HOJA + '"')
  const ultimaCol = sh.getLastColumn()
  const meses = sh.getRange(FILA_MESES, 1, 1, ultimaCol).getDisplayValues()[0]
  const dias = sh.getRange(FILA_DIAS, 1, 1, ultimaCol).getValues()[0]

  // Ancla: primera columna con nombre de mes (día 1 de ese mes).
  let colAncla = -1, mesAncla = -1
  for (let c = 0; c < ultimaCol; c++) {
    const m = MESES.indexOf(String(meses[c]).trim().toUpperCase())
    if (m >= 0) { colAncla = c; mesAncla = m; break }
  }
  if (colAncla < 0) throw new Error('no encontré el nombre del mes en la fila ' + FILA_MESES)
  const fechaAncla = new Date(Date.UTC(ANIO_PRIMER_MES, mesAncla, 1))
  const fechaDe = c => new Date(fechaAncla.getTime() + (c - colAncla) * 86400000)

  // Control: los números de día de la fila 7 tienen que calzar con la cuenta.
  // La primera columna con número de día marca dónde empiezan las fechas (puede
  // ser antes del primer mes: la planilla parte el 31 de agosto).
  let colPrimerDia = -1
  for (let c = 0; c < ultimaCol; c++) {
    const d = dias[c]
    const esDia = typeof d === 'number' && d >= 1 && d <= 31
    if (!esDia) { if (colPrimerDia >= 0) break; continue } // fin del calendario: lo de más allá son notas sueltas
    if (colPrimerDia < 0) colPrimerDia = c
    if (fechaDe(c).getUTCDate() !== d) {
      throw new Error('la columna ' + (c + 1) + ' dice día ' + d + ' pero la cuenta da ' +
        fechaDe(c).toISOString().slice(0, 10) + ' — ¿se insertó o borró una columna?')
    }
  }

  // El nombre del tanque está en la columna J (la C era de una versión vieja de
  // la planilla: con ella no se encontraba ningún tanque, se mandaban cero
  // barras y la app borraba todo el plan). Se busca en las primeras 12
  // columnas para no depender de un número fijo.
  const bloque = sh.getRange(1, 1, sh.getLastRow(), Math.min(12, ultimaCol)).getDisplayValues()
  const tanqueDeFila = {}
  let filaEncabezadoKombucha = -1
  bloque.forEach((fila, i) => {
    for (const celda of fila) {
      const s = String(celda).trim()
      if (/^(fermentador|bright|lavoratorio)/i.test(s)) { tanqueDeFila[i + 1] = s.split('(')[0].trim(); break }
      if (/^tanque kombucha/i.test(s)) { filaEncabezadoKombucha = i + 1; break }
    }
  })
  // La fila de K-1 viene sin nombre en la planilla (la que sigue al encabezado
  // "TANQUE KOMBUCHA"): se le pone el nombre a mano.
  if (filaEncabezadoKombucha > 0 && !tanqueDeFila[filaEncabezadoKombucha + 1]) {
    tanqueDeFila[filaEncabezadoKombucha + 1] = 'Fermentador K-1'
  }
  if (Object.keys(tanqueDeFila).length === 0) {
    throw new Error('no encontré ningún tanque (Fermentador / Bright / Lavoratorio) en las primeras columnas')
  }

  const iso = d => d.toISOString().slice(0, 10)
  return sh.getRange(1, 1, sh.getLastRow(), ultimaCol).getMergedRanges()
    .filter(r => tanqueDeFila[r.getRow()] && r.getNumRows() === 1 && r.getColumn() - 1 >= colPrimerDia)
    .map(r => ({
      tanque: tanqueDeFila[r.getRow()],
      inicio: iso(fechaDe(r.getColumn() - 1)),
      fin: iso(fechaDe(r.getLastColumn() - 1)),
      texto: String(r.getDisplayValue() || '').trim(),
    }))
}
