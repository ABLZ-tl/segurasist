[F6] iter2 STARTED — 5 caller migration + EMF metrics
[F6] iter2 DONE auth.service.ts:231,330 — migrado a factory + otp_requested/otp_verified (resourceType=auth)
[F6] iter2 DONE auth.controller.ts — inyecta AuditContextFactory, propaga ctx a otpRequest/otpVerify
[F6] iter2 DONE insureds.service.ts:625-638 — find360 acepta AuditContext + action='read_viewed' (enum extendido)
[F6] iter2 DONE insureds.service.ts:911-928 — exportRequest sigue action='export', ctx via AuditContext canónico
[F6] iter2 DONE insureds.controller.ts — inyecta AuditContextFactory, sustituye extracción manual req.ip/UA/traceId
[F6] iter2 DONE certificates.service.ts:225-241 — urlForSelf acepta AuditContext + action='read_downloaded'
[F6] iter2 DONE certificates.controller.ts — inyecta AuditContextFactory, mine() usa fromRequest()
[F6] iter2 DONE audit-metrics-emf.ts NEW — helper EMF emitter (namespace SegurAsist/Audit, dim Environment)
[F6] iter2 DONE audit-writer EMF — AuditWriterHealth=1 (success) + AuditWriterHealth=0 (fail) emitidos en record()
[F6] iter2 DONE audit-chain-verifier EMF — AuditChainValid emitido para sources db/s3/both; MirrorLagSeconds en 'both'
[F6] iter2 DONE F1 cross-cut B4-V2-16 — verificado: cert.findFirst ya filtra status='issued' (línea 219-220), sin conflicto con migración audit (líneas 234-247)
[F6] iter2 iter2-complete
