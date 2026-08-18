-- Q3 2026 Garn West South scenario assumptions.
-- These are tracker assumptions based on OKEA's Q2 2026 webcast, not formal guidance.
-- CEO said current plan was mid-August, before Draugen shutdown on 2 September,
-- and initial net production to OKEA would be approximately 6.5 kboepd.
-- The well was not publicly confirmed on stream when these assumptions were frozen.

INSERT OR REPLACE INTO model_settings(key, value, note) VALUES
('gws_q3_initial_net_kboepd', '6.5', 'OKEA Q2 2026 webcast: approximately 6.5 kboepd net to OKEA when on stream; initial rate, expected to decline.'),
('gws_q3_bear_contribution_kboepd', '0.0', 'Bear: no material Q3 contribution before/around the planned Draugen shutdown.'),
('gws_q3_base_contribution_kboepd', '1.3', 'Base: approximately 18 producing days at 6.5 kboepd before the 2 September shutdown, divided by 92 Q3 days. Tracker estimate, not company guidance.'),
('gws_q3_bull_contribution_kboepd', '1.8', 'Bull: mid-August start plus some late-September production after restart. Tracker estimate, not company guidance.');

UPDATE events
SET description = 'Current plan communicated on the Q2 2026 webcast was start-up around mid-August and before the planned Draugen shutdown on 2 September. Initial net production to OKEA was stated at approximately 6.5 kboepd, with rapid decline expected. The tracker keeps this as a scenario overlay until start-up is publicly confirmed.',
    source_note = 'OKEA Q2 2026 webcast, 16 July 2026, 00:27:13-00:27:44'
WHERE quarter='2026Q3' AND title='Garn West South';
