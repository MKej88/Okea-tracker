PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fields (
  field_key TEXT PRIMARY KEY,
  sodir_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  operator TEXT,
  legal_wi REAL NOT NULL,
  tracker_share REAL NOT NULL,
  field_group TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_monthly (
  field_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  source_oe_mill_sm3 REAL,
  source_oil_mill_sm3 REAL,
  source_gas_bill_sm3 REAL,
  source_ngl_mill_sm3 REAL,
  source_cond_mill_sm3 REAL,
  company_est_oe_mill_sm3 REAL,
  company_est_kboepd REAL,
  source TEXT NOT NULL DEFAULT 'SODIR profiles 7300',
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (field_key, year, month),
  FOREIGN KEY (field_key) REFERENCES fields(field_key)
);

CREATE INDEX IF NOT EXISTS idx_production_period ON production_monthly(year, month);

CREATE TABLE IF NOT EXISTS price_daily (
  price_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (price_date, kind, source)
);

CREATE INDEX IF NOT EXISTS idx_price_kind_date ON price_daily(kind, price_date);

CREATE TABLE IF NOT EXISTS hedge_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,
  commodity TEXT NOT NULL,
  hedge_share REAL,
  floor_min REAL,
  floor_max REAL,
  cap_min REAL,
  cap_max REAL,
  unit TEXT NOT NULL DEFAULT 'USD/boe',
  exposure_basis TEXT,
  source_note TEXT,
  as_of_date TEXT,
  UNIQUE(quarter, commodity, source_note)
);

CREATE TABLE IF NOT EXISTS lifting_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,
  signal_date TEXT NOT NULL,
  field_key TEXT,
  signal_type TEXT NOT NULL,
  value REAL,
  unit TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source_note TEXT,
  comment TEXT,
  FOREIGN KEY (field_key) REFERENCES fields(field_key)
);

CREATE INDEX IF NOT EXISTS idx_lifting_quarter ON lifting_signals(quarter, signal_date);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT,
  quarter TEXT,
  field_key TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  impact_kboepd REAL,
  status TEXT NOT NULL DEFAULT 'known',
  confidence TEXT NOT NULL DEFAULT 'medium',
  source_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (field_key) REFERENCES fields(field_key)
);

CREATE INDEX IF NOT EXISTS idx_events_quarter ON events(quarter, event_date);

CREATE TABLE IF NOT EXISTS consensus_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  source TEXT NOT NULL,
  estimate_date TEXT NOT NULL,
  note TEXT,
  UNIQUE(quarter, metric, source, estimate_date)
);

CREATE TABLE IF NOT EXISTS quarterly_actuals (
  quarter TEXT PRIMARY KEY,
  production_kboepd REAL,
  sold_kboepd REAL,
  crude_usd_bbl REAL,
  gas_usd_boe REAL,
  ngl_usd_boe REAL,
  operating_income_usdm REAL,
  ebitda_usdm REAL,
  source_note TEXT,
  reported_at TEXT
);

CREATE TABLE IF NOT EXISTS model_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT
);

CREATE TABLE IF NOT EXISTS nowcast_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  production_kboepd REAL,
  sold_kboepd REAL,
  crude_usd_bbl REAL,
  gas_usd_boe REAL,
  ngl_usd_boe REAL,
  petroleum_revenue_usdm REAL,
  hedge_pnl_low_usdm REAL,
  hedge_pnl_high_usdm REAL,
  operating_income_low_usdm REAL,
  operating_income_high_usdm REAL,
  ebitda_low_usdm REAL,
  ebitda_high_usdm REAL,
  production_confidence TEXT,
  lifting_confidence TEXT,
  price_confidence TEXT,
  assumptions_json TEXT,
  model_version TEXT NOT NULL DEFAULT '0.1.0'
);

CREATE INDEX IF NOT EXISTS idx_nowcast_quarter_time ON nowcast_snapshots(quarter, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,
  model_version TEXT NOT NULL,
  as_of_label TEXT NOT NULL,
  estimated_production_kboepd REAL,
  actual_production_kboepd REAL,
  estimated_sold_kboepd REAL,
  actual_sold_kboepd REAL,
  estimated_operating_income_usdm REAL,
  actual_operating_income_usdm REAL,
  market_operating_income_usdm REAL,
  note TEXT,
  UNIQUE(quarter, model_version, as_of_label)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  records_written INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_source_time ON ingestion_runs(source, started_at DESC);
