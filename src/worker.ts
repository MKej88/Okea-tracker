import { syncSodirProduction } from "./sources/sodir";
import { syncEiaBrent } from "./sources/eia";
import { calculateNowcast, parseQuarter, saveNowcastSnapshot } from "./model/nowcast";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV?: string;
  DEFAULT_QUARTER?: string;
  ADMIN_TOKEN?: string;
  EIA_API_KEY?: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ ok: false, error: message }, status);
}

function quarterFrom(url: URL, env: Env) {
  const quarter = url.searchParams.get("quarter") || env.DEFAULT_QUARTER || "2026Q3";
  parseQuarter(quarter);
  return quarter;
}

function isAdmin(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

async function requireAdmin(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) {
    return json(
      {
        ok: false,
        error: "ADMIN_TOKEN is not configured. Add it with `npx wrangler secret put ADMIN_TOKEN`.",
      },
      503,
    );
  }
  if (!isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
  return null;
}

async function overview(env: Env, quarter: string) {
  const nowcast = await calculateNowcast(env.DB, quarter);
  const guidance = await env.DB
    .prepare(
      `SELECT key, value, note FROM model_settings
       WHERE key LIKE 'guidance_%' ORDER BY key`,
    )
    .all();
  const events = await env.DB
    .prepare(
      `SELECT id, event_date, quarter, field_key, category, title, description,
              impact_kboepd, status, confidence, source_note
       FROM events
       WHERE quarter=? OR quarter IS NULL
       ORDER BY COALESCE(event_date,'9999-12-31'), id DESC LIMIT 8`,
    )
    .bind(quarter)
    .all();
  const actuals = await env.DB
    .prepare(
      `SELECT * FROM quarterly_actuals ORDER BY quarter DESC LIMIT 6`,
    )
    .all();
  const latestRuns = await env.DB
    .prepare(
      `SELECT source, started_at, finished_at, status, records_written, message
       FROM ingestion_runs ORDER BY id DESC LIMIT 6`,
    )
    .all();

  return {
    ok: true,
    quarter,
    nowcast,
    guidance: guidance.results,
    events: events.results,
    recentActuals: actuals.results,
    ingestion: latestRuns.results,
    modules: [
      { key: "production", label: "Produksjon", status: "live", source: "SODIR" },
      { key: "lifting", label: "Lifting / solgt volum", status: "model", source: "OKEA + signaler" },
      { key: "prices", label: "Olje og gass", status: nowcast.prices.brent.observations ? "partial" : "needs-data", source: "EIA + prisfeed" },
      { key: "hedging", label: "Hedging", status: "live", source: "OKEA rapporter" },
      { key: "nowcast", label: "Kvartalsestimat", status: "model", source: "samlet modell" },
      { key: "events", label: "Prosjekter / hendelser", status: "live", source: "OKEA / operatører" },
      { key: "backtest", label: "Backtest", status: "ready", source: "frosne snapshots" },
    ],
  };
}

async function productionApi(env: Env, quarter: string) {
  const q = parseQuarter(quarter);
  const rows = await env.DB
    .prepare(
      `SELECT p.field_key, f.display_name, f.operator, f.legal_wi, f.tracker_share,
              p.year, p.month, p.source_oe_mill_sm3, p.company_est_oe_mill_sm3,
              p.company_est_kboepd, p.fetched_at
       FROM production_monthly p
       JOIN fields f ON f.field_key=p.field_key
       WHERE p.year=? AND p.month BETWEEN ? AND ?
       ORDER BY p.month, f.display_name`,
    )
    .bind(q.year, q.months[0], q.months[2])
    .all();
  const fields = await env.DB
    .prepare(
      `SELECT field_key, sodir_name, display_name, operator, legal_wi, tracker_share,
              field_group, active, note
       FROM fields ORDER BY display_name`,
    )
    .all();
  const nowcast = await calculateNowcast(env.DB, quarter);
  return { ok: true, quarter, fields: fields.results, rows: rows.results, nowcast: nowcast.production };
}

async function marketApi(env: Env, quarter: string) {
  const q = parseQuarter(quarter);
  const prices = await env.DB
    .prepare(
      `SELECT price_date, kind, value, unit, source
       FROM price_daily
       WHERE price_date BETWEEN ? AND ?
       ORDER BY price_date, kind`,
    )
    .bind(q.startDate, q.endDate)
    .all();
  const hedges = await env.DB
    .prepare(
      `SELECT quarter, commodity, hedge_share, floor_min, floor_max, cap_min, cap_max,
              unit, exposure_basis, source_note, as_of_date
       FROM hedge_positions WHERE quarter=? ORDER BY commodity`,
    )
    .bind(quarter)
    .all();
  const nowcast = await calculateNowcast(env.DB, quarter);
  return { ok: true, quarter, prices: prices.results, hedges: hedges.results, nowcast: nowcast.prices, hedgeSignals: nowcast.hedges };
}

async function eventsApi(env: Env, quarter: string) {
  const rows = await env.DB
    .prepare(
      `SELECT e.*, f.display_name
       FROM events e LEFT JOIN fields f ON f.field_key=e.field_key
       WHERE e.quarter=? OR e.quarter IS NULL
       ORDER BY COALESCE(e.event_date,'9999-12-31'), e.id DESC`,
    )
    .bind(quarter)
    .all();
  return { ok: true, quarter, events: rows.results };
}

async function backtestApi(env: Env) {
  const backtests = await env.DB
    .prepare(`SELECT * FROM backtest_results ORDER BY quarter DESC, as_of_label`)
    .all();
  const actuals = await env.DB
    .prepare(`SELECT * FROM quarterly_actuals ORDER BY quarter`)
    .all();
  const snapshots = await env.DB
    .prepare(
      `SELECT id, quarter, snapshot_at, production_kboepd, sold_kboepd,
              crude_usd_bbl, gas_usd_boe, petroleum_revenue_usdm,
              production_confidence, lifting_confidence, price_confidence, model_version
       FROM nowcast_snapshots ORDER BY snapshot_at DESC LIMIT 200`,
    )
    .all();
  return { ok: true, results: backtests.results, actuals: actuals.results, snapshots: snapshots.results };
}

async function statusApi(env: Env) {
  const runs = await env.DB
    .prepare(`SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 50`)
    .all();
  const counts = await env.DB
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM production_monthly) AS production_rows,
        (SELECT COUNT(*) FROM price_daily) AS price_rows,
        (SELECT COUNT(*) FROM nowcast_snapshots) AS snapshots,
        (SELECT COUNT(*) FROM events) AS events`,
    )
    .first();
  return {
    ok: true,
    env: env.APP_ENV || "unknown",
    defaultQuarter: env.DEFAULT_QUARTER || "2026Q3",
    eiaConfigured: Boolean(env.EIA_API_KEY),
    adminConfigured: Boolean(env.ADMIN_TOKEN),
    counts,
    runs: runs.results,
  };
}

async function manualPrices(request: Request, env: Env) {
  const body = (await request.json()) as {
    rows?: Array<{ date: string; kind: string; value: number; unit: string; source?: string }>;
  };
  const allowed = new Set(["brent_usd_bbl", "gas_usd_boe", "ngl_usd_boe", "ttf_eur_mwh", "eurusd"]);
  const statements: D1PreparedStatement[] = [];
  for (const row of body.rows ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid date: ${row.date}`);
    if (!allowed.has(row.kind)) throw new Error(`Unsupported price kind: ${row.kind}`);
    if (!Number.isFinite(Number(row.value))) throw new Error(`Invalid value for ${row.kind}`);
    const source = row.source || "manual";
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO price_daily(price_date, kind, value, unit, source, fetched_at)
           VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
           ON CONFLICT(price_date, kind, source) DO UPDATE SET
             value=excluded.value, unit=excluded.unit, fetched_at=CURRENT_TIMESTAMP`,
        )
        .bind(row.date, row.kind, Number(row.value), row.unit, source),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return { ok: true, written: statements.length };
}

async function manualLiftingSignal(request: Request, env: Env) {
  const body = (await request.json()) as {
    quarter: string;
    signalDate: string;
    fieldKey?: string | null;
    signalType: string;
    value?: number | null;
    unit?: string | null;
    confidence?: string;
    sourceNote?: string;
    comment?: string;
  };
  parseQuarter(body.quarter);
  await env.DB
    .prepare(
      `INSERT INTO lifting_signals(
        quarter, signal_date, field_key, signal_type, value, unit,
        confidence, source_note, comment
       ) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      body.quarter,
      body.signalDate,
      body.fieldKey ?? null,
      body.signalType,
      body.value ?? null,
      body.unit ?? null,
      body.confidence ?? "medium",
      body.sourceNote ?? null,
      body.comment ?? null,
    )
    .run();
  return { ok: true };
}

