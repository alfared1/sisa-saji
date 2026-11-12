"""
Surplus Prediction Engine - LightGBM pipeline (model_version "lgbm-v1").

Blueprint section 2.3.2. Run with `npm run ml:train` (scripts/ml-run.ts finds the
project venv) or directly:  .venv/Scripts/python.exe ml/train_predict.py

What it does
  1. Loads closed surplus batches (SOLD_OUT / EXPIRED, batch_date < today WIB) and
     aggregates them per (merchant, menu, date):
       target A  surplus_portions = SUM(initial_stock)   (what the warung declared as surplus)
       target B  sold_out         = every batch of that menu/date ended SOLD_OUT
  2. Features
       day_of_week, is_weekend, is_end_of_month (day 25-31), is_thursday_night,
       rolling_4w_avg_surplus  (same weekday, previous 4 weeks),
       rolling_4w_sellout_rate (same weekday, previous 4 weeks, Laplace smoothed),
       rolling_4w_obs          (number of same-weekday observations),
       menu_4w_avg_surplus     (all weekdays, previous 28 days),
       historical_conversion_rate (merchant), category (categorical), price, is_mystery_bag,
       rain_evening_mm (rain 17:00-22:59 WIB at the warung, Open-Meteo: observed for
       history, forecast for the next 7 days; NaN when unavailable, see ml/weather.py).
     Not yet: academic calendar (UTS/UAS, holidays, KKN), local events.
  3. Time-based split: the last 7 history days are the validation set. Prints MAE of
     the LGBMRegressor vs the heuristic baseline (heuristic-v0: same-weekday mean),
     and the AUC of the LGBMClassifier. Then refits both on all data.
     The regressor boosts the residual on top of the heuristic baseline.
  4. Predicts today..+6 (WIB) for every active menu and UPSERTs into
     merchant_surplus_predictions with model_version 'lgbm-v1' (and the evening rain
     forecast it used in rain_forecast_mm), plus a merchant-level
     row (menu_id NULL) holding the sum of portions. The table is
     UNIQUE NULLS NOT DISTINCT (merchant_id, menu_id, target_date), so these rows
     replace heuristic-v0 rows; proactive_notif_sent is preserved.
  5. Saves models + metrics to ml/artifacts/ (git-ignored).

Exits 0 without writing when there is too little history (graceful), non-zero on errors.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
from dotenv import load_dotenv

import weather

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
MODEL_VERSION = "lgbm-v1"
HISTORY_WEEKS = 4
VALIDATION_DAYS = 7
HORIZON_DAYS = 7
MIN_TRAIN_ROWS = 40
MIN_HISTORY_DAYS = 10
WIB = timezone(timedelta(hours=7))

MENU_CATEGORIES = [
    "MAKANAN_BERAT",
    "MAKANAN_RINGAN",
    "MAKANAN_VEGAN",
    "MINUMAN",
    "ROTI_PASTRY",
    "BAHAN_MAKANAN",
    "MYSTERY_BAG",
]
FEATURES = [
    "day_of_week",
    "is_weekend",
    "is_end_of_month",
    "is_thursday_night",
    "rolling_4w_avg_surplus",
    "rolling_4w_sellout_rate",
    "rolling_4w_obs",
    "menu_4w_avg_surplus",
    "historical_conversion_rate",
    "category",
    "price",
    "is_mystery_bag",
    "rain_evening_mm",
]


def log(msg: str) -> None:
    print(f"[ml] {msg}", flush=True)


def postgres_dow(d: date) -> int:
    """0 = Minggu ... 6 = Sabtu (matches Postgres EXTRACT(DOW) and the app)."""
    return (d.weekday() + 1) % 7


# --------------------------------------------------------------------------- #
# Data                                                                        #
# --------------------------------------------------------------------------- #

HISTORY_SQL = """
SELECT b.merchant_id::text            AS merchant_id,
       b.menu_id::text                AS menu_id,
       b.batch_date                   AS batch_date,
       SUM(b.initial_stock)::int      AS surplus_portions,
       BOOL_AND(b.status = 'SOLD_OUT') AS sold_out
