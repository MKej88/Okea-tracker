-- Production nowcast fixes after first live Q3 2026 sync.
-- 1) SODIR's official field name is GJØA (not GJOA).
-- 2) Garn West South is a Draugen well.
-- 3) Add the publicly announced Q3 Draugen maintenance as an explicit model adjustment.

UPDATE fields
SET sodir_name = 'GJØA',
    updated_at = CURRENT_TIMESTAMP,
    note = COALESCE(note || ' ', '') || 'SODIR official field name corrected to GJØA.'
WHERE field_key = 'gjoa';

UPDATE events
SET field_key = 'draugen',
    description = 'Production from the Garn West South well at Draugen was expected in Q3 2026. No quantified production impact is applied until a public rate or dated production evidence is available.',
    source_note = 'OKEA Q2 2026 quarterly report, 16 July 2026'
WHERE quarter = '2026Q3' AND title = 'Garn West South';

INSERT INTO events(
  event_date, quarter, field_key, category, title, description,
  impact_kboepd, status, confidence, source_note
)
SELECT
  '2026-08-01', '2026Q3', 'draugen', 'maintenance',
  'Draugen planned Q3 maintenance and ESD test',
  'OKEA stated that a three-week maintenance shutdown would commence in September and that a separate half-week ESD test was scheduled for early August. The tracker converts 3.5 weeks of planned downtime at roughly 9 kboepd Draugen run-rate into an explicit quarter-average adjustment.',
  -2.4, 'expected', 'medium',
  'OKEA Q2 2026 quarterly report; -2.4 kboepd is a transparent tracker-derived estimate, not company guidance.'
WHERE NOT EXISTS (
  SELECT 1 FROM events
  WHERE quarter='2026Q3' AND title='Draugen planned Q3 maintenance and ESD test'
);

INSERT OR REPLACE INTO model_settings(key, value, note) VALUES
('production_baseline_lookback_months', '6', 'Missing-quarter months use a robust recent run-rate rather than blindly carrying a shutdown month.'),
('production_anomaly_floor_ratio', '0.65', 'If the latest pre-quarter field rate is below 65% of the recent positive median, use the robust median baseline instead.');
