const SODIR_PROFILES_URL =
  "https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer/7300/query";

const BOE_PER_SM3_OE = 6.29;

type FieldRow = {
  field_key: string;
  sodir_name: string;
  tracker_share: number;
};

type SodirAttributes = {
  prfYear: number;
  prfMonth: number;
  prfInformationCarrier: string;
  prfPrdOilNetMillSm3?: number | null;
  prfPrdGasNetBillSm3?: number | null;
  prfPrdNGLNetMillSm3?: number | null;
  prfPrdCondensateNetMillSm3?: number | null;
  prfPrdOeNetMillSm3?: number | null;
};

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

export async function syncSodirProduction(
  db: D1Database,
  options: { fromYear?: number } = {},
) {
  const startedAt = new Date().toISOString();
  const run = await db
    .prepare(
      `INSERT INTO ingestion_runs(source, started_at, status, records_written)
       VALUES('SODIR production', ?, 'running', 0) RETURNING id`,
    )
    .bind(startedAt)
    .first<{ id: number }>();

  try {
    const fields = await db
      .prepare(
        `SELECT field_key, sodir_name, tracker_share
         FROM fields WHERE active = 1 ORDER BY sodir_name`,
      )
      .all<FieldRow>();

    if (!fields.results.length) {
      throw new Error("No active fields configured");
    }

    const fromYear = options.fromYear ?? new Date().getUTCFullYear() - 3;
    const names = fields.results
      .map((f) => `'${escapeSqlLiteral(f.sodir_name)}'`)
      .join(",");

    const params = new URLSearchParams({
      where: `prfInformationCarrier IN (${names}) AND prfYear >= ${fromYear} AND prfMonth > 0`,
      outFields: [
        "prfYear",
        "prfMonth",
        "prfInformationCarrier",
        "prfPrdOilNetMillSm3",
        "prfPrdGasNetBillSm3",
        "prfPrdNGLNetMillSm3",
        "prfPrdCondensateNetMillSm3",
        "prfPrdOeNetMillSm3",
      ].join(","),
      returnGeometry: "false",
      orderByFields: "prfYear,prfMonth,prfInformationCarrier",
      f: "json",
    });

    const response = await fetch(`${SODIR_PROFILES_URL}?${params.toString()}`, {
      headers: { "user-agent": "okea-tracker/0.1" },
    });
    if (!response.ok) {
      throw new Error(`SODIR HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      features?: Array<{ attributes: SodirAttributes }>;
      error?: { message?: string };
    };
    if (payload.error) {
      throw new Error(payload.error.message || "SODIR query failed");
    }

    const byName = new Map(fields.results.map((f) => [f.sodir_name, f]));
    const statements: D1PreparedStatement[] = [];

    for (const feature of payload.features ?? []) {
      const a = feature.attributes;
      const field = byName.get(a.prfInformationCarrier);
      if (!field || !a.prfYear || !a.prfMonth) continue;

      const sourceOe = Number(a.prfPrdOeNetMillSm3 ?? 0);
      const companyOe = sourceOe * Number(field.tracker_share);
      const kboepd =
        companyOe > 0
          ? (companyOe * 1_000_000 * BOE_PER_SM3_OE) /
            daysInMonth(a.prfYear, a.prfMonth) /
            1_000
          : 0;

      statements.push(
        db
          .prepare(
            `INSERT INTO production_monthly(
              field_key, year, month,
              source_oe_mill_sm3, source_oil_mill_sm3, source_gas_bill_sm3,
              source_ngl_mill_sm3, source_cond_mill_sm3,
              company_est_oe_mill_sm3, company_est_kboepd, source, fetched_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(field_key, year, month) DO UPDATE SET
              source_oe_mill_sm3=excluded.source_oe_mill_sm3,
              source_oil_mill_sm3=excluded.source_oil_mill_sm3,
              source_gas_bill_sm3=excluded.source_gas_bill_sm3,
              source_ngl_mill_sm3=excluded.source_ngl_mill_sm3,
              source_cond_mill_sm3=excluded.source_cond_mill_sm3,
              company_est_oe_mill_sm3=excluded.company_est_oe_mill_sm3,
              company_est_kboepd=excluded.company_est_kboepd,
              source=excluded.source,
              fetched_at=CURRENT_TIMESTAMP`,
          )
          .bind(
            field.field_key,
            a.prfYear,
            a.prfMonth,
            sourceOe,
            Number(a.prfPrdOilNetMillSm3 ?? 0),
            Number(a.prfPrdGasNetBillSm3 ?? 0),
            Number(a.prfPrdNGLNetMillSm3 ?? 0),
            Number(a.prfPrdCondensateNetMillSm3 ?? 0),
            companyOe,
            kboepd,
            "SODIR profiles 7300",
          ),
      );
    }

    for (let i = 0; i < statements.length; i += 80) {
      await db.batch(statements.slice(i, i + 80));
    }

    const written = statements.length;
    await db
      .prepare(
        `UPDATE ingestion_runs
         SET finished_at=CURRENT_TIMESTAMP, status='ok', records_written=?, message=?
         WHERE id=?`,
      )
      .bind(written, `Fetched from ${fromYear}; ${written} field-month rows`, run?.id)
      .run();

    return { ok: true, written, fromYear };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) {
      await db
        .prepare(
          `UPDATE ingestion_runs
           SET finished_at=CURRENT_TIMESTAMP, status='error', message=? WHERE id=?`,
        )
        .bind(message, run.id)
        .run();
    }
    throw error;
  }
}