async function manualEvent(request: Request, env: Env) {
  const body = (await request.json()) as {
    eventDate?: string | null;
    quarter?: string | null;
    fieldKey?: string | null;
    category: string;
    title: string;
    description?: string | null;
    impactKboepd?: number | null;
    status?: string;
    confidence?: string;
    sourceNote?: string | null;
  };
  if (body.quarter) parseQuarter(body.quarter);
  await env.DB
    .prepare(
      `INSERT INTO events(
        event_date, quarter, field_key, category, title, description,
        impact_kboepd, status, confidence, source_note
       ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      body.eventDate ?? null,
      body.quarter ?? null,
      body.fieldKey ?? null,
      body.category,
      body.title,
      body.description ?? null,
      body.impactKboepd ?? null,
      body.status ?? "known",
      body.confidence ?? "medium",
      body.sourceNote ?? null,
    )
    .run();
  return { ok: true };
}

async function manualConsensus(request: Request, env: Env) {
  const body = (await request.json()) as {
    quarter: string;
    metric: string;
    value: number;
    unit: string;
    source: string;
    estimateDate: string;
    note?: string;
  };
  parseQuarter(body.quarter);
  await env.DB
    .prepare(
      `INSERT INTO consensus_estimates(quarter, metric, value, unit, source, estimate_date, note)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(quarter, metric, source, estimate_date) DO UPDATE SET
         value=excluded.value, unit=excluded.unit, note=excluded.note`,
    )
    .bind(body.quarter, body.metric, body.value, body.unit, body.source, body.estimateDate, body.note ?? null)
    .run();
  return { ok: true };
}

async function routeApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const quarter = path === "/api/status" || path === "/api/health" || path === "/api/backtest" ? null : quarterFrom(url, env);

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, service: "okea-tracker", time: new Date().toISOString() });
  }
  if (request.method === "GET" && path === "/api/overview") return json(await overview(env, quarter!));
  if (request.method === "GET" && path === "/api/production") return json(await productionApi(env, quarter!));
  if (request.method === "GET" && path === "/api/market") return json(await marketApi(env, quarter!));
  if (request.method === "GET" && path === "/api/nowcast") return json({ ok: true, nowcast: await calculateNowcast(env.DB, quarter!) });
  if (request.method === "GET" && path === "/api/events") return json(await eventsApi(env, quarter!));
  if (request.method === "GET" && path === "/api/backtest") return json(await backtestApi(env));
  if (request.method === "GET" && path === "/api/status") return json(await statusApi(env));

  if (path.startsWith("/api/admin/")) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;

    if (request.method === "POST" && path === "/api/admin/sync-production") {
      const result = await syncSodirProduction(env.DB);
      return json(result);
    }
    if (request.method === "POST" && path === "/api/admin/sync-brent") {
      if (!env.EIA_API_KEY) return json({ ok: false, error: "EIA_API_KEY is not configured" }, 503);
      return json(await syncEiaBrent(env.DB, env.EIA_API_KEY));
    }
    if (request.method === "POST" && path === "/api/admin/recalculate") {
      return json({ ok: true, nowcast: await saveNowcastSnapshot(env.DB, quarter!) });
    }
    if (request.method === "POST" && path === "/api/admin/prices") return json(await manualPrices(request, env));
    if (request.method === "POST" && path === "/api/admin/lifting-signal") return json(await manualLiftingSignal(request, env));
    if (request.method === "POST" && path === "/api/admin/event") return json(await manualEvent(request, env));
    if (request.method === "POST" && path === "/api/admin/consensus") return json(await manualConsensus(request, env));
  }

  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await syncSodirProduction(env.DB);
        if (env.EIA_API_KEY) {
          try {
            await syncEiaBrent(env.DB, env.EIA_API_KEY);
          } catch (error) {
            console.error("EIA Brent sync failed", error);
          }
        }
        await saveNowcastSnapshot(env.DB, env.DEFAULT_QUARTER || "2026Q3");
      })(),
    );
  },
};
