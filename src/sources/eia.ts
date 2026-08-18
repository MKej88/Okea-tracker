const EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/spt/data/";

type EiaRow = {
  period: string;
  value: string | number;
  series?: string;
  units?: string;
};

export async function syncEiaBrent(
  db: D1Database,
  apiKey: string,
  options: { start?: string; end?: string } = {},
) {
  if (!apiKey) throw new Error("EIA_API_KEY is not configured");

  const startedAt = new Date().toISOString();
  const run = await db
    .prepare(
      `INSERT INTO ingestion_runs(source, started_at, status, records_written)
       VALUES('EIA Brent', ?, 'running', 0) RETURNING id`,
    )
    .bind(startedAt)
    .first<{ id: number }>();

  try {
    const now = new Date();
    const start =
      options.start ??
      `${now.getUTCFullYear() - 2}-01-01`;
    const end = options.end ?? now.toISOString().slice(0, 10);

    const params = new URLSearchParams();
    params.set("api_key", apiKey);
    params.set("frequency", "daily");
    params.append("data[0]", "value");
    params.append("facets[series][]", "RBRTE");
    params.set("start", start);
    params.set("end", end);
    params.set("sort[0][column]", "period");
    params.set("sort[0][direction]", "asc");
    params.set("offset", "0");
    params.set("length", "5000");

    const response = await fetch(`${EIA_BASE}?${params.toString()}`, {
      headers: { "user-agent": "okea-tracker/0.1" },
    });
    if (!response.ok) throw new Error(`EIA HTTP ${response.status}`);

    const payload = (await response.json()) as {
      response?: { data?: EiaRow[] };
      error?: string;
    };
    if (payload.error) throw new Error(payload.error);

    const statements: D1PreparedStatement[] = [];
    for (const row of payload.response?.data ?? []) {
      const value = Number(row.value);
      if (!row.period || !Number.isFinite(value)) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO price_daily(price_date, kind, value, unit, source, fetched_at)
             VALUES(?, 'brent_usd_bbl', ?, 'USD/bbl', 'EIA RBRTE', CURRENT_TIMESTAMP)
             ON CONFLICT(price_date, kind, source) DO UPDATE SET
               value=excluded.value, unit=excluded.unit, fetched_at=CURRENT_TIMESTAMP`,
          )
          .bind(row.period.slice(0, 10), value),
      );
    }

    for (let i = 0; i < statements.length; i += 80) {
      await db.batch(statements.slice(i, i + 80));
    }

    await db
      .prepare(
        `UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, status='ok',
         records_written=?, message=? WHERE id=?`,
      )
      .bind(statements.length, `${start} to ${end}`, run?.id)
      .run();

    return { ok: true, written: statements.length, start, end };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) {
      await db
        .prepare(
          `UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, status='error', message=? WHERE id=?`,
        )
        .bind(message, run.id)
        .run();
    }
    throw error;
  }
}
