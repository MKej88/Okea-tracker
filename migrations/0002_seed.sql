INSERT OR REPLACE INTO fields
(field_key, sodir_name, display_name, operator, legal_wi, tracker_share, field_group, active, note)
VALUES
('draugen', 'DRAUGEN', 'Draugen', 'OKEA', 0.4456, 0.4456, 'Draugen', 1, 'Includes OKEA working interest. Satellite effects such as Hasselmus are monitored as events.'),
('brage', 'BRAGE', 'Brage', 'OKEA', 0.3520, 0.3520, 'Brage', 1, 'Garn West South is handled as an event within Brage.'),
('gjoa', 'GJOA', 'Gjøa', 'Vår Energi', 0.1200, 0.1200, 'Gjøa/Nova', 1, NULL),
('ivar-aasen', 'IVAR AASEN', 'Ivar Aasen', 'Aker BP', 0.092385, 0.092385, 'Ivar Aasen', 1, NULL),
('nova', 'NOVA', 'Nova', 'Harbour Energy Norge', 0.0600, 0.0600, 'Gjøa/Nova', 1, NULL),
('statfjord', 'STATFJORD', 'Statfjord', 'Equinor', 0.239312, 0.2800, 'Statfjord area', 1, 'Legal WI is 23.9312%; tracker_share uses 28% of the Norwegian share when applied to SODIR field production.'),
('statfjord-ost', 'STATFJORD ØST', 'Statfjord Øst', 'Equinor', 0.1400, 0.1400, 'Statfjord area', 1, NULL),
('statfjord-nord', 'STATFJORD NORD', 'Statfjord Nord', 'Equinor', 0.2800, 0.2800, 'Statfjord area', 1, NULL),
('sygna', 'SYGNA', 'Sygna', 'Equinor', 0.1540, 0.1540, 'Statfjord area', 1, NULL),
('bestla', 'BESTLA', 'Bestla', 'OKEA', 0.392788, 0.392788, 'Bestla', 1, 'Development field; production rows will appear only when SODIR reports production.');

INSERT OR REPLACE INTO model_settings(key, value, note) VALUES
('guidance_2026_min_kboepd', '29', 'OKEA Q2 2026 production guidance'),
('guidance_2026_max_kboepd', '32', 'OKEA Q2 2026 production guidance'),
('guidance_2027_min_kboepd', '39', 'OKEA Q2 2026 production guidance'),
('guidance_2027_max_kboepd', '43', 'OKEA Q2 2026 production guidance'),
('default_sold_ratio_base', '1.00', 'Backtest 5.0 baseline when no stronger lifting signal is available'),
('default_sold_ratio_bear', '0.95', 'Backtest 5.0 downside range'),
('default_sold_ratio_bull', '1.05', 'Backtest 5.0 upside range'),
('crude_basis_usd_bbl', '0', 'Start neutral; calibrated from reported OKEA crude vs Brent history'),
('gas_basis_pct', '-0.038', 'Initial rolling basis from the historical gas price backtest; update only from point-in-time observations'),
('ngl_brent_ratio', '0.66', 'Initial simple NGL proxy; intended for recalibration'),
('other_operating_income_usdm', '0', 'Manual/derived assumption used only when explicitly populated'),
('opex_usdm', '90', 'Placeholder central quarterly production cost assumption; replace with point-in-time model'),
('exploration_gna_usdm', '11', 'Placeholder combined quarterly exploration and G&A assumption; replace with point-in-time model');

INSERT INTO hedge_positions
(quarter, commodity, hedge_share, floor_min, floor_max, cap_min, cap_max, unit, exposure_basis, source_note, as_of_date)
VALUES
('2026Q3', 'crude', 0.75, 60, 60, 75, 85, 'USD/bbl', 'net post-tax exposure', 'OKEA Q2 2026 quarterly report', '2026-07-16'),
('2026Q3', 'gas', 0.70, 60, 95, 111, 195, 'USD/boe', 'net post-tax exposure', 'OKEA Q2 2026 quarterly report', '2026-07-16');

INSERT OR REPLACE INTO quarterly_actuals
(quarter, production_kboepd, sold_kboepd, crude_usd_bbl, gas_usd_boe, operating_income_usdm, ebitda_usdm, source_note, reported_at)
VALUES
('2025Q4', 30.8, 20.4, 62.1, 57.4, 107, 50, 'OKEA Q4 2025 quarterly report', '2026-02-03'),
('2026Q1', 34.9, 39.1, 79.5, 76.5, 239, 129, 'OKEA Q1 2026 quarterly report', '2026-04-29'),
('2026Q2', 27.0, 34.4, 116.9, 88.1, 334, 207, 'OKEA Q2 2026 quarterly report', '2026-07-16');

INSERT INTO events
(event_date, quarter, field_key, category, title, description, status, confidence, source_note)
VALUES
('2026-07-16', '2026Q3', 'brage', 'project', 'Garn West South', 'Management expected Garn West South contribution in Q3 2026. Keep as a separate event adjustment rather than silently embedding it in base production.', 'expected', 'medium', 'OKEA Q2 2026 quarterly report'),
('2026-07-16', '2026Q3', NULL, 'guidance', '2026 production guidance 29-32 kboepd', 'Full-year production guidance was reduced to 29-32 kboepd.', 'known', 'high', 'OKEA Q2 2026 quarterly report'),
('2026-07-16', '2027Q1', 'bestla', 'project', 'Bestla development', 'Bestla remains a separate project module. Production impact is not inserted until a dated public expectation is stored.', 'known', 'medium', 'OKEA Q2 2026 quarterly report');
