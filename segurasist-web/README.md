# segurasist-web

Monorepo Next.js 14 con dos apps independientes (`admin.segurasist.app` y `portal.segurasist.app`) y paquetes compartidos (UI, API client, Auth, i18n, Config).

## Requisitos

- Node.js >= 20
- pnpm >= 8.15

## Instalación

```bash
cd segurasist-web
pnpm install
```

> El monorepo usa `node-linker=hoisted` (ver `.npmrc`) para evitar problemas con symlinks en Next.js / Amplify.

## Desarrollo

```bash
# Levanta admin (3000) y portal (3001) en paralelo
pnpm dev

# Solo una app
pnpm --filter @segurasist/admin dev
pnpm --filter @segurasist/portal dev
```

URLs locales:

- Admin: http://localhost:3000
- Portal asegurado: http://localhost:3001
- Storybook (UI): http://localhost:6006

## Variables de entorno

Copia `.env.local` por app con al menos:

```
COGNITO_REGION=mx-central-1
COGNITO_USER_POOL_ID=mx-central-1_XXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxx
COGNITO_DOMAIN=https://segurasist.auth.mx-central-1.amazoncognito.com
COGNITO_REDIRECT_URI=http://localhost:3000/api/auth/callback
API_BASE_URL=http://localhost:8080
```

## Storybook

```bash
pnpm storybook
```

Cada primitivo del design system (`packages/ui/src/components`) tiene un `*.stories.tsx` con variantes (default / disabled / loading / error donde aplique).

## Tests

```bash
pnpm test:unit          # Vitest + Testing Library
pnpm test:e2e           # Playwright (admin + portal)
pnpm --filter @segurasist/admin lighthouse  # Lighthouse CI
```

## Generación de tipos OpenAPI

Con el backend corriendo:

```bash
OPENAPI_URL=http://localhost:8080/openapi.json pnpm openapi:gen
```

Sobrescribe `packages/api-client/src/generated/openapi.d.ts`.

## Estructura

```
apps/
  admin/    Portal admin (Next.js 14 App Router)
  portal/   Portal asegurado (mobile-first)
packages/
  ui/           Design system (shadcn/ui + Radix + Tailwind)
  api-client/   Cliente API tipado + hooks TanStack Query
  auth/         Cognito helpers + middleware Next.js
  i18n/         Mensajes es-MX (next-intl)
  config/       ESLint flat + Tailwind preset + tsconfig base
tests/e2e/      Playwright cross-app
```

## Despliegue

GitHub Actions (`.github/workflows/web-ci.yml`) corre lint, typecheck, tests y Lighthouse. Despliegues automáticos a Amplify (`develop` → staging, `main` → prod) vía OIDC.

`amplify.yml` define builds independientes por app.
