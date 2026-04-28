# S8 — Iter 2 feed

> Append-only. Formato: `[S8] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>`

## Entradas

[S8] 2026-04-29 10:00 iter2 STARTED docs/sprint4/feed/S8-iter2.md — follow-up consolidado vía S-MULTI: documentar `OTP_TEST_BYPASS=true` como requirement staging en scenarios README + flag a S9 producto para policy.

[S8] 2026-04-29 10:05 iter2 DONE tests/performance/jmeter/scenarios/README.md — agregada sección **Staging environment requirements (OBLIGATORIO antes del primer run)** con tabla `OTP_TEST_BYPASS=true` + `RENAPO_VALIDATION_MODE=stub` y política explícita "solo en staging, NUNCA en prod". Cubre: (1) por qué el bypass es necesario (5 OTP/min throttle saturaría el ramp-up de 1000 vu); (2) política dev/staging/prod (✅✅❌); (3) Sprint 5 backlog: alarm `auth-otp-bypass-enabled-prod` + SSM Parameter Store con plan review obligatorio. // refuerza `[S8] iter1 NEW-FINDING auth/otp` con context expandido.

[S8] 2026-04-29 10:08 iter2 NEEDS-COORDINATION S9 + producto — la decisión de exponer `OTP_TEST_BYPASS` solo en staging requiere que producto la confirme antes de iter 2 close. Riesgos: (a) si staging vive con bypass permanente, se desensibiliza al equipo a la diferencia con prod y aumenta probabilidad de skim al config; (b) si bypass se activa "ad-hoc" para el run y se olvida de apagar, queda ventana de exploit. **Recomendación S8** alineada con S9: SSM Parameter Store con TTL automático + GitHub Action `perf.yml` que setea bypass al start del run y lo borra en el `finally{}` del workflow (pre/post hooks). Sprint 5 implementación. // for-S9 + producto

[S8] 2026-04-29 10:11 iter2 NEW-FINDING path discrepancy — el dispatch S-MULTI mencionaba `tests/performance/scenarios/README.md` pero el path real es `tests/performance/jmeter/scenarios/README.md` (jmeter/ middle segment). Documenté en este último (existente) en lugar de crear duplicado. Si el orquestador prefiere que el README "global de scenarios" viva en `tests/performance/scenarios/`, ese sería un refactor Sprint 5 (mover tanto JMeter como k6 scenarios a sub-dirs de un `scenarios/` raíz). // info-only

[S8] 2026-04-29 10:13 iter2 iter2-complete — README expandido con staging requirements + policy bypass; coordinación S9 + producto flagged como NEEDS-COORDINATION.
