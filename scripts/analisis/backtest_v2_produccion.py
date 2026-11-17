"""
Backtest v2 del forecast de Producción: varios horizontes y escenarios.

    scripts/forecast/.venv/Scripts/python.exe scripts/analisis/backtest_v2_produccion.py

POR QUÉ UN v2 (17-nov-2026)
---------------------------
El backtest de septiembre (backtest_forecast_produccion.py) medía sólo 1 mes
adelante. Para planificar la temporada alta lo que importa es 1 a 4 ciclos
adelante (en noviembre hay que saber cuánto se vende en enero), y ahí un
método puede ser bueno el primer mes y malo el cuarto. Además:

  · Prueba los métodos que la investigación de pronóstico recomienda para
    series mensuales cortas con estacionalidad fuerte (competencias M4/M5,
    Hyndman & Athanasopoulos "Forecasting: Principles and Practice"):
    suavizado exponencial (ETS), Theta y COMBINACIONES de métodos.
  · Mide el Prophet que de verdad corre en producción: con la corrección de
    sesgo `b` de calibracion_sigma.json.
  · Mide la cobertura de las bandas: de ahí salen los escenarios conservador
    (P10), base (P50) y optimista (P90), con cuantiles empíricos de los errores
    del propio backtest por horizonte (la idea de la predicción conformal).

PROTOCOLO
---------
Rolling origin: para cada uno de los últimos ORIGENES meses de corte se entrena
con lo anterior y se proyectan HORIZONTE meses. Métrica principal WAPE (error
en litros / litros reales) y sesgo con signo, por nivel y horizonte, y aparte
sólo los meses de temporada alta (dic-mar).
"""

import json
import os
import re
import sys
import logging
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd
import requests

warnings.simplefilter("ignore")
logging.getLogger("prophet").setLevel(logging.CRITICAL)
logging.getLogger("cmdstanpy").setLevel(logging.CRITICAL)
from prophet import Prophet  # noqa: E402
from statsmodels.tsa.holtwinters import ExponentialSmoothing  # noqa: E402
from statsmodels.tsa.forecasting.theta import ThetaModel  # noqa: E402

HORIZONTE = 4
ORIGENES = 12
MIN_MESES = 13          # el estacional necesita el mismo mes del año anterior
MESES_TEMPORADA = {12, 1, 2, 3}
AQUI = os.path.dirname(__file__)


def cargar_env() -> tuple[str, str]:
    raiz = os.path.join(AQUI, "..", "..")
    env = {}
    with open(os.path.join(raiz, ".env.local"), encoding="utf-8") as fh:
        for linea in fh:
            m = re.match(r"^([A-Za-z0-9_]+)=(.*)$", linea)
            if m:
                env[m.group(1)] = m.group(2).strip().strip("\"'")
    return env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]


def traer_historico(url: str, key: str) -> pd.DataFrame:
    filas, offset = [], 0
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    while True:
        r = requests.get(
            f"{url}/rest/v1/forecast_produccion",
            headers={**headers, "Range": f"{offset}-{offset + 999}"},
            params={"select": "nivel,clave,mes,tipo,litros", "tipo": "eq.historico", "order": "mes.asc"},
            timeout=120,
        )
        r.raise_for_status()
        lote = r.json()
        if not lote:
            break
        filas.extend(lote)
        if len(lote) < 1000:
            break
        offset += 1000
    df = pd.DataFrame(filas)
    df["ds"] = pd.to_datetime(df["mes"])
    df["y"] = df["litros"].astype(float).clip(lower=0)
    df["clave"] = df["clave"].fillna("")
    return df


def factores_b() -> tuple[dict, dict]:
    with open(os.path.join(AQUI, "..", "forecast", "calibracion_sigma.json"), encoding="utf-8") as fh:
        cal = json.load(fh)
    por_serie = {(s["nivel"], s["clave"] if isinstance(s["clave"], str) else ""): s["b"] for s in cal.get("series", [])}
    por_nivel = {n: v["b_crudo"] for n, v in cal.get("ancla_propio", {}).items()}
    return por_serie, por_nivel


# ── Métodos: cada uno recibe el historial (array) y devuelve HORIZONTE valores ──

def m_prophet(train: pd.DataFrame, h: int) -> np.ndarray:
    m = Prophet(yearly_seasonality=len(train) >= 24, weekly_seasonality=False, daily_seasonality=False, interval_width=0.8)
    m.fit(train[["ds", "y"]])
    pred = m.predict(m.make_future_dataframe(periods=h, freq="MS")).tail(h)
    return np.maximum(pred["yhat"].to_numpy(), 0)


