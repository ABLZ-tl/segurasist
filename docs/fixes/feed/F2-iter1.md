# F2 — feed entries iter 1

> Bundle: B-PORTAL-AUTH + B-CSP. Append-only. F0 orquestador integra estas
> entradas a `docs/fixes/_fixes-feed.md`.

```
[F2] 2026-04-28 05:51 iter1 STARTED docs/audit/AUDIT_INDEX.md — F2 inicia bundle B-PORTAL-AUTH + B-CSP (C-02, C-03, H-04, H-05, H-05b)
[F2] 2026-04-28 05:55 iter1 DONE segurasist-web/apps/portal/app/api/proxy/[...path]/route.ts:2,13 — C-02 cookie portal correcta (PORTAL_SESSION_COOKIE) + H-04 checkOrigin() invocado al inicio del handler // upstream cualquier consumidor del proxy ahora recibe Bearer Cognito real
[F2] 2026-04-28 05:55 iter1 DONE segurasist-web/apps/portal/next.config.mjs — H-05 frame-src 'self' https://*.s3.mx-central-1.amazonaws.com https://*.cloudfront.net (preview iframe certificado)
[F2] 2026-04-28 05:55 iter1 DONE segurasist-web/apps/admin/next.config.mjs — H-05b preventiva, mismo frame-src para admin (Sprint 4 onwards)
[F2] 2026-04-28 05:55 iter1 DONE segurasist-api/src/modules/auth/auth.service.ts:300-326 — C-03 verifyInsuredOtp persiste insureds.cognito_sub vía decodeJwt(idToken).sub + prismaBypass.client.insured.update({ where:{id}, data:{cognitoSub} }); errores no rompen el flow (warn)
[F2] 2026-04-28 05:55 iter1 DONE segurasist-api/test/integration/otp-flow.spec.ts — 6 specs C-03 (happy path, fallback access, BD-down resilience, BYPASS deshabilitado, JWT sin sub, código inválido no toca BD)
[F2] 2026-04-28 05:55 iter1 DONE segurasist-web/apps/portal/test/integration/csp-iframe.spec.ts — 6 specs H-05/H-05b (frame-src declarado, S3, CloudFront, 'self', frame-ancestors intacto, admin mirror)
[F2] 2026-04-28 05:55 iter1 NEW-FINDING segurasist-api/src/modules/auth/auth.service.spec.ts:95 — H-09 sigue abierto (describe.skip de otpRequest/otpVerify). Mi otp-flow.spec.ts cubre el path C-03 pero NO el flow OTP completo unitariamente. F9 debería integrarlo en B-TESTS-OTP.
[F2] 2026-04-28 05:55 iter1 NEW-FINDING segurasist-web/apps/portal/.next/ — el build cache (.next/) tiene cookie-names.ts inlined; tras el merge será necesario un `pnpm build` limpio para purgar artefactos de iteraciones anteriores. Documentar en DEVELOPER_GUIDE.md (F10).
[F2] 2026-04-28 05:55 iter1 iter1-complete F2 listo para iter 2; tests no pude correr (sandbox bloquea pnpm test). Validación pendiente delegada a F0 en gate D4.
```
