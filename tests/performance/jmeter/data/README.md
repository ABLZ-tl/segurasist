# Fixtures CSV — S4-10

Determinista. NO commitear los `.csv` reales si superan 1MB; en su lugar
regenerar localmente con el script provisto.

## Generar

```bash
node generate-csv.mjs
```

Genera:

- `insureds.csv` — 1000 CURPs sintéticos + `otp_code` constante (`000000`,
  válido sólo en staging seed con bypass `OTP_TEST_BYPASS=true`).
- `admins.csv` — 100 admin emails (`perf-admin-NNN@staging.segurasist.local`)
  con password staging seed `Perf!Test#2026`, target CURP y `target_insured_id`
  sintetizados al estilo `insured-perf-NNN`.

## Estado del checkout

Se commiten **muestras** (100 insureds + 100 admins) suficientes para que
JMeter arranque (`recycle=true` cicla el CSV). Para fidelidad 1:1 con el
escenario S4-10 (1000 CURPs únicos → cada VU su propio token), correr el
generador antes del run real:

```bash
node tests/performance/jmeter/data/generate-csv.mjs
```

El workflow `.github/workflows/perf.yml` ejecuta el generador en su step
`Generate fixtures`.

## Importante

- **CURP sintéticos**: NO son válidos en RENAPO. Solamente shape correcto
  (4 letras + 6 dígitos + sexo + 5 letras + 2 dígitos = 18). Para staging
  seed, el endpoint `/v1/auth/otp/request` aceptará el shape pero la
  verificación contra fuente externa debe estar deshabilitada (env
  `RENAPO_VALIDATION_MODE=stub`).
- **Seed staging**: `pnpm --filter api seed:perf` debe haber corrido para
  poblar los 100 admins + 1000 insureds antes del load test. Ver
  `segurasist-api/prisma/seed.perf.ts` (S9 / Sprint 5).
- **Determinismo**: la seed está fijada (42 portal / 7 admin) → mismas filas
  cada vez → comparable contra baseline.

## Schema

`insureds.csv`:

```csv
curp,otp_code
ABCD123456HMEXIC01,000000
...
```

`admins.csv`:

```csv
email,password,target_curp,target_insured_id
perf-admin-000@staging.segurasist.local,Perf!Test#2026,XYZW987654MMEXIC02,insured-perf-000
...
```