def m_snaive(y: np.ndarray, h: int) -> np.ndarray:
    return np.array([y[len(y) - 12 + i] if i < 12 else y[len(y) - 12 + (i % 12)] for i in range(h)])


def crecimiento(y: np.ndarray, ventana: int) -> float:
    """Últimos `ventana` meses contra los mismos meses un año antes, acotado."""
    if len(y) < 12 + ventana:
        return 1.0
    ult = y[-ventana:].sum()
    ant = y[-12 - ventana:-12].sum()
    return float(np.clip(ult / ant, 0.6, 1.6)) if ant > 0 else 1.0


def m_snaive_crec(y: np.ndarray, h: int, ventana: int = 6) -> np.ndarray:
    return m_snaive(y, h) * crecimiento(y, ventana)


def m_ets(y: np.ndarray, h: int) -> np.ndarray:
    if len(y) < 24:
        return m_snaive(y, h)
    try:
        mod = ExponentialSmoothing(y, trend="add", damped_trend=True, seasonal="add", seasonal_periods=12,
                                   initialization_method="estimated").fit(optimized=True)
        return np.maximum(mod.forecast(h), 0)
    except Exception:
        return m_snaive(y, h)


def m_theta(y: np.ndarray, h: int) -> np.ndarray:
    if len(y) < 24 or (y <= 0).any():
        # Theta desestacionaliza multiplicativo: con ceros no aplica.
        return m_snaive_crec(y, h)
    try:
        idx = pd.period_range("2000-01", periods=len(y), freq="M")
        mod = ThetaModel(pd.Series(y, index=idx), period=12, deseasonalize=True, method="auto").fit()
        return np.maximum(mod.forecast(h).to_numpy(), 0)
    except Exception:
        return m_snaive_crec(y, h)


def m_media3(y: np.ndarray, h: int) -> np.ndarray:
    return np.repeat(y[-3:].mean(), h)


METODOS_BASE = ["snaive", "snaive_crec6", "snaive_crec12", "ets", "theta", "media3"]


def pronosticos(serie: pd.DataFrame, corte: int, b: float, con_prophet: bool) -> dict[str, np.ndarray]:
    train = serie.iloc[:corte]
    y = train["y"].to_numpy()
    out = {
        "snaive": m_snaive(y, HORIZONTE),
        "snaive_crec6": m_snaive_crec(y, HORIZONTE, 6),
        "snaive_crec12": m_snaive_crec(y, HORIZONTE, 12),
        "ets": m_ets(y, HORIZONTE),
        "theta": m_theta(y, HORIZONTE),
        "media3": m_media3(y, HORIZONTE),
    }
    if con_prophet:
        p = m_prophet(train, HORIZONTE)
        out["prophet"] = p
        out["prophet_b"] = p * b
    # Combinaciones: la mediana es robusta a un método que se dispara.
    out["comb_ets_crec"] = (out["ets"] + out["snaive_crec12"]) / 2
    out["comb_mediana"] = np.median(np.vstack([out["ets"], out["theta"], out["snaive_crec12"]]), axis=0)
    out["comb_media3"] = (out["ets"] + out["theta"] + out["snaive_crec12"]) / 3
    return out


