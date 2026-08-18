const state = {
  view: location.hash.replace('#/', '') || 'overview',
  quarter: localStorage.getItem('okea-quarter') || '2026Q3',
};

const titleMap = {
  overview: 'Oversikt',
  production: 'Produksjon',
  market: 'Olje, gass & hedge',
  nowcast: 'Kvartalsestimat',
  events: 'Prosjekter & hendelser',
  backtest: 'Backtest',
  status: 'Datastatus',
};

const $ = (selector) => document.querySelector(selector);
const content = $('#content');
const loading = $('#loading');
const errorBox = $('#error');
const quarterSelect = $('#quarter');

quarterSelect.value = state.quarter;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmt(value, digits = 1, fallback = '—') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
  return Number(value).toLocaleString('nb-NO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  return `${fmt(Number(value) * 100, digits)} %`;
}

function badge(text, kind = 'info') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

function confidenceBadge(value) {
  const v = String(value || 'ukjent').toLowerCase();
  const kind = v === 'high' ? 'good' : v === 'medium' ? 'warn' : v === 'low' ? 'bad' : 'info';
  const label = v === 'high' ? 'Høy' : v === 'medium' ? 'Middels' : v === 'low' ? 'Lav' : value || 'Ukjent';
  return badge(label, kind);
}

