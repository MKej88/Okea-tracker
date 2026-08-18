const BOE_PER_SM3_OE = 6.29;

type QuarterParts = {
  year: number;
  quarter: number;
  months: number[];
  startDate: string;
  endDate: string;
};

type Field = {
  field_key: string;
  display_name: string;
  tracker_share: number;
};

type ProductionRow = {
  field_key: string;
  year: number;
  month: number;
  company_est_kboepd: number;
  source_oil_mill_sm3: number;
  source_gas_bill_sm3: number;
  source_ngl_mill_sm3: number;
  source_cond_mill_sm3: number;
  tracker_share: number;
};

type EventRow = {
  field_key: string | null;
  title: string;
  impact_kboepd: number;
  confidence: string;
  source_note: string | null;
};

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function parseQuarter(value: string): QuarterParts {
  const match = /^(\d{4})Q([1-4])$/.exec(value);
  if (!match) throw new Error(`Invalid quarter: ${value}`);
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const firstMonth = (quarter - 1) * 3 + 1;
  const months = [firstMonth, firstMonth + 1, firstMonth + 2];
  const startDate = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
  const lastMonth = firstMonth + 2;
  const endDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const endDate = `${year}-${String(lastMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { year, quarter, months, startDate, endDate };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function periodIndex(year: number, month: number) {
  return year * 12 + (month - 1);
}

function periodLabel(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function setting(db: D1Database, key: string, fallback: number) {
  const row = await db
    .prepare(`SELECT value FROM model_settings WHERE key=?`)
    .bind(key)
    .first<{ value: string }>();
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : fallback;
}

async function priceAverage(
  db: D1Database,
  kind: string,
  startDate: string,
  endDate: string,
) {
  const row = await db
    .prepare(
      `SELECT AVG(value) AS avg_value, COUNT(*) AS n, MAX(price_date) AS last_date
       FROM price_daily
       WHERE kind=? AND price_date BETWEEN ? AND ?`,
    )
    .bind(kind, startDate, endDate)
    .first<{ avg_value: number | null; n: number; last_date: string | null }>();
  return {
    value: row?.avg_value == null ? null : Number(row.avg_value),
    observations: Number(row?.n ?? 0),
    lastDate: row?.last_date ?? null,
  };
}

async function loadProductionRows(db: D1Database, q: QuarterParts) {
  const current = await db
    .prepare(
      `SELECT p.field_key, p.year, p.month, p.company_est_kboepd,
              p.source_oil_mill_sm3, p.source_gas_bill_sm3,
              p.source_ngl_mill_sm3, p.source_cond_mill_sm3,
              f.tracker_share
       FROM production_monthly p
       JOIN fields f ON f.field_key=p.field_key
       WHERE p.year=? AND p.month BETWEEN ? AND ?
       ORDER BY p.field_key, p.month`,
    )
    .bind(q.year, q.months[0], q.months[2])
    .all<ProductionRow>();

  const prior = await db
    .prepare(
      `SELECT p.field_key, p.year, p.month, p.company_est_kboepd,
              p.source_oil_mill_sm3, p.source_gas_bill_sm3,
              p.source_ngl_mill_sm3, p.source_cond_mill_sm3,
              f.tracker_share
       FROM production_monthly p
       JOIN fields f ON f.field_key=p.field_key
       WHERE (p.year < ? OR (p.year=? AND p.month < ?))
       ORDER BY p.year DESC, p.month DESC`,
    )
    .bind(q.year, q.year, q.months[0])
    .all<ProductionRow>();

  return { current: current.results, prior: prior.results };
}

function productVolumesFromRow(row: ProductionRow, scaleDays = 1) {
  const share = Number(row.tracker_share ?? 0);
  return {
    crudeBoe:
      (Number(row.source_oil_mill_sm3 ?? 0) +
        Number(row.source_cond_mill_sm3 ?? 0)) *
      share *
      1_000_000 *
      BOE_PER_SM3_OE *
      scaleDays,
    gasBoe:
      Number(row.source_gas_bill_sm3 ?? 0) *
      share *
      6_290_000 *
      scaleDays,
    nglBoe:
      Number(row.source_ngl_mill_sm3 ?? 0) *
      share *
      1_000_000 *
      BOE_PER_SM3_OE *
      scaleDays,
  };
}

function choosePreQuarterBaseline(
  history: ProductionRow[],
  lookbackMonths: number,
  anomalyFloorRatio: number,
) {
  const recent = history.slice(0, Math.max(1, lookbackMonths));
  if (!recent.length) {
    return { row: null as ProductionRow | null, method: "missing", medianRate: null as number | null };
  }

  const positive = recent.filter((r) => Number(r.company_est_kboepd) > 0.05);
  if (!positive.length) {
    return { row: recent[0], method: "latest-pre-quarter", medianRate: 0 };
  }

  const med = median(positive.map((r) => Number(r.company_est_kboepd))) ?? 0;
  const latest = recent[0];
  const latestRate = Number(latest.company_est_kboepd ?? 0);

  if (med <= 0 || latestRate >= med * anomalyFloorRatio) {
    return { row: latest, method: "latest-pre-quarter", medianRate: med };
  }

  const closestToMedian = positive.reduce((best, row) => {
    const bestDistance = Math.abs(Number(best.company_est_kboepd) - med);
    const rowDistance = Math.abs(Number(row.company_est_kboepd) - med);
    return rowDistance < bestDistance ? row : best;
  });

  return { row: closestToMedian, method: "robust-median", medianRate: med };
}

async function q3ProjectScenarios(db: D1Database, quarter: string, coreKboepd: number) {
  if (quarter !== "2026Q3") {
    return {
      enabled: false,
      coreKboepd,
      bearKboepd: coreKboepd,
      baseKboepd: coreKboepd,
      bullKboepd: coreKboepd,
      project: null,
    };
  }

  const initialNet = await setting(db, "gws_q3_initial_net_kboepd", 6.5);
  const bearContribution = await setting(db, "gws_q3_bear_contribution_kboepd", 0);
  const baseContribution = await setting(db, "gws_q3_base_contribution_kboepd", 1.3);
  const bullContribution = await setting(db, "gws_q3_bull_contribution_kboepd", 1.8);

  return {
    enabled: true,
    coreKboepd,
    bearKboepd: coreKboepd + bearContribution,
    baseKboepd: coreKboepd + baseContribution,
    bullKboepd: coreKboepd + bullContribution,
    project: {
      name: "Garn West South",
      status: "expected-unconfirmed",
      initialNetKboepd: initialNet,
      contributionsKboepd: {
        bear: bearContribution,
        base: baseContribution,
        bull: bullContribution,
      },
      note:
        "Scenario overlay based on OKEA's Q2 2026 webcast: current plan was mid-August before the 2 September Draugen shutdown; initial net production was stated at approximately 6.5 kboepd and expected to decline. No start-up confirmation is assumed by the model.",
    },
  };
}

export async function calculateNowcast(db: D1Database, quarter: string) {
  const q = parseQuarter(quarter);
  const fields = await db
    .prepare(
      `SELECT field_key, display_name, tracker_share
       FROM fields WHERE active=1 ORDER BY display_name`,
    )
    .all<Field>();
  const rows = await loadProductionRows(db, q);

  const lookbackMonths = await setting(db, "production_baseline_lookback_months", 6);
  const anomalyFloorRatio = await setting(db, "production_anomaly_floor_ratio", 0.65);

  const currentByField = new Map<string, Map<number, ProductionRow>>();
  for (const row of rows.current) {
    if (!currentByField.has(row.field_key)) currentByField.set(row.field_key, new Map());
    currentByField.get(row.field_key)!.set(row.month, row);
  }

  const priorHistoryByField = new Map<string, ProductionRow[]>();
  for (const row of rows.prior) {
    if (!priorHistoryByField.has(row.field_key)) priorHistoryByField.set(row.field_key, []);
    priorHistoryByField.get(row.field_key)!.push(row);
  }

  let weightedKboeDays = 0;
  let quarterDays = 0;
  let actualMonthCount = 0;
  let crudeBoe = 0;
  let gasBoe = 0;
  let nglBoe = 0;
  const fieldDetail: Array<Record<string, unknown>> = [];

  for (const month of q.months) quarterDays += daysInMonth(q.year, month);

  for (const field of fields.results) {
    const monthMap = currentByField.get(field.field_key) ?? new Map();
    const priorHistory = priorHistoryByField.get(field.field_key) ?? [];
    const baseline = choosePreQuarterBaseline(priorHistory, lookbackMonths, anomalyFloorRatio);
    let lastActual: ProductionRow | null = null;
    let fieldWeighted = 0;
    const months: Array<Record<string, unknown>> = [];

    for (const month of q.months) {
      const actual = monthMap.get(month) ?? null;
      const source = actual ?? lastActual ?? baseline.row;
      const days = daysInMonth(q.year, month);
      if (actual) actualMonthCount += 1;

      if (!source) {
        months.push({ month, status: "missing", kboepd: null });
        continue;
      }

      const rate = Number(source.company_est_kboepd ?? 0);
      fieldWeighted += rate * days;
      weightedKboeDays += rate * days;

      if (actual) {
        const v = productVolumesFromRow(actual);
        crudeBoe += v.crudeBoe;
        gasBoe += v.gasBoe;
        nglBoe += v.nglBoe;
        lastActual = actual;
      } else {
        const sourceDays = daysInMonth(source.year, source.month);
        const v = productVolumesFromRow(source, days / sourceDays);
        crudeBoe += v.crudeBoe;
        gasBoe += v.gasBoe;
        nglBoe += v.nglBoe;
      }

      months.push({
        month,
        status: actual ? "actual" : "estimated",
        sourceMonth: actual ? periodLabel(q.year, month) : periodLabel(source.year, source.month),
        baselineMethod: actual
          ? "actual"
          : lastActual
            ? "carry-forward-current-quarter"
            : baseline.method,
        recentMedianKboepd: actual || lastActual ? undefined : round(baseline.medianRate),
        kboepd: round(rate),
      });
    }

    fieldDetail.push({
      fieldKey: field.field_key,
      field: field.display_name,
      quarterKboepd: round(fieldWeighted / quarterDays),
      baselineMethod: baseline.method,
      months,
    });
  }

  const eventRows = await db
    .prepare(
      `SELECT field_key, title, impact_kboepd, confidence, source_note
       FROM events
       WHERE quarter=? AND impact_kboepd IS NOT NULL AND status <> 'cancelled'
       ORDER BY event_date, id`,
    )
    .bind(quarter)
    .all<EventRow>();
  const eventAdjustment = eventRows.results.reduce(
    (sum, event) => sum + Number(event.impact_kboepd ?? 0),
    0,
  );

  const productionBase = quarterDays > 0 ? weightedKboeDays / quarterDays : 0;
  const coreProductionKboepd = Math.max(0, productionBase + eventAdjustment);
  const scenarios = await q3ProjectScenarios(db, quarter, coreProductionKboepd);
  const productionKboepd = scenarios.baseKboepd;

  // Keep product volumes consistent with the production bridge. Until event-specific
  // product composition is modelled, negative/positive core event adjustments are
  // applied pro-rata to the base field product mix. Q3 GWS is then added as crude-only.
  const coreVolumeScale = productionBase > 0 ? coreProductionKboepd / productionBase : 1;
  crudeBoe *= coreVolumeScale;
  gasBoe *= coreVolumeScale;
  nglBoe *= coreVolumeScale;
  const gwsBaseContribution = scenarios.project?.contributionsKboepd.base ?? 0;
  if (gwsBaseContribution > 0) {
    crudeBoe += gwsBaseContribution * quarterDays * 1_000;
  }

  const allRows = [...rows.current, ...rows.prior];
  const latestSource = allRows.reduce<ProductionRow | null>((latest, row) => {
    if (!latest) return row;
    return periodIndex(row.year, row.month) > periodIndex(latest.year, latest.month) ? row : latest;
  }, null);
  const now = new Date();
  const sourceLagMonths = latestSource
    ? Math.max(0, periodIndex(now.getUTCFullYear(), now.getUTCMonth() + 1) - periodIndex(latestSource.year, latestSource.month))
    : null;

  const explicitSold = await db
    .prepare(
      `SELECT value, signal_date, confidence, source_note
       FROM lifting_signals
       WHERE quarter=? AND signal_type='sold_ratio' AND value IS NOT NULL
       ORDER BY signal_date DESC, id DESC LIMIT 1`,
    )
    .bind(quarter)
    .first<{ value: number; signal_date: string; confidence: string; source_note: string }>();

  const soldRatio = explicitSold?.value ?? (await setting(db, "default_sold_ratio_base", 1));
  const soldKboepd = productionKboepd * soldRatio;

  const brent = await priceAverage(db, "brent_usd_bbl", q.startDate, q.endDate);
  const gas = await priceAverage(db, "gas_usd_boe", q.startDate, q.endDate);
  const ngl = await priceAverage(db, "ngl_usd_boe", q.startDate, q.endDate);

  const crudeBasis = await setting(db, "crude_basis_usd_bbl", 0);
  const gasBasisPct = await setting(db, "gas_basis_pct", 0);
  const nglBrentRatio = await setting(db, "ngl_brent_ratio", 0.66);

  const crudePrice = brent.value == null ? null : brent.value + crudeBasis;
  const gasPrice = gas.value == null ? null : gas.value * (1 + gasBasisPct);
  const nglPrice =
    ngl.value != null ? ngl.value : brent.value == null ? null : brent.value * nglBrentRatio;

  let petroleumRevenue: number | null = null;
  if (crudePrice != null && gasPrice != null && nglPrice != null) {
    petroleumRevenue =
      (crudeBoe * crudePrice + gasBoe * gasPrice + nglBoe * nglPrice) /
      1_000_000;
    petroleumRevenue *= soldRatio;
  }

  const hedges = await db
    .prepare(
      `SELECT commodity, hedge_share, floor_min, floor_max, cap_min, cap_max, unit, exposure_basis
       FROM hedge_positions WHERE quarter=? ORDER BY commodity`,
    )
    .bind(quarter)
    .all<Record<string, unknown>>();

  const hedgeSignals = hedges.results.map((h) => {
    const commodity = String(h.commodity);
    const market = commodity === "crude" ? crudePrice : commodity === "gas" ? gasPrice : null;
    const floor = Number(h.floor_max ?? h.floor_min ?? 0);
    const cap = Number(h.cap_min ?? h.cap_max ?? 0);
    let direction = "unknown";
    if (market != null && floor && market < floor) direction = "positive";
    else if (market != null && cap && market > cap) direction = "negative";
    else if (market != null) direction = "limited";
    return { ...h, market: round(market), direction };
  });

  const knownFieldMonths = fields.results.length * 3;
  const coverage = knownFieldMonths ? actualMonthCount / knownFieldMonths : 0;
  const productionConfidence = coverage >= 0.66 ? "high" : coverage >= 0.33 ? "medium" : "low";
  const liftingConfidence = explicitSold ? explicitSold.confidence : "low";
  const priceConfidence = brent.observations >= 20 && gas.observations >= 20 ? "high" : "low";

  const assumptions = {
    productionMethod:
      "Actual SODIR field months; if the quarter is not yet published, use a recent field baseline. A latest pre-quarter month below the anomaly threshold is replaced by the recent positive median so planned shutdown months are not treated as the new normal.",
    productionBaselineLookbackMonths: lookbackMonths,
    productionAnomalyFloorRatio: anomalyFloorRatio,
    latestSodirSourceMonth: latestSource ? periodLabel(latestSource.year, latestSource.month) : null,
    sodirLagMonths: sourceLagMonths,
    eventAdjustmentKboepd: round(eventAdjustment),
    eventAdjustments: eventRows.results.map((event) => ({
      fieldKey: event.field_key,
      title: event.title,
      impactKboepd: round(Number(event.impact_kboepd)),
      confidence: event.confidence,
      source: event.source_note,
    })),
    productionScenario: {
      coreKboepd: round(scenarios.coreKboepd),
      bearKboepd: round(scenarios.bearKboepd),
      baseKboepd: round(scenarios.baseKboepd),
      bullKboepd: round(scenarios.bullKboepd),
      project: scenarios.project,
    },
    volumeAdjustmentMethod:
      "Core event impact is applied pro-rata to product volumes until event-specific product mix is available. Q3 Garn West South base contribution is treated as crude-only.",
    soldRatio: round(soldRatio, 3),
    soldRatioSource: explicitSold
      ? `${explicitSold.signal_date}: ${explicitSold.source_note ?? "lifting signal"}`
      : "default_sold_ratio_base",
    crudeBasisUsdBbl: crudeBasis,
    gasBasisPct,
    nglMethod: ngl.value != null ? "direct price series" : "Brent ratio proxy",
    warning:
      "Revenue is withheld until both crude and gas price series exist. Hedge P/L is directional only until tranche notionals/settlement details are available.",
  };

  return {
    quarter,
    asOf: new Date().toISOString(),
    production: {
      kboepd: round(productionKboepd),
      coreKboepd: round(coreProductionKboepd),
      baseKboepd: round(productionBase),
      eventAdjustmentKboepd: round(eventAdjustment),
      coverage: round(coverage * 100, 1),
      confidence: productionConfidence,
      latestSourceMonth: latestSource ? periodLabel(latestSource.year, latestSource.month) : null,
      sourceLagMonths,
      scenarios: {
        bearKboepd: round(scenarios.bearKboepd),
        baseKboepd: round(scenarios.baseKboepd),
        bullKboepd: round(scenarios.bullKboepd),
        project: scenarios.project,
      },
      fields: fieldDetail,
    },
    lifting: {
      soldRatio: round(soldRatio, 3),
      soldKboepd: round(soldKboepd),
      confidence: liftingConfidence,
    },
    prices: {
      crudeUsdBbl: round(crudePrice),
      gasUsdBoe: round(gasPrice),
      nglUsdBoe: round(nglPrice),
      brent: { ...brent, value: round(brent.value) },
      gasSource: { ...gas, value: round(gas.value) },
      confidence: priceConfidence,
    },
    volumes: {
      crudeMboe: round(crudeBoe / 1_000),
      gasMboe: round(gasBoe / 1_000),
      nglMboe: round(nglBoe / 1_000),
    },
    petroleumRevenueUsdm: round(petroleumRevenue),
    hedges: hedgeSignals,
    assumptions,
  };
}

export async function saveNowcastSnapshot(db: D1Database, quarter: string) {
  const n = await calculateNowcast(db, quarter);
  await db
    .prepare(
      `INSERT INTO nowcast_snapshots(
        quarter, snapshot_at, production_kboepd, sold_kboepd,
        crude_usd_bbl, gas_usd_boe, ngl_usd_boe, petroleum_revenue_usdm,
        production_confidence, lifting_confidence, price_confidence,
        assumptions_json, model_version
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0.3.0')`,
    )
    .bind(
      quarter,
      n.asOf,
      n.production.kboepd,
      n.lifting.soldKboepd,
      n.prices.crudeUsdBbl,
      n.prices.gasUsdBoe,
      n.prices.nglUsdBoe,
      n.petroleumRevenueUsdm,
      n.production.confidence,
      n.lifting.confidence,
      n.prices.confidence,
      JSON.stringify(n.assumptions),
    )
    .run();
  return n;
}
