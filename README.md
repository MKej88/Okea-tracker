# OKEA Tracker

Cloudflare-basert **point-in-time nowcast** for OKEA ASA.

Trackeren kombinerer:

1. **Produksjon** – månedlig feltproduksjon fra Sokkeldirektoratet × OKEA-andel
2. **Lifting / solgt volum** – lifting-signaler, under-/overlift og offentlig OKEA-informasjon
3. **Olje, gass og NGL** – markedspris + historisk OKEA-basis
4. **Hedging** – offentlig hedgeandel, gulv/tak og retningssignal
5. **Kvartals-nowcast** – produksjon → solgt volum → realiserte priser → petroleumsinntekt
6. **Prosjekter og hendelser** – vedlikehold, nye brønner, Garn West South, Bestla, guidance osv.
7. **Backtest** – frosne snapshots slik at modellen kan måles uten etterpåklokskap
8. **Datastatus** – sporbarhet for alle innhentingsjobber

## Teknologi

- **Cloudflare Workers** – API og scheduler
- **Workers Static Assets** – dashboard
- **Cloudflare D1** – historikk, signaler, snapshots og modellinput
- **Cron Trigger** – daglig oppdatering
- Ingen egen server er nødvendig.

Frontend er bevisst laget uten tungt rammeverk i første versjon. Det gir lavt ressursbruk og enkel Cloudflare-drift.

---

## Datakilder i v0.1

### Produksjon – automatisk

Sokkeldirektoratets `profiles`-tabell, DataService layer **7300**.

Trackeren henter månedlige feltdata og beregner estimert OKEA-produksjon fra `tracker_share`.

**Viktig:** `tracker_share` er separat fra juridisk WI. Statfjord behandles særskilt fordi OKEAs juridiske unit-andel og andelen som skal brukes mot norsk SODIR-produksjon ikke er identiske.

### Brent – automatisk når gratis EIA-nøkkel er lagt inn

EIA-serie `RBRTE` (Europe Brent Spot Price FOB).

EIA API-nøkkel er gratis. Den lagres som Cloudflare secret og skal aldri committes til GitHub.

### Gass / NGL

Datamodellen og API-et er klart. Automatisk, stabil og tillatt prisfeed bygges i neste steg.

### Hedging / lifting / hendelser / konsensus

Disse har egne D1-tabeller. Offentlige OKEA-opplysninger lagres med dato og kilde slik at trackeren beholder point-in-time-egenskapen.

---

# Oppsett i Cloudflare – uten terminal

Dette repoet er satt opp slik at normal drift og deploy kan gjøres fra **Cloudflare Dashboard + GitHub**. Du trenger ikke installere Node, npm eller Wrangler lokalt.

D1-databasen er allerede konfigurert i `wrangler.jsonc`:

- database: `okea-tracker-db`
- binding: `DB`
- database-id: `3018d9f0-a2bd-4498-a1da-f675fa194208`

## 1. Koble GitHub-repoet til Cloudflare

I Cloudflare:

1. Gå til **Workers & Pages**.
2. Velg **Create application**.
3. Velg **Import a repository**.
4. Koble GitHub hvis det ikke allerede er gjort.
5. Velg repoet `MKej88/Okea-tracker`.
6. Produksjonsbranch: `main`.
7. Worker-navnet må være **`okea-tracker`**.

## 2. Build/deploy-innstillinger

Bruk:

- **Build command:** tom
- **Deploy command:** `npm run deploy`
- **Root directory:** tom / repo-roten

`npm run deploy` gjør to ting automatisk i Cloudflare-miljøet:

1. kjører alle manglende D1-migreringer mot remote D1
2. deployer Workeren og dashboardet

Du trenger derfor ikke kjøre database-migreringer manuelt.

## 3. Deploy

Trykk **Save and Deploy**.

Cloudflare installerer avhengighetene, kjører migreringene og deployer siden. Etter vellykket deploy får du en `workers.dev`-adresse.

Cron Trigger kjører daglig **04:15 UTC** og henter SODIR-produksjon automatisk.