async function api(path) {
  const joiner = path.includes('?') ? '&' : '?';
  const needsQuarter = !path.startsWith('/api/status') && !path.startsWith('/api/backtest') && !path.startsWith('/api/health');
  const url = needsQuarter ? `${path}${joiner}quarter=${encodeURIComponent(state.quarter)}` : path;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function kpi(label, value, unit = '', meta = '', accent = false) {
  return `<article class="kpi-card ${accent ? 'accent' : ''}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    <div class="kpi-meta">${meta}</div>
  </article>`;
}

function fieldBars(fields = []) {
  if (!fields.length) return '<div class="empty">Ingen produksjonsdata ennå. Kjør første SODIR-synk.</div>';
  const max = Math.max(...fields.map((f) => Number(f.quarterKboepd || 0)), 1);
  return `<div class="field-list">${fields
    .filter((f) => Number(f.quarterKboepd || 0) > 0)
    .sort((a, b) => Number(b.quarterKboepd || 0) - Number(a.quarterKboepd || 0))
    .map((f) => `<div class="field-row">
      <div class="name">${esc(f.field)}</div>
      <div class="bar"><span style="width:${Math.max(2, Number(f.quarterKboepd || 0) / max * 100)}%"></span></div>
      <div class="value">${fmt(f.quarterKboepd, 2)}</div>
    </div>`).join('')}</div>`;
}

function lineChart(rows, valueKey = 'value') {
  const pts = rows
    .map((r) => ({ x: new Date(r.price_date || r.date).getTime(), y: Number(r[valueKey]) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return '<div class="empty">For få datapunkter til graf.</div>';
  const width = 760, height = 210, padX = 34, padY = 20;
  const minX = pts[0].x, maxX = pts[pts.length - 1].x;
  const ys = pts.map((p) => p.y), minY0 = Math.min(...ys), maxY0 = Math.max(...ys);
  const span = Math.max(maxY0 - minY0, 1);
  const minY = minY0 - span * .08, maxY = maxY0 + span * .08;
  const sx = (x) => padX + (x - minX) / Math.max(maxX - minX, 1) * (width - padX * 2);
  const sy = (y) => height - padY - (y - minY) / (maxY - minY) * (height - padY * 2);
  const points = pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map((t) => {
    const y = padY + t * (height - padY * 2);
    const val = maxY - t * (maxY - minY);
    return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" class="chart-grid"/>
      <text x="2" y="${y + 3}" class="chart-label">${fmt(val, 0)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Prisgraf">
    ${grid}
    <polyline points="${points}" class="chart-line"/>
  </svg>`;
}

function guidanceRange(rows = []) {
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  if (state.quarter.startsWith('2026')) return `${fmt(map.guidance_2026_min_kboepd, 0)}–${fmt(map.guidance_2026_max_kboepd, 0)}`;
  if (state.quarter.startsWith('2027')) return `${fmt(map.guidance_2027_min_kboepd, 0)}–${fmt(map.guidance_2027_max_kboepd, 0)}`;
  return '—';
}

async function renderOverview() {
  const d = await api('/api/overview');
  const n = d.nowcast;
  const revenue = n.petroleumRevenueUsdm == null ? '—' : fmt(n.petroleumRevenueUsdm, 0);
  const priceMeta = n.prices.crudeUsdBbl == null
    ? 'Prisfeed mangler'
    : `Gass ${fmt(n.prices.gasUsdBoe, 1)} USD/boe`;

  content.innerHTML = `
    <div class="hero-grid">
      ${kpi('Produksjon nowcast', fmt(n.production.kboepd, 1), 'kboepd', `${confidenceBadge(n.production.confidence)} · ${fmt(n.production.coverage, 0)} % felt-månedsdekning`, true)}
      ${kpi('Solgt volum', fmt(n.lifting.soldKboepd, 1), 'kboepd', `${confidenceBadge(n.lifting.confidence)} · ratio ${fmt(n.lifting.soldRatio, 2)}×`)}
      ${kpi('Realisert crude E', fmt(n.prices.crudeUsdBbl, 1), 'USD/fat', priceMeta)}
      ${kpi('Petroleumsinntekt E', revenue, 'USDm', n.petroleumRevenueUsdm == null ? 'Holdes tilbake til olje- og gasspris finnes' : confidenceBadge(n.prices.confidence))}
    </div>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><div><h2>Produksjonsbidrag</h2><p>Estimert OKEA-andel per felt i ${esc(state.quarter)}</p></div>${confidenceBadge(n.production.confidence)}</div>
        ${fieldBars(n.production.fields)}
        <div class="source">SODIR profiles 7300 × tracker-andel. Manglende måneder viderefører siste kjente feltrate.</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Guidance</h2><p>Årsproduksjon</p></div></div>
        <div class="kpi-value">${guidanceRange(d.guidance)} <small>kboepd</small></div>
        <p class="muted small">Trackeren holder formell guidance separat fra selve kvartals-nowcasten.</p>
        <div class="callout ${n.production.kboepd ? '' : 'warn'}">Q-nowcast: <strong>${fmt(n.production.kboepd, 1)} kboepd</strong>. Dette er ikke samme mål som helårsguidance.</div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><div><h2>Moduler</h2><p>Datakvalitet og modellstatus</p></div></div>
      <div class="module-grid">${d.modules.map((m) => `<div class="module-card">
        <strong>${esc(m.label)}</strong>
        <span>${badge(m.status, m.status === 'live' ? 'good' : m.status === 'needs-data' ? 'bad' : 'warn')} ${esc(m.source)}</span>
      </div>`).join('')}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Nærmeste hendelser</h2><p>Kun eksplisitt lagrede hendelser påvirker modellen</p></div></div>
      ${renderEventList(d.events)}
    </section>`;
}

async function renderProduction() {
  const d = await api('/api/production');
  const detail = d.nowcast.fields || [];
  const monthHeaders = [...new Set(detail.flatMap((f) => f.months.map((m) => m.month)))].sort();
  content.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Q-nowcast', fmt(d.nowcast.kboepd, 2), 'kboepd', confidenceBadge(d.nowcast.confidence), true)}
      ${kpi('Datadekning', fmt(d.nowcast.coverage, 0), '%', 'Andel felt-måneder med faktisk SODIR-data')}
      ${kpi('Felt i modell', fmt(d.fields.filter((f) => f.active).length, 0), '', 'Aktive OKEA-felt')}
      ${kpi('SODIR-rader', fmt(d.rows.length, 0), '', `Lagret for ${esc(state.quarter)}`)}
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Felt for felt</h2><p>Faktisk måned hvis tilgjengelig, ellers siste kjente run-rate</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Felt</th>${monthHeaders.map((m) => `<th class="numeric">M${m}</th>`).join('')}<th class="numeric">Kvartal E</th></tr></thead>
      <tbody>${detail.map((f) => `<tr><td>${esc(f.field)}</td>${monthHeaders.map((m) => {
        const row = f.months.find((x) => x.month === m);
        const marker = row?.status === 'actual' ? '' : row?.status === 'estimated' ? ' E' : '';
        return `<td class="numeric">${fmt(row?.kboepd, 2)}${marker}</td>`;
      }).join('')}<td class="numeric"><strong>${fmt(f.quarterKboepd, 2)}</strong></td></tr>`).join('')}</tbody></table></div>
      <div class="source">E = estimert ved carry-forward. Statfjord bruker egen tracker-andel fordi SODIR-data og juridisk unit-andel må behandles særskilt.</div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Eierandeler i produksjonsmodellen</h2><p>Legal WI og andel brukt mot SODIR</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Felt</th><th>Operatør</th><th class="numeric">Legal WI</th><th class="numeric">Tracker-andel</th><th>Merknad</th></tr></thead><tbody>
        ${d.fields.map((f) => `<tr><td>${esc(f.display_name)}</td><td>${esc(f.operator || '—')}</td><td class="numeric">${pct(f.legal_wi, 2)}</td><td class="numeric">${pct(f.tracker_share, 2)}</td><td>${esc(f.note || '')}</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;
}

async function renderMarket() {
  const d = await api('/api/market');
  const brentRows = d.prices.filter((p) => p.kind === 'brent_usd_bbl');
  const gasRows = d.prices.filter((p) => p.kind === 'gas_usd_boe');
  content.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Crude E', fmt(d.nowcast.crudeUsdBbl, 1), 'USD/fat', `${d.nowcast.brent.observations || 0} Brent-observasjoner`, true)}
      ${kpi('Gass E', fmt(d.nowcast.gasUsdBoe, 1), 'USD/boe', `${d.nowcast.gasSource.observations || 0} prisobservasjoner`)}
      ${kpi('NGL E', fmt(d.nowcast.nglUsdBoe, 1), 'USD/boe', 'Direkte feed eller Brent-proxy')}
      ${kpi('Priskonfidens', d.nowcast.confidence === 'high' ? 'Høy' : 'Lav', '', confidenceBadge(d.nowcast.confidence))}
    </div>
    <div class="two-col">
      <section class="panel"><div class="panel-head"><div><h2>Brent</h2><p>Daglig prisserie lagret i D1</p></div></div>${lineChart(brentRows)}<div class="source">Primær adapter: EIA RBRTE. EIA-nøkkel er gratis, men må legges inn som Cloudflare secret.</div></section>
      <section class="panel"><div class="panel-head"><div><h2>Gass</h2><p>USD/boe-pris brukt i modellen</p></div></div>${lineChart(gasRows)}<div class="source">Gassfeed er kildeadapter, ikke hardkodet. Inntil automatisk kilde er valgt kan data mates via admin-API.</div></section>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Hedgeposisjoner</h2><p>Formell offentlig hedgeinformasjon</p></div></div>
      ${d.hedges.length ? `<div class="table-wrap"><table><thead><tr><th>Råvare</th><th class="numeric">Andel</th><th class="numeric">Gulv</th><th class="numeric">Tak</th><th>Basis</th><th>Signal</th></tr></thead><tbody>
        ${d.hedges.map((h) => {
          const sig = d.hedgeSignals.find((x) => x.commodity === h.commodity) || {};
          const kind = sig.direction === 'positive' ? 'good' : sig.direction === 'negative' ? 'bad' : 'warn';
          return `<tr><td>${esc(h.commodity)}</td><td class="numeric">${pct(h.hedge_share, 0)}</td><td class="numeric">${fmt(h.floor_min, 0)}–${fmt(h.floor_max, 0)}</td><td class="numeric">${fmt(h.cap_min, 0)}–${fmt(h.cap_max, 0)}</td><td>${esc(h.exposure_basis || '')}</td><td>${badge(sig.direction || 'ukjent', kind)}</td></tr>`;
        }).join('')}
      </tbody></table></div>` : '<div class="empty">Ingen hedgeposisjoner lagret for kvartalet.</div>'}
      <div class="source">Hedge-P/L vises foreløpig som retning/range. Eksakt P/L krever tranche-notionaler og settlementdetaljer som ikke alltid er offentlig oppgitt.</div>
    </section>`;
}

async function renderNowcast() {
  const d = await api('/api/nowcast');
  const n = d.nowcast;
  const a = n.assumptions || {};
  content.innerHTML = `
    <div class="hero-grid">
      ${kpi('Produksjon', fmt(n.production.kboepd, 2), 'kboepd', confidenceBadge(n.production.confidence), true)}
      ${kpi('Solgt volum', fmt(n.lifting.soldKboepd, 2), 'kboepd', `${fmt(n.lifting.soldRatio, 2)}× produksjon`)}
      ${kpi('Petroleumsinntekt', fmt(n.petroleumRevenueUsdm, 0), 'USDm', n.petroleumRevenueUsdm == null ? 'Ikke beregnet før nødvendig prisdata finnes' : confidenceBadge(n.prices.confidence))}
      ${kpi('Prisdekning', n.prices.confidence === 'high' ? 'Høy' : 'Lav', '', `${n.prices.brent.observations || 0} Brent · ${n.prices.gasSource.observations || 0} gass`)}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><div><h2>Nowcast-bro</h2><p>Fra fysisk produksjon til kvartalsestimat</p></div></div>
        <div class="assumptions">
          <div class="assumption"><span>1. Produksjon</span><strong>${fmt(n.production.baseKboepd, 2)} kboepd + ${fmt(a.eventAdjustmentKboepd, 2)} eventjustering</strong></div>
          <div class="assumption"><span>2. Lifting</span><strong>${fmt(a.soldRatio, 2)}× · ${esc(a.soldRatioSource)}</strong></div>
          <div class="assumption"><span>3. Crude</span><strong>${fmt(n.prices.crudeUsdBbl, 1)} USD/fat · basis ${fmt(a.crudeBasisUsdBbl, 1)}</strong></div>
          <div class="assumption"><span>4. Gass</span><strong>${fmt(n.prices.gasUsdBoe, 1)} USD/boe · basis ${fmt((a.gasBasisPct || 0) * 100, 1)} %</strong></div>
          <div class="assumption"><span>5. Hedge</span><strong>Retningssignal nå; eksakt P/L låses først når nok offentlig detalj finnes</strong></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Modellkontroll</h2><p>Ingen skjult etterpåklokskap</p></div></div>
        <p class="callout">Hver planlagte kjøring lagrer et tidsstemplet snapshot. Det gjør Q3 2026 til første rene out-of-sample-periode.</p>
        <p class="muted small">${esc(a.warning || '')}</p>
        <div class="three-col">
          <div>${confidenceBadge(n.production.confidence)}<p class="small muted">Produksjon</p></div>
          <div>${confidenceBadge(n.lifting.confidence)}<p class="small muted">Lifting</p></div>
          <div>${confidenceBadge(n.prices.confidence)}<p class="small muted">Pris</p></div>
        </div>
      </section>
    </div>
    <section class="panel"><div class="panel-head"><div><h2>Feltbidrag</h2><p>Underliggende produksjonsmotor</p></div></div>${fieldBars(n.production.fields)}</section>`;
}

function renderEventList(events = []) {
  if (!events.length) return '<div class="empty">Ingen hendelser lagret for kvartalet.</div>';
  return `<div class="timeline">${events.map((e) => `<div class="event">
    <div class="event-date">${esc(e.event_date || e.quarter || 'Udatert')}</div>
    <div><h3>${esc(e.title)}</h3><p>${esc(e.description || '')}</p><div class="source">${esc(e.source_note || '')}</div></div>
    <div>${badge(e.status || 'known', e.status === 'cancelled' ? 'bad' : e.confidence === 'high' ? 'good' : 'warn')}</div>
  </div>`).join('')}</div>`;
}

async function renderEvents() {
  const d = await api('/api/events');
  content.innerHTML = `<section class="panel">
    <div class="panel-head"><div><h2>Hendelsesregister</h2><p>Vedlikehold, brønner, prosjekter, guidance og lifting</p></div><span>${d.events.length} hendelser</span></div>
    ${renderEventList(d.events)}
    <div class="source">En hendelse påvirker ikke produksjonstall automatisk med mindre impact_kboepd er eksplisitt satt. Dette reduserer risikoen for etterpåklokskap.</div>
  </section>`;
}

async function renderBacktest() {
  const d = await api('/api/backtest');
  const rows = d.results || [];
  content.innerHTML = `
    <section class="panel">
      <div class="panel-head"><div><h2>Historiske fasittall</h2><p>Brukes til å måle frosne nowcast-snapshots</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Kvartal</th><th class="numeric">Produksjon</th><th class="numeric">Solgt</th><th class="numeric">Crude</th><th class="numeric">Gass</th><th class="numeric">Driftsinntekt</th><th class="numeric">EBITDA</th></tr></thead><tbody>
        ${d.actuals.map((a) => `<tr><td>${esc(a.quarter)}</td><td class="numeric">${fmt(a.production_kboepd, 1)}</td><td class="numeric">${fmt(a.sold_kboepd, 1)}</td><td class="numeric">${fmt(a.crude_usd_bbl, 1)}</td><td class="numeric">${fmt(a.gas_usd_boe, 1)}</td><td class="numeric">${fmt(a.operating_income_usdm, 0)}</td><td class="numeric">${fmt(a.ebitda_usdm, 0)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Point-in-time backtest</h2><p>Modellestimat sammenlignet med faktisk og konsensus</p></div></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Kvartal</th><th>As-of</th><th class="numeric">Prod E</th><th class="numeric">Prod faktisk</th><th class="numeric">OI E</th><th class="numeric">OI faktisk</th><th class="numeric">Marked</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.quarter)}</td><td>${esc(r.as_of_label)}</td><td class="numeric">${fmt(r.estimated_production_kboepd, 2)}</td><td class="numeric">${fmt(r.actual_production_kboepd, 2)}</td><td class="numeric">${fmt(r.estimated_operating_income_usdm, 0)}</td><td class="numeric">${fmt(r.actual_operating_income_usdm, 0)}</td><td class="numeric">${fmt(r.market_operating_income_usdm, 0)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Historiske 1.0–6.0-resultater er ikke hardkodet. Fra deploy lagres frosne snapshots, slik at Backtest-siden blir point-in-time uten etterpåklokskap.</div>'}
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Frosne snapshots</h2><p>${d.snapshots.length} lagrede modellkjøringer</p></div></div>
      ${d.snapshots.length ? `<div class="table-wrap"><table><thead><tr><th>Tid</th><th>Kvartal</th><th class="numeric">Produksjon</th><th class="numeric">Solgt</th><th class="numeric">Crude</th><th class="numeric">Gass</th><th class="numeric">Revenue</th></tr></thead><tbody>${d.snapshots.slice(0, 40).map((s) => `<tr><td>${esc(s.snapshot_at)}</td><td>${esc(s.quarter)}</td><td class="numeric">${fmt(s.production_kboepd, 2)}</td><td class="numeric">${fmt(s.sold_kboepd, 2)}</td><td class="numeric">${fmt(s.crude_usd_bbl, 1)}</td><td class="numeric">${fmt(s.gas_usd_boe, 1)}</td><td class="numeric">${fmt(s.petroleum_revenue_usdm, 0)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Ingen snapshots ennå.</div>'}
    </section>`;
}

async function renderStatus() {
  const d = await api('/api/status');
  const c = d.counts || {};
  content.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Produksjonsrader', fmt(c.production_rows, 0), '', 'D1')}
      ${kpi('Prisrader', fmt(c.price_rows, 0), '', d.eiaConfigured ? 'EIA-nøkkel konfigurert' : 'EIA-nøkkel mangler')}
      ${kpi('Snapshots', fmt(c.snapshots, 0), '', 'Frosne nowcasts')}
      ${kpi('Admin', d.adminConfigured ? 'Klar' : 'Mangler', '', d.adminConfigured ? 'Token konfigurert' : 'Legg inn ADMIN_TOKEN')}
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Innhentingsjobber</h2><p>Siste kjøringer av eksterne datakilder</p></div></div>
      ${d.runs.length ? `<div class="table-wrap"><table><thead><tr><th>Kilde</th><th>Start</th><th>Ferdig</th><th>Status</th><th class="numeric">Rader</th><th>Melding</th></tr></thead><tbody>${d.runs.map((r) => `<tr><td>${esc(r.source)}</td><td>${esc(r.started_at)}</td><td>${esc(r.finished_at || '')}</td><td>${badge(r.status, r.status === 'ok' ? 'good' : r.status === 'error' ? 'bad' : 'warn')}</td><td class="numeric">${fmt(r.records_written, 0)}</td><td>${esc(r.message || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Ingen innhentingsjobber kjørt ennå.</div>'}
      <div class="source">Cron kjører 04:15 UTC daglig. SODIR er hovedkilden for feltproduksjon.</div>
    </section>`;
}

const renderers = {
  overview: renderOverview,
  production: renderProduction,
  market: renderMarket,
  nowcast: renderNowcast,
  events: renderEvents,
  backtest: renderBacktest,
  status: renderStatus,
};

async function render() {
  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');
  content.innerHTML = '';
  $('#page-title').textContent = titleMap[state.view] || 'OKEA Tracker';
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  try {
    await (renderers[state.view] || renderOverview)();
    $('#sidebar-status').textContent = 'API tilkoblet';
  } catch (err) {
    $('#sidebar-status').textContent = 'API-feil';
    errorBox.textContent = err.message || String(err);
    errorBox.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
  }
}

document.querySelectorAll('#nav button').forEach((button) => {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    location.hash = `/${state.view}`;
    render();
  });
});

quarterSelect.addEventListener('change', () => {
  state.quarter = quarterSelect.value;
  localStorage.setItem('okea-quarter', state.quarter);
  render();
});

$('#refresh').addEventListener('click', render);
window.addEventListener('hashchange', () => {
  const next = location.hash.replace('#/', '');
  if (next && next !== state.view) {
    state.view = next;
    render();
  }
});

render();