FROM surplus_batches b
WHERE b.status IN ('SOLD_OUT', 'EXPIRED') AND b.batch_date < %s
GROUP BY b.merchant_id, b.menu_id, b.batch_date
"""

MENUS_SQL = """
SELECT mn.id::text                          AS menu_id,
       mn.merchant_id::text                 AS merchant_id,
       mn.category::text                    AS category,
       mn.original_price_idr                AS price,
       mn.is_mystery_bag                    AS is_mystery_bag,
       mn.is_active                         AS is_active,
       m.historical_conversion_rate::float8 AS historical_conversion_rate,
       to_char(m.default_surplus_start_time, 'HH24:MI:SS') AS peak_hour,
       m.latitude::float8                   AS lat,
       m.longitude::float8                  AS lng
FROM menus mn JOIN merchants m ON m.id = mn.merchant_id
"""


def load_data(conn: psycopg.Connection, today: date) -> tuple[pd.DataFrame, pd.DataFrame]:
    with conn.cursor() as cur:
        cur.execute(HISTORY_SQL, (today,))
        hist = pd.DataFrame(cur.fetchall(), columns=[c.name for c in cur.description])
        cur.execute(MENUS_SQL)
        menus = pd.DataFrame(cur.fetchall(), columns=[c.name for c in cur.description])
    if not hist.empty:
        hist["batch_date"] = pd.to_datetime(hist["batch_date"]).dt.date
        hist["sold_out"] = hist["sold_out"].astype(int)
    return hist, menus


class History:
    """Lookup of (menu_id, date) -> (surplus, sold_out) for rolling features."""

    def __init__(self, hist: pd.DataFrame) -> None:
        self.by_menu: dict[str, dict[date, tuple[int, int]]] = defaultdict(dict)
        for r in hist.itertuples(index=False):
            self.by_menu[r.menu_id][r.batch_date] = (int(r.surplus_portions), int(r.sold_out))

    def rolling(self, menu_id: str, target: date) -> dict[str, float]:
        """Features from history strictly before `target` (no leakage)."""
        rows = self.by_menu.get(menu_id, {})
        same = [rows[d] for d in (target - timedelta(days=7 * k) for k in range(1, HISTORY_WEEKS + 1)) if d in rows]
        window_start = target - timedelta(days=7 * HISTORY_WEEKS)
        anyday = [v for d, v in rows.items() if window_start <= d < target]
        n = len(same)
        return {
            "rolling_4w_avg_surplus": float(np.mean([s for s, _ in same])) if n else math.nan,
            "rolling_4w_sellout_rate": (sum(o for _, o in same) + 1) / (n + 2),
            "rolling_4w_obs": n,
            "menu_4w_avg_surplus": float(np.mean([s for s, _ in anyday])) if anyday else math.nan,
        }


def calendar_features(d: date) -> dict[str, int]:
    dow = postgres_dow(d)
    return {
        "day_of_week": dow,
        "is_weekend": int(dow in (0, 6)),
        "is_end_of_month": int(d.day >= 25),
        # "Malam Jumat" (Thursday evening) is a known busy/slow night for warung around campus.
        "is_thursday_night": int(dow == 4),
    }


def feature_row(menu: pd.Series | dict, d: date, history: History, rain: dict) -> dict:
    return {
        **calendar_features(d),
        **history.rolling(menu["menu_id"], d),
        "historical_conversion_rate": float(menu["historical_conversion_rate"]),
        "category": menu["category"],
        "price": int(menu["price"]),
        "is_mystery_bag": int(bool(menu["is_mystery_bag"])),
        "rain_evening_mm": weather.rain_for(rain, float(menu["lat"]), float(menu["lng"]), d),
    }


def to_frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["category"] = pd.Categorical(df["category"], categories=MENU_CATEGORIES)
    return df


def build_training_set(hist: pd.DataFrame, menus: pd.DataFrame, history: History, rain: dict) -> pd.DataFrame:
    menu_info = menus.set_index("menu_id")
    rows = []
    for r in hist.itertuples(index=False):
        if r.menu_id not in menu_info.index:
            continue
        m = menu_info.loc[r.menu_id]
        menu = {
            "menu_id": r.menu_id,
            "historical_conversion_rate": m["historical_conversion_rate"],
            "category": m["category"],
            "price": m["price"],
            "is_mystery_bag": m["is_mystery_bag"],
            "lat": m["lat"],
            "lng": m["lng"],
        }
        rows.append(
            {
                "merchant_id": r.merchant_id,
                "menu_id": r.menu_id,
                "batch_date": r.batch_date,
                "surplus_portions": int(r.surplus_portions),
                "sold_out": int(r.sold_out),
                **feature_row(menu, r.batch_date, history, rain),
            }
        )
    return to_frame(rows) if rows else pd.DataFrame()


def heuristic_baseline(df: pd.DataFrame) -> np.ndarray:
    """heuristic-v0: same-weekday 4-week mean, else 4-week mean, else 0."""
    return df["rolling_4w_avg_surplus"].fillna(df["menu_4w_avg_surplus"]).fillna(0.0).to_numpy()


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #


def make_models(seed: int):
    from lightgbm import LGBMClassifier, LGBMRegressor

    common = dict(
        n_estimators=250,
        learning_rate=0.05,
        num_leaves=15,
        min_child_samples=8,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        random_state=seed,
        verbose=-1,
    )
    # The regressor learns the RESIDUAL on top of the heuristic baseline (see SurplusRegressor):
    # small, heavily regularised trees; L1 objective = robust to the odd huge evening.
    reg = LGBMRegressor(
        objective="regression_l1",
        **{**common, "n_estimators": 300, "learning_rate": 0.03, "num_leaves": 7, "min_child_samples": 30},
    )
    return SurplusRegressor(reg), LGBMClassifier(objective="binary", **common)


class SurplusRegressor:
    """LGBMRegressor on residuals: prediction = heuristic baseline + model(features), clipped at 0.

    With only a few weeks of history the same-weekday mean is a strong prior; boosting
    the residual lets the trees learn corrections (weekday, price, conversion rate, ...)
    without having to re-learn the level of every menu.
    """

    def __init__(self, model) -> None:
        self.model = model

    @property
    def booster_(self):
        return self.model.booster_

    def fit(self, x: pd.DataFrame, y: pd.Series, **kwargs) -> "SurplusRegressor":
        self.model.fit(x[FEATURES], y.to_numpy() - heuristic_baseline(x), **kwargs)
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        return np.clip(heuristic_baseline(x) + self.model.predict(x[FEATURES]), 0, None)


class ConstantClassifier:
    """Fallback when the training labels contain a single class."""

    def __init__(self, rate: float) -> None:
        self.rate = rate

    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        p = np.full(len(x), self.rate)
        return np.column_stack([1 - p, p])


def fit_classifier(clf, x: pd.DataFrame, y: pd.Series):
    if y.nunique() < 2:
        return ConstantClassifier((y.sum() + 1) / (len(y) + 2))
    clf.fit(x, y, categorical_feature=["category"])
    return clf


def evaluate(train: pd.DataFrame, val: pd.DataFrame, seed: int) -> dict:
    from sklearn.metrics import mean_absolute_error, roc_auc_score

    reg, clf = make_models(seed)
    reg.fit(train, train["surplus_portions"], categorical_feature=["category"])
    clf = fit_classifier(clf, train[FEATURES], train["sold_out"])

    pred = reg.predict(val)
    base = heuristic_baseline(val)
    y = val["surplus_portions"].to_numpy()
    mae_model = float(mean_absolute_error(y, pred))
    mae_base = float(mean_absolute_error(y, base))
    proba = clf.predict_proba(val[FEATURES])[:, 1]
    auc = float(roc_auc_score(val["sold_out"], proba)) if val["sold_out"].nunique() == 2 else math.nan
    base_auc = (
        float(roc_auc_score(val["sold_out"], val["rolling_4w_sellout_rate"]))
        if val["sold_out"].nunique() == 2
        else math.nan
    )
    mean_target = float(np.mean(y)) if len(y) else 1.0
    return {
        "train_rows": int(len(train)),
        "validation_rows": int(len(val)),
        "mae_lgbm": round(mae_model, 3),
        "mae_heuristic": round(mae_base, 3),
        "mae_improvement_pct": round((1 - mae_model / mae_base) * 100, 1) if mae_base > 0 else None,
        "auc_lgbm": None if math.isnan(auc) else round(auc, 4),
        "auc_heuristic": None if math.isnan(base_auc) else round(base_auc, 4),
        "validation_mean_surplus": round(mean_target, 3),
        "validation_sellout_rate": round(float(val["sold_out"].mean()), 4) if len(val) else None,
    }


def base_confidence(metrics: dict) -> float:
    """1 - relative MAE on the validation window, clamped to 0.30..0.95."""
    mean = max(1.0, metrics["validation_mean_surplus"])
    return float(min(0.95, max(0.30, 1 - metrics["mae_lgbm"] / mean)))


# --------------------------------------------------------------------------- #
# Prediction + upsert                                                         #
# --------------------------------------------------------------------------- #

UPSERT_HEAD = """
INSERT INTO merchant_surplus_predictions
  (merchant_id, menu_id, target_date, day_of_week, predicted_surplus_portions,
   predicted_peak_surplus_hour, sellout_probability_at_50pct, confidence_score, rain_forecast_mm, model_version)
