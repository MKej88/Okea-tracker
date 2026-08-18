const ADMIN_STORAGE = 'okea-admin-token';

function adminQuarter() {
  return document.querySelector('#quarter')?.value || localStorage.getItem('okea-quarter') || '2026Q3';
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_STORAGE) || localStorage.getItem(ADMIN_STORAGE) || '';
}

function storeAdminToken(token, persist) {
  sessionStorage.removeItem(ADMIN_STORAGE);
  localStorage.removeItem(ADMIN_STORAGE);
  if (!token) return;
  (persist ? localStorage : sessionStorage).setItem(ADMIN_STORAGE, token);
}

async function adminFetch(path, options = {}) {
  const token = getAdminToken();
  if (!token) throw new Error('Legg inn ADMIN_TOKEN først.');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function addAdminStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .admin-fab{position:fixed;right:22px;bottom:22px;z-index:1000;border:1px solid rgba(255,255,255,.13);background:#16291f;color:#dff7e8;border-radius:999px;padding:11px 16px;font:600 13px/1 system-ui;box-shadow:0 12px 34px rgba(0,0,0,.36);cursor:pointer}.admin-fab:hover{background:#1c3528}
    .admin-overlay{position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.64);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:24px}.admin-hidden{display:none!important}
    .admin-modal{width:min(780px,100%);max-height:min(820px,92vh);overflow:auto;background:#101613;border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.55);color:#e8eee9}
    .admin-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding:22px 24px 18px;border-bottom:1px solid rgba(255,255,255,.08)}.admin-head h2{margin:3px 0 4px;font-size:22px}.admin-head p{margin:0;color:#92a198;font-size:13px}.admin-close{border:0;background:transparent;color:#aab6ae;font-size:28px;line-height:1;cursor:pointer;padding:0 2px}
    .admin-body{padding:22px 24px 26px}.admin-section{padding:18px 0;border-bottom:1px solid rgba(255,255,255,.07)}.admin-section:first-child{padding-top:0}.admin-section:last-child{border-bottom:0;padding-bottom:0}.admin-section h3{font-size:14px;margin:0 0 12px;color:#dfe9e2}
    .admin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.admin-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.admin-stat{background:#151d18;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px}.admin-stat span{display:block;color:#829087;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}.admin-stat strong{font-size:15px;color:#eef5f0}
    .admin-token-row{display:flex;gap:9px;align-items:center}.admin-token-row input{flex:1;min-width:0;background:#0c110e;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:11px 12px;color:#edf4ef;outline:none}.admin-token-row input:focus{border-color:#4a8f64}.admin-check{display:flex;align-items:center;gap:7px;color:#93a198;font-size:12px;margin-top:9px}.admin-check input{accent-color:#4a8f64}
    .admin-btn{border:1px solid rgba(255,255,255,.12);background:#18221c;color:#e9f2eb;border-radius:10px;padding:11px 13px;font:600 12px/1.1 system-ui;cursor:pointer;transition:.15s}.admin-btn:hover{background:#213027}.admin-btn.primary{background:#245d3a;border-color:#347b4d}.admin-btn.primary:hover{background:#2b6b43}.admin-btn:disabled{opacity:.45;cursor:wait}.admin-btn.full{grid-column:1/-1;padding:13px}
    .admin-result{margin-top:12px;background:#0a0e0c;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;min-height:46px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:#b8c7bd;white-space:pre-wrap;word-break:break-word}.admin-result.ok{border-color:rgba(64,160,95,.45);color:#bde9ca}.admin-result.err{border-color:rgba(201,74,74,.5);color:#f0b6b6}
    .admin-note{font-size:12px;color:#87968d;line-height:1.5;margin:10px 0 0}.admin-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 8px;font-size:11px;color:#9dacA3}.admin-dot{width:7px;height:7px;border-radius:50%;background:#66736b}.admin-dot.good{background:#55b477}.admin-dot.bad{background:#c95e5e}
    @media(max-width:680px){.admin-overlay{padding:8px}.admin-modal{max-height:96vh}.admin-grid,.admin-status-grid{grid-template-columns:1fr 1fr}.admin-token-row{flex-direction:column;align-items:stretch}.admin-fab{right:13px;bottom:13px}.admin-body,.admin-head{padding-left:16px;padding-right:16px}}
  `;
  document.head.appendChild(style);
}

function createAdminUi() {
  const fab = document.createElement('button');
  fab.className = 'admin-fab';
  fab.type = 'button';
  fab.textContent = 'Administrasjon';

  const overlay = document.createElement('div');
  overlay.className = 'admin-overlay admin-hidden';
  overlay.innerHTML = `
    <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <div class="admin-head">
        <div><span class="admin-pill"><span class="admin-dot" id="admin-dot"></span><span id="admin-live-label">Sjekker status</span></span><h2 id="admin-title">Administrasjon</h2><p>Datainnhenting og point-in-time nowcast uten terminal.</p></div>
        <button class="admin-close" type="button" aria-label="Lukk">×</button>
      </div>
      <div class="admin-body">
        <section class="admin-section">
          <h3>Tilgang</h3>
          <div class="admin-token-row"><input id="admin-token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN"><button id="admin-save-token" class="admin-btn" type="button">Lagre token</button></div>
          <label class="admin-check"><input id="admin-persist" type="checkbox"> Husk token på denne nettleseren (ellers bare denne fanen)</label>
          <p class="admin-note">Tokenet sendes kun som Authorization-header til denne Worker-en. Det legges ikke i GitHub.</p>
        </section>
        <section class="admin-section">
          <h3>Datastatus</h3>
          <div class="admin-status-grid" id="admin-stats"><div class="admin-stat"><span>Status</span><strong>Henter…</strong></div></div>
        </section>
        <section class="admin-section">
          <h3>Oppdater data</h3>
          <div class="admin-grid">
            <button class="admin-btn primary" id="admin-sync-production" type="button">Synk SODIR</button>
            <button class="admin-btn" id="admin-sync-brent" type="button">Synk Brent</button>
            <button class="admin-btn" id="admin-recalc" type="button">Lagre snapshot</button>
            <button class="admin-btn full" id="admin-full-update" type="button">Kjør full oppdatering</button>
          </div>
          <div id="admin-result" class="admin-result">Klar.</div>
          <p class="admin-note">«Lagre snapshot» fryser nowcasten for valgt kvartal. Historiske snapshots skal ikke omskrives.</p>
        </section>
      </div>
    </div>`;

  document.body.append(fab, overlay);
  return { fab, overlay };
}

function prettyResult(label, data) {
  const useful = { ...data };
  if (useful.nowcast && typeof useful.nowcast === 'object') {
    const n = useful.nowcast;
    useful.nowcast = {
      quarter: n.quarter,
      production_kboepd: n.production?.kboepd,
      sold_kboepd: n.lifting?.soldKboepd,
      crude_usd_bbl: n.prices?.crudeUsdBbl,
      gas_usd_boe: n.prices?.gasUsdBoe,
      petroleum_revenue_usdm: n.petroleumRevenueUsdm,
    };
  }
  return `${label}\n${JSON.stringify(useful, null, 2)}`;
}

async function refreshAdminStatus() {
  const stats = document.querySelector('#admin-stats');
  const dot = document.querySelector('#admin-dot');
  const label = document.querySelector('#admin-live-label');
  try {
    const res = await fetch('/api/status');
    const d = await res.json();
    if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
    dot.className = 'admin-dot good';
    label.textContent = 'Worker tilgjengelig';
    const c = d.counts || {};
    stats.innerHTML = `
      <div class="admin-stat"><span>Produksjonsrader</span><strong>${Number(c.production_rows || 0).toLocaleString('nb-NO')}</strong></div>
      <div class="admin-stat"><span>Prisrader</span><strong>${Number(c.price_rows || 0).toLocaleString('nb-NO')}</strong></div>
      <div class="admin-stat"><span>Snapshots</span><strong>${Number(c.snapshots || 0).toLocaleString('nb-NO')}</strong></div>
      <div class="admin-stat"><span>Admin secret</span><strong>${d.adminConfigured ? 'OK' : 'Mangler'}</strong></div>
      <div class="admin-stat"><span>EIA</span><strong>${d.eiaConfigured ? 'Aktiv' : 'Ikke satt'}</strong></div>
      <div class="admin-stat"><span>Standardkvartal</span><strong>${d.defaultQuarter || '—'}</strong></div>`;
    const brent = document.querySelector('#admin-sync-brent');
    if (brent) {
      brent.disabled = !d.eiaConfigured;
      brent.title = d.eiaConfigured ? '' : 'EIA_API_KEY er ikke konfigurert ennå';
    }
    return d;
  } catch (error) {
    dot.className = 'admin-dot bad';
    label.textContent = 'Statusfeil';
    stats.innerHTML = `<div class="admin-stat"><span>Feil</span><strong>${String(error.message || error)}</strong></div>`;
    throw error;
  }
}

function setAdminBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = 'Kjører…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function runAdminAction(button, label, fn) {
  const out = document.querySelector('#admin-result');
  setAdminBusy(button, true);
  out.className = 'admin-result';
  out.textContent = `${label}…`;
  try {
    const data = await fn();
    out.className = 'admin-result ok';
    out.textContent = prettyResult(`${label} ferdig.`, data);
    await refreshAdminStatus();
    window.dispatchEvent(new Event('okea-admin-updated'));
    return data;
  } catch (error) {
    out.className = 'admin-result err';
    out.textContent = `${label} feilet:\n${error.message || error}`;
    throw error;
  } finally {
    setAdminBusy(button, false);
  }
}

function bindAdminUi(ui) {
  const close = () => ui.overlay.classList.add('admin-hidden');
  const open = async () => {
    ui.overlay.classList.remove('admin-hidden');
    const saved = getAdminToken();
    document.querySelector('#admin-token').value = saved;
    document.querySelector('#admin-persist').checked = Boolean(localStorage.getItem(ADMIN_STORAGE));
    try { await refreshAdminStatus(); } catch {}
  };
  ui.fab.addEventListener('click', open);
  ui.overlay.querySelector('.admin-close').addEventListener('click', close);
  ui.overlay.addEventListener('click', (e) => { if (e.target === ui.overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  document.querySelector('#admin-save-token').addEventListener('click', () => {
    const token = document.querySelector('#admin-token').value.trim();
    const persist = document.querySelector('#admin-persist').checked;
    storeAdminToken(token, persist);
    const out = document.querySelector('#admin-result');
    out.className = 'admin-result ok';
    out.textContent = token ? `Token lagret ${persist ? 'på denne nettleseren' : 'for denne fanen'}.` : 'Token fjernet.';
  });

  document.querySelector('#admin-sync-production').addEventListener('click', async (e) => {
    try {
      await runAdminAction(e.currentTarget, 'SODIR-synk', () => adminFetch(`/api/admin/sync-production?quarter=${encodeURIComponent(adminQuarter())}`, { method: 'POST' }));
    } catch {}
  });
  document.querySelector('#admin-sync-brent').addEventListener('click', async (e) => {
    try {
      await runAdminAction(e.currentTarget, 'Brent-synk', () => adminFetch(`/api/admin/sync-brent?quarter=${encodeURIComponent(adminQuarter())}`, { method: 'POST' }));
    } catch {}
  });
  document.querySelector('#admin-recalc').addEventListener('click', async (e) => {
    try {
      await runAdminAction(e.currentTarget, 'Point-in-time snapshot', () => adminFetch(`/api/admin/recalculate?quarter=${encodeURIComponent(adminQuarter())}`, { method: 'POST' }));
    } catch {}
  });
  document.querySelector('#admin-full-update').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const out = document.querySelector('#admin-result');
    setAdminBusy(button, true);
    out.className = 'admin-result';
    try {
      const q = encodeURIComponent(adminQuarter());
      out.textContent = '1/3 Synkroniserer SODIR…';
      const production = await adminFetch(`/api/admin/sync-production?quarter=${q}`, { method: 'POST' });
      let brent = { skipped: true };
      const status = await refreshAdminStatus();
      if (status.eiaConfigured) {
        out.textContent = '2/3 Synkroniserer Brent…';
        brent = await adminFetch(`/api/admin/sync-brent?quarter=${q}`, { method: 'POST' });
      }
      out.textContent = '3/3 Beregner og fryser nowcast…';
      const snapshot = await adminFetch(`/api/admin/recalculate?quarter=${q}`, { method: 'POST' });
      out.className = 'admin-result ok';
      out.textContent = prettyResult('Full oppdatering ferdig.', { production, brent, snapshot: snapshot.nowcast });
      await refreshAdminStatus();
      window.dispatchEvent(new Event('okea-admin-updated'));
    } catch (error) {
      out.className = 'admin-result err';
      out.textContent = `Full oppdatering feilet:\n${error.message || error}`;
    } finally {
      setAdminBusy(button, false);
    }
  });
}

addAdminStyles();
const adminUi = createAdminUi();
bindAdminUi(adminUi);
