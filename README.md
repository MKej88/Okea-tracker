# OKEA Tracker

Cloudflare-basert **point-in-time nowcast** for OKEA ASA.

Målet er ikke bare å vise produksjon. Trackeren kombinerer:

1. **Produksjon** - månedlig feltproduksjon fra Sokkeldirektoratet × OKEA-andel
2. **Lifting / solgt volum** - lifting-signaler, under-/overlift og eksplisitte management-opplysninger
3. **Olje, gass og NGL** - markedspris + historisk OKEA-basis
4. **Hedging** - offentlig hedgeandel, gulv/tak og retning på hedgeeffekt
5. **Kvartals-nowcast** - produksjon → solgt volum → realiserte priser → petroleumsinntekt
6. **Prosjekter og hendelser** - vedlikehold, nye brønner, Garn West South, Bestla, guidance osv.
7. **Backtest** - frosne snapshots slik at modellen kan måles uten etterpåklokskap
8. **Datastatus** - sporbarhet for alle innhentingsjobber

## Teknologi

- **Cloudflare Workers** - API og scheduler
- **Workers Static Assets** - dashboard
- **Cloudflare D1** - historikk, signaler, snapshots og modellinput
- **Cron Trigger** - daglig oppdatering
- Ingen egen server og ingen betalt database er nødvendig.

Frontend er bevisst laget uten tungt rammeverk i første versjon. Det gir svært lite compute, få avhengigheter og enkel Cloudflare-drift.

---

## Datakilder i v0.1

### Produksjon - automatisk

Sokkeldirektoratets `profiles`-tabell, DataService layer **7300**.

Trackeren henter månedlige feltdata og beregner estimert OKEA-produksjon fra `tracker_share`.

**Viktig:** `tracker_share` er separat fra juridisk WI. Statfjord er eksplisitt behandlet særskilt fordi OKEAs juridiske unit-andel og andelen som skal brukes mot norsk SODIR-produksjon ikke er identiske.

### Brent - automatisk når gratis EIA-nøkkel er lagt inn

EIA-serie `RBRTE` (Europe Brent Spot Price FOB).

EIA API-nøkkel er gratis. Den lagres som Cloudflare secret og skal aldri committes til GitHub.

### Gass / NGL

Datamodellen og API-et er klart. I v0.1 kan prisserier legges inn via admin-API mens en stabil, gratis og tillatt automatisk gasskilde velges.

### Hedging / lifting / events / konsensus

Disse er egne D1-tabeller. Offentlige OKEA-opplysninger legges inn med dato og kilde slik at trackeren beholder point-in-time-egenskapen.

---

# Oppsett i Cloudflare

## 1. Klon repo og installer

```bash
git clone https://github.com/MKej88/Okea-tracker.git
cd Okea-tracker
npm install
```

## 2. Logg inn i Cloudflare

```bash
npx wrangler login
```

## 3. Opprett D1

```bash
npx wrangler d1 create okea-tracker-db
```

Cloudflare returnerer en `database_id`.

Åpne `wrangler.jsonc` og erstatt:

```text
REPLACE_WITH_D1_DATABASE_ID
```

med den faktiske ID-en.

## 4. Kjør migreringene

Lokalt:

```bash
npm run db:migrate:local
```

Cloudflare:

```bash
npm run db:migrate
```

`0002_seed.sql` legger inn:

- OKEA-feltene og eierandelene som produksjonsmotoren trenger
- Q3 2026 hedgeoversikt
- gjeldende produksjonsguidance fra Q2 2026
- Q4 2025, Q1 2026 og Q2 2026 som historiske fasittall
- et lite hendelsesregister som startpunkt

## 5. Legg inn admin-token

Lag en lang tilfeldig verdi og kjør:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Admin-endepunktene er deaktivert dersom token ikke finnes.

## 6. Valgfritt: gratis Brent-feed fra EIA

Registrer gratis EIA API-nøkkel og legg den inn:

```bash
npx wrangler secret put EIA_API_KEY
```

Uten nøkkelen fungerer resten av trackeren, men Brent-serien synkroniseres ikke automatisk.

## 7. Test lokalt

```bash
npm run dev
```

Dashboard:

```text
http://localhost:8787
```

API-helsesjekk:

```text
http://localhost:8787/api/health
```

Cloudflare eksponerer også scheduled-handleren lokalt:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

## 8. Deploy

```bash
npm run deploy
```

Etter deploy kjører Cron Trigger daglig **04:15 UTC**.

---

# Første datakjøring

Cron vil hente SODIR automatisk, men første synk kan startes manuelt.

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/sync-production?quarter=2026Q3" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN"
```

Hvis EIA er konfigurert:

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/sync-brent?quarter=2026Q3" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN"
```

Frys deretter et nowcast-snapshot:

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/recalculate?quarter=2026Q3" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN"
```

---

# Admin-API

Alle skriveendepunkter krever `Authorization: Bearer <ADMIN_TOKEN>`.

## Legg inn gass-/NGL-priser

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/prices" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {"date":"2026-08-18","kind":"gas_usd_boe","value":90.2,"unit":"USD/boe","source":"manual approved source"}
    ]
  }'
```