---

# Valgfrie secrets i Cloudflare Dashboard

Gå til Worker → **Settings → Variables & Secrets**.

### `ADMIN_TOKEN`

Anbefales for manuelle skriveoperasjoner. Legg inn som **Secret**.

Uten `ADMIN_TOKEN` fungerer dashboardet og automatisk cron-jobb, men admin-endepunktene er sperret.

### `EIA_API_KEY`

Valgfri gratis EIA-nøkkel for automatisk Brent-feed. Legg den inn som **Secret**.

Uten EIA-nøkkelen fungerer resten av trackeren; Brent synkroniseres bare ikke automatisk.

---

# API-er til dashboardet

```text
GET /api/overview?quarter=2026Q3
GET /api/production?quarter=2026Q3
GET /api/market?quarter=2026Q3
GET /api/nowcast?quarter=2026Q3
GET /api/events?quarter=2026Q3
GET /api/backtest
GET /api/status
GET /api/health
```

Skriveendepunkter under `/api/admin/*` krever `Authorization: Bearer <ADMIN_TOKEN>`.

---

# Nowcast-logikk v0.1

## Produksjon

- Faktiske SODIR-måneder brukes direkte.
- Manglende måneder viderefører siste kjente run-rate per felt.
- Hendelsesjusteringer kommer på toppen kun når de er eksplisitt registrert.

## Lifting

- Eksplisitt point-in-time `sold_ratio` brukes hvis det finnes.
- Ellers er base 1,00× produksjon.
- Start-range i databasen er 0,95–1,05×.

Neste modellsteg kombinerer:

- OKEAs neste-kvartals crude-liftingindikasjon
- netto under-/overlift
- ferskere produksjons-nowcast enn da liftingplanen ble laget
- feltspesifikke cargomønstre

## Priser

- Crude = gjennomsnittlig Brent i kvartalet + kalibrert OKEA-basis.
- Gass = lagret gassprisserie × rolling OKEA-basis.
- NGL = direkte serie hvis tilgjengelig, ellers enkel Brent-ratio.

Petroleumsinntekten holdes tilbake hvis nødvendig prisdata mangler. Trackeren viser heller `—` enn falsk presisjon.

## Hedging

v0.1 beregner primært retning:

- markedspris under gulv → positiv hedgeeffekt
- mellom gulv/tak → begrenset effekt
- over tak → negativ hedgeeffekt

Eksakt USD-P/L bygges først når tranche-notionaler og settlementinformasjon kan dokumenteres godt nok.

---

# Point-in-time-prinsipp

Hver automatiske kjøring kan lagre et `nowcast_snapshot` med tidsstempel. Historiske snapshots skal **ikke omskrives** når nye fakta blir kjent.

Dermed kan Q3 2026 sammenlignes med:

- tracker-estimatet slik det faktisk så ut på en bestemt dato
- markedskonsensus på samme dato
- OKEAs rapporterte fasit

Q3 2026 er første rene live/out-of-sample testperiode.

---

# Viktige filer

```text
src/worker.ts               API + Cron
src/sources/sodir.ts        offentlig feltproduksjon
src/sources/eia.ts          Brent-adapter
src/model/nowcast.ts        produksjon/lifting/pris-nowcast
migrations/0001_initial.sql D1-struktur
migrations/0002_seed.sql    OKEA-startdata
public/index.html            dashboard
public/app.js                frontend-moduler
public/styles.css            design
wrangler.jsonc               Cloudflare-konfigurasjon
```

## Videre plan

1. Få første Cloudflare-deploy og SODIR-sync grønn.
2. Implementere automatisk gratis gasspris-feed.
3. Importere historisk produksjons- og prisdata og materialisere Backtest 1.0–6.0 i D1.
4. Bygge liftingmotor 2.0 med under-/overlift og crude-cargo-signaler.
5. Legge inn konsensusfangst før Q3.
6. Utvide revenue-modellen med hedge-range, O/U-lagerbro og EBITDA.
7. Fryse Q3-nowcast løpende frem mot trading update.