VALUES {values}
ON CONFLICT ON CONSTRAINT uq_predictions_merchant_menu_date DO UPDATE SET
  day_of_week = EXCLUDED.day_of_week,
  predicted_surplus_portions = EXCLUDED.predicted_surplus_portions,
  predicted_peak_surplus_hour = EXCLUDED.predicted_peak_surplus_hour,
  sellout_probability_at_50pct = EXCLUDED.sellout_probability_at_50pct,
  confidence_score = EXCLUDED.confidence_score,
  rain_forecast_mm = EXCLUDED.rain_forecast_mm,
  model_version = EXCLUDED.model_version,
  created_at = now()
"""
ROW_PLACEHOLDER = "(%s::uuid, %s::uuid, %s::date, %s, %s, %s::time, %s, %s, %s, %s)"


def _mm(v: float) -> float | None:
    return None if v is None or math.isnan(v) else round(float(v), 1)


def predict_rows(reg, clf, menus: pd.DataFrame, history: History, today: date, conf_base: float, rain: dict) -> list[tuple]:
    active = menus[menus["is_active"]].reset_index(drop=True)
    if active.empty:
        return []
    rows: list[tuple] = []
    for k in range(HORIZON_DAYS):
        d = today + timedelta(days=k)
        feats = to_frame([feature_row(m, d, history, rain) for _, m in active.iterrows()])
        portions = reg.predict(feats)
        proba = clf.predict_proba(feats[FEATURES])[:, 1]
        dow = postgres_dow(d)
        per_merchant: dict[str, list[tuple[float, float, float]]] = defaultdict(list)
        peak_by_merchant: dict[str, str] = {}
        rain_by_merchant: dict[str, float | None] = {}
        for i, m in active.iterrows():
            obs = int(feats.loc[i, "rolling_4w_obs"])
            conf = min(0.95, conf_base * (0.8 + 0.05 * obs))
            p = float(np.clip(proba[i], 0.02, 0.98))
            portions_i = round(float(portions[i]), 2)
            mm = _mm(feats.loc[i, "rain_evening_mm"])
            rows.append(
                (m["merchant_id"], m["menu_id"], d, dow, portions_i, m["peak_hour"], round(p, 4), round(conf, 4), mm, MODEL_VERSION)
            )
            per_merchant[m["merchant_id"]].append((portions_i, p, conf))
            peak_by_merchant[m["merchant_id"]] = m["peak_hour"]
            rain_by_merchant[m["merchant_id"]] = mm
        for merchant_id, vals in per_merchant.items():
            rows.append(
                (
                    merchant_id,
                    None,
                    d,
                    dow,
                    round(sum(v[0] for v in vals), 2),
                    peak_by_merchant[merchant_id],
                    round(float(np.mean([v[1] for v in vals])), 4),
                    round(float(np.mean([v[2] for v in vals])), 4),
                    rain_by_merchant.get(merchant_id),
                    MODEL_VERSION,
                )
            )
    return rows


def upsert(conn: psycopg.Connection, rows: list[tuple], chunk: int = 100) -> int:
    written = 0
    with conn.transaction():
        with conn.cursor() as cur:
            for i in range(0, len(rows), chunk):
                part = rows[i : i + chunk]
                values = ", ".join([ROW_PLACEHOLDER] * len(part))
                params = [v for r in part for v in r]
                cur.execute(UPSERT_HEAD.format(values=values), params)
                written += cur.rowcount
    return written


def save_artifacts(reg, clf, metrics: dict) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    reg.booster_.save_model(str(ARTIFACTS / "surplus_regressor.txt"))
    if hasattr(clf, "booster_"):
        clf.booster_.save_model(str(ARTIFACTS / "sellout_classifier.txt"))
    (ARTIFACTS / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #


def main() -> int:
    parser = argparse.ArgumentParser(description="Train lgbm-v1 surplus models and write predictions.")
    parser.add_argument("--dry-run", action="store_true", help="train + evaluate only, do not write predictions")
    parser.add_argument("--today", help="override 'today' (YYYY-MM-DD, WIB) for backtests")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-weather", action="store_true", help="skip the Open-Meteo rain feature (offline runs)")
    args = parser.parse_args()

    # The environment wins over .env (scripts/ml-run.ts passes DATABASE_URL explicitly).
    load_dotenv(ROOT / ".env", override=False)
    url = os.environ.get("DATABASE_URL")
    if not url:
        log("DATABASE_URL belum diatur (.env atau environment)")
        return 2

    today = date.fromisoformat(args.today) if args.today else datetime.now(WIB).date()
    log(f"model {MODEL_VERSION}, today (WIB) {today}, db {url.split('@')[-1]}")

    with psycopg.connect(url, autocommit=True, connect_timeout=15) as conn:
        hist, menus = load_data(conn, today)
        if hist.empty or menus.empty:
            log("Belum ada histori batch yang sudah ditutup. Lewati pelatihan (heuristic-v0 tetap dipakai).")
            return 0
        history = History(hist)
        rain: dict = {}
        if not args.no_weather:
            points = {weather.grid_key(float(m.lat), float(m.lng)) for m in menus.itertuples(index=False)}
            start, end = min(hist["batch_date"]), today + timedelta(days=HORIZON_DAYS - 1)
            rain = weather.evening_rain(points, start, end, today, log)
            log(f"cuaca: {len(points)} titik, {len(rain)} malam dengan data hujan ({start} .. {end})")
        data = build_training_set(hist, menus, history, rain)
        n_days = data["batch_date"].nunique()
        log(f"training set: {len(data)} rows, {data['menu_id'].nunique()} menus, {n_days} days "
            f"({data['batch_date'].min()} .. {data['batch_date'].max()})")
        if len(data) < MIN_TRAIN_ROWS or n_days < MIN_HISTORY_DAYS:
            log(f"Data terlalu sedikit (butuh >= {MIN_TRAIN_ROWS} baris dan >= {MIN_HISTORY_DAYS} hari). "
                "Lewati pelatihan (heuristic-v0 tetap dipakai).")
            return 0

        split = data["batch_date"].max() - timedelta(days=VALIDATION_DAYS - 1)
        train, val = data[data["batch_date"] < split], data[data["batch_date"] >= split]
        metrics = evaluate(train, val, args.seed)
        log(f"validation (last {VALIDATION_DAYS} days from {split}): {metrics['validation_rows']} rows, "
            f"train {metrics['train_rows']} rows")
        log(f"  surplus portions MAE  lgbm {metrics['mae_lgbm']:.3f}  vs  heuristic {metrics['mae_heuristic']:.3f}"
            f"  (improvement {metrics['mae_improvement_pct']}%)")
        log(f"  sell-out AUC          lgbm {metrics['auc_lgbm']}  vs  heuristic {metrics['auc_heuristic']}")

        # Refit on all history for serving.
        reg, clf = make_models(args.seed)
        reg.fit(data, data["surplus_portions"], categorical_feature=["category"])
        clf = fit_classifier(clf, data[FEATURES], data["sold_out"])
        importance = sorted(zip(FEATURES, reg.booster_.feature_importance("gain")), key=lambda t: -t[1])
        log("  top features (gain): " + ", ".join(f"{n}={g:.0f}" for n, g in importance[:5]))

        conf = base_confidence(metrics)
        rows = predict_rows(reg, clf, menus, history, today, conf, rain)
        metrics.update(
            {
                "model_version": MODEL_VERSION,
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "today_wib": today.isoformat(),
                "base_confidence": round(conf, 4),
                "prediction_rows": len(rows),
                "weather_nights": len(rain),
                "training_rows_with_rain": int(data["rain_evening_mm"].notna().sum()),
                "feature_importance_gain": {n: round(float(g), 1) for n, g in importance},
            }
        )
        save_artifacts(reg, clf, metrics)
        log(f"artifacts saved to {ARTIFACTS}")

        if args.dry_run:
            log(f"--dry-run: {len(rows)} prediction rows NOT written")
            return 0
        written = upsert(conn, rows)
        log(f"upserted {written} rows into merchant_surplus_predictions "
            f"({today} .. {today + timedelta(days=HORIZON_DAYS - 1)}, base confidence {conf:.2f})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - report and exit non-zero
        log(f"GAGAL: {type(exc).__name__}: {exc}")
        sys.exit(1)