def main() -> int:
    url, key = cargar_env()
    print("descargando histórico…", flush=True)
    df = traer_historico(url, key)
    b_serie, b_nivel = factores_b()
    ultimo = df["ds"].max()
    print(f"  {len(df)} filas · último ciclo cerrado {ultimo:%Y-%m}", flush=True)

    registros = []  # una fila por (nivel, clave, metodo, corte, h)
    niveles = ["general", "producto", "producto_envase"]
    for nivel in niveles:
        grupos = [(c, g.sort_values("ds").reset_index(drop=True)) for c, g in df[df["nivel"] == nivel].groupby("clave")]
        # Series activas: vendieron algo en los últimos 6 meses.
        grupos = [(c, g) for c, g in grupos if len(g) >= MIN_MESES + 1 and g["y"].tail(6).sum() > 0]
        print(f"\n{nivel}: {len(grupos)} series", flush=True)
        for i, (clave, g) in enumerate(grupos, 1):
            # Rellena meses faltantes con 0 (la serie del pipeline ya viene completa, por las dudas).
            # Algunas claves traen el mismo mes dos veces (dos nombres del ERP que
            # normalizan igual): se suman antes de completar los meses vacíos.
            g = g.groupby("ds", as_index=True)["y"].sum().to_frame().asfreq("MS", fill_value=0.0).reset_index()
            g["y"] = g["y"].astype(float)
            n = len(g)
            b = b_serie.get((nivel, clave), b_nivel.get(nivel, 1.0))
            print(f"  [{i}/{len(grupos)}] {clave or 'consolidado'}", flush=True)
            for corte in range(n - ORIGENES, n):
                if corte < MIN_MESES:
                    continue
                preds = pronosticos(g, corte, b, con_prophet=True)
                for hh in range(HORIZONTE):
                    t = corte + hh
                    if t >= n:
                        break
                    real = float(g.loc[t, "y"])
                    mes = g.loc[t, "ds"]
                    for metodo, v in preds.items():
                        registros.append({"nivel": nivel, "clave": clave, "metodo": metodo, "corte": corte,
                                          "h": hh + 1, "mes": mes, "real": real, "pred": float(v[hh])})

    res = pd.DataFrame(registros)
    res.to_csv(os.path.join(AQUI, "backtest_v2_resultado.csv"), index=False)
    res["err"] = (res["pred"] - res["real"]).abs()
    res["sesgo"] = res["pred"] - res["real"]
    res["temporada"] = res["mes"].dt.month.isin(MESES_TEMPORADA)

    def tabla(sub: pd.DataFrame, titulo: str) -> pd.DataFrame:
        t = sub.groupby(["nivel", "metodo"]).agg(err=("err", "sum"), real=("real", "sum"), sesgo=("sesgo", "sum")).reset_index()
        t["wape"] = t["err"] / t["real"] * 100
        t["sesgo_pct"] = t["sesgo"] / t["real"] * 100
        print("\n" + "=" * 70 + f"\n{titulo}\n" + "=" * 70)
        for nivel, gg in t.sort_values(["nivel", "wape"]).groupby("nivel", sort=False):
            print(f"\n{nivel}")
            for _, r in gg.iterrows():
                print(f"  {r['metodo']:<16} WAPE {r['wape']:>5.1f}%   sesgo {r['sesgo_pct']:>+6.1f}%")
        return t

    tabla(res, f"TODOS LOS HORIZONTES (1 a {HORIZONTE} ciclos)")
    tabla(res[res["temporada"]], "SÓLO MESES DE TEMPORADA ALTA (dic-mar)")

    print("\n" + "=" * 70 + "\nWAPE POR HORIZONTE (producto x envase)\n" + "=" * 70)
    pe = res[res["nivel"] == "producto_envase"]
    piv = pe.groupby(["metodo", "h"]).apply(lambda x: x["err"].sum() / x["real"].sum() * 100).unstack("h")
    print(piv.sort_values(1).round(1).to_string())

    # ── Escenarios: cuantiles empíricos de real/pred por nivel y horizonte ──
    print("\n" + "=" * 70 + "\nESCENARIOS (cuantiles empíricos de real ÷ pronóstico)\n" + "=" * 70)
    escenarios = {}
    for metodo in ["comb_ets_crec", "comb_mediana", "prophet_b"]:
        escenarios[metodo] = {}
        for nivel in niveles:
            for hh in range(1, HORIZONTE + 1):
                s = res[(res["metodo"] == metodo) & (res["nivel"] == nivel) & (res["h"] == hh) & (res["pred"] > 0)]
                # Ponderado por volumen: una serie de 20 L/mes no debe abrir la banda de todas.
                ratio = (s["real"] / s["pred"]).clip(0, 4)
                w = s["pred"]
                if len(s) < 10:
                    continue
                orden = np.argsort(ratio.to_numpy())
                rv, wv = ratio.to_numpy()[orden], w.to_numpy()[orden]
                cw = np.cumsum(wv) / wv.sum()
                q = lambda p: float(rv[np.searchsorted(cw, p)])  # noqa: E731
                escenarios[metodo][f"{nivel}|{hh}"] = {"p10": round(q(0.10), 3), "p50": round(q(0.50), 3), "p90": round(q(0.90), 3), "n": int(len(s))}
        print(f"\n{metodo}")
        for k, v in escenarios[metodo].items():
            print(f"  {k:<22} P10 ×{v['p10']:.2f}   P50 ×{v['p50']:.2f}   P90 ×{v['p90']:.2f}   (n={v['n']})")
    with open(os.path.join(AQUI, "backtest_v2_escenarios.json"), "w", encoding="utf-8") as fh:
        json.dump(escenarios, fh, indent=2)

    print("\nDetalle: scripts/analisis/backtest_v2_resultado.csv · escenarios: backtest_v2_escenarios.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