Tillatte `kind` i v0.1:

- `brent_usd_bbl`
- `gas_usd_boe`
- `ngl_usd_boe`
- `ttf_eur_mwh`
- `eurusd`

## Legg inn lifting-signal

Eksempel: et point-in-time anslag om at solgt volum blir 1,04× produksjonen.

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/lifting-signal" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quarter":"2026Q3",
    "signalDate":"2026-08-18",
    "signalType":"sold_ratio",
    "value":1.04,
    "unit":"x",
    "confidence":"medium",
    "sourceNote":"OKEA public information",
    "comment":"Stored point-in-time; do not rewrite historically"
  }'
```

## Legg inn hendelse

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/event" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventDate":"2026-08-18",
    "quarter":"2026Q3",
    "fieldKey":"brage",
    "category":"operations",
    "title":"Eksempel på operativ hendelse",
    "description":"Beskriv kun hva som faktisk er offentlig kjent.",
    "impactKboepd":null,
    "confidence":"medium",
    "sourceNote":"Kilde"
  }'
```

En hendelse påvirker **ikke** produksjonsmodellen automatisk før `impactKboepd` eksplisitt settes. Dette er bevisst for å redusere etterpåklokskap.

## Legg inn konsensus

```bash
curl -X POST "https://DIN-WORKER.workers.dev/api/admin/consensus" \
  -H "Authorization: Bearer DITT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quarter":"2026Q3",
    "metric":"production_kboepd",
    "value":31.2,
    "unit":"kboepd",
    "source":"Megler/FactSet",
    "estimateDate":"2026-08-18"
  }'
```

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

---

# Nowcast-logikk v0.1

## Produksjon

- Faktiske SODIR-måneder brukes direkte.
- Manglende måneder viderefører siste kjente run-rate per felt.
- Hendelsesjusteringer kommer på toppen **kun når de er eksplisitt registrert**.

Dette er grunnmodellen fra produksjonsbacktesten. Senere versjoner skal få mer presise eventregler for planlagt vedlikehold, restart og nye brønner.

## Lifting

- Eksplisitt point-in-time `sold_ratio` brukes hvis den finnes.
- Ellers er base 1,00× produksjon.
- Start-range i databasen er 0,95–1,05×.

Neste modellsteg er å kombinere:

- OKEAs neste-kvartals crude-liftingindikasjon
- netto under-/overlift
- ferskere produksjons-nowcast enn da liftingplanen ble laget
- feltspesifikke cargomønstre

## Priser

- Crude = gjennomsnittlig Brent i kvartalet + kalibrert OKEA-basis.
- Gass = lagret gas price-serie × rolling OKEA-basis.
- NGL = direkte serie hvis tilgjengelig, ellers enkel Brent-ratio.

Petroleumsinntekten holdes tilbake hvis nødvendig prisdata mangler. Trackeren viser altså heller `—` enn å produsere falsk presisjon.

## Hedging

v0.1 beregner **retning**:

- markedspris under gulv → positiv hedgeeffekt
- mellom gulv/tak → begrenset effekt
- over tak → negativ hedgeeffekt

Eksakt USD-P/L bygges først når tranche-notionaler og settlementinformasjon kan dokumenteres tilstrekkelig.

---

# Point-in-time-prinsipp

Dette er en sentral del av prosjektet.

Hver automatiske kjøring lagrer et `nowcast_snapshot` med tidsstempel. Historiske snapshots skal **ikke omskrives** når nye fakta blir kjent.

Dermed kan vi etter Q3-resultatet sammenligne:

- tracker-estimatet slik det faktisk så ut på en bestemt dato
- markedskonsensus på samme dato
- OKEAs rapporterte fasit

Q3 2026 blir derfor første rene live/out-of-sample testperiode.

---

# Viktige filer

```text
src/worker.ts              API + Cron
src/sources/sodir.ts       offentlig feltproduksjon
src/sources/eia.ts         Brent-adapter
src/model/nowcast.ts       produksjon/lifting/pris-nowcast
migrations/0001_initial.sql D1-struktur
migrations/0002_seed.sql    OKEA-startdata
public/index.html           dashboard
public/app.js               frontend-moduler
public/styles.css           design
wrangler.jsonc              Cloudflare-konfigurasjon
```

## Videre plan

1. Få første Cloudflare-deploy og SODIR-sync grønn.
2. Velg og implementer automatisk gratis gasspris-feed.
3. Importer historisk produksjon/price data og materialiser Backtest 1.0–6.0 i D1.
4. Bygg liftingmotor 2.0 med under-/overlift og crude cargo-signaler.
5. Legg inn konsensusfeed/manuell konsensusfangst før Q3.
6. Utvid revenue-modellen med hedge-range, O/U-lagerbro og EBITDA.
7. Fryse Q3-nowcast løpende frem mot trading update.
