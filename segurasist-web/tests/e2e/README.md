# SegurAsist E2E (Playwright)

Suite de tests E2E que corre contra el stack docker-compose local.

## Pre-requisitos

1. **Stack docker** levantado desde `segurasist-api/`:

   ```bash
   cd segurasist-api
   docker compose up -d                # postgres + redis + localstack + mailpit + cognito-local
   bash scripts/cognito-local-bootstrap.sh   # crea pools + admin@mac.local / Admin123!
   bash scripts/localstack-bootstrap.sh      # buckets + colas + KMS
   ```

2. **API NestJS** en :3000:

   ```bash
   cd segurasist-api && npm run dev
   ```

3. **Admin Next.js** en :3001 y **portal** en :3002 (este último sólo cuando los specs portal-* dejen de estar `test.skip`):

   ```bash
   cd segurasist-web
   pnpm --filter @segurasist/admin dev    # :3001
   pnpm --filter @segurasist/portal dev   # :3002
   ```

> Nota: el `webServer` de Playwright intenta arrancar admin/portal automáticamente si no están corriendo (`reuseExistingServer: true`). Si prefieres gestión manual, exporta `PLAYWRIGHT_NO_WEBSERVER=1`.

## Correr los tests

Desde la raíz `segurasist-web/`:

```bash
pnpm test:e2e                  # corre todos los specs (chromium admin + mobile portal)
pnpm test:e2e:ui               # modo --ui interactivo
pnpm test:e2e:no-webserver     # asume admin/portal ya corriendo
```

Filtros útiles:

```bash
pnpm test:e2e --project=admin-chromium
pnpm test:e2e --grep "credenciales válidas"
```

## Estado de los specs (2026-04-26)

| Spec | Tests reales | Skipped | Razón skip |
| --- | --- | --- | --- |
| `admin-login.spec.ts` | 3 | 0 | — |
| `portal-otp.spec.ts` | 0 | 1 | `CognitoService.startInsuredOtp` 501 (Sprint 3) |
| `portal-certificate.spec.ts` | 0 | 1 | Requiere sesión insured + endpoint cert (Sprint 2/3) |

## Coordinación con backend

- **Rate limiting**: `/v1/auth/login` está en 5 req/min. Los tests usan **un sólo** intento exitoso. Si re-corres y caes en 429, espera 60s.
- **CORS / Origin allowlist**: el proxy `/api/auth/local-login` valida `Origin: http://localhost:3001`. Playwright Chromium emite el Origin correcto automáticamente.
- **AuditInterceptor**: persiste un `audit_log` por login OK; no afecta aserciones.

## Troubleshooting

- `502 Upstream API unreachable` desde `/api/auth/local-login`: la API en :3000 tal vez está bindeando sólo IPv4 mientras Node intenta IPv6 al resolver `localhost`. Workaround: exportar `API_BASE_URL=http://127.0.0.1:3000` antes de arrancar el admin.
- `timeout waiting for /dashboard`: revisa que `cognito-local` haya bootsrapeado al admin (`docker logs cognito-local`).
- `EADDRINUSE :3001` al arrancar el webServer: ya hay un admin corriendo; usa `pnpm test:e2e:no-webserver` o mata el proceso previo.
