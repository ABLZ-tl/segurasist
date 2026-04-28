# Sprint 4 — S7 iter 1 feed

> Append-only. Formato: `[S7] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>`

[S7] 2026-04-27 09:00 iter1 STARTED docs/sprint4/feed/S7-iter1.md — bundle S4-09 audit timeline 5pts
[S7] 2026-04-27 09:10 iter1 STARTED segurasist-api/src/modules/audit/dto/timeline.dto.ts — Zod request schemas + ApiProperty response DTOs (TimelineQuery + TimelineExportQuery + TimelineItem + TimelineResponse)
[S7] 2026-04-27 09:25 iter1 STARTED segurasist-api/src/modules/audit/audit-timeline.service.ts — service con `getTimeline` keyset cursor + `streamCsv` async generator (chunks 500 + hard cap 50k) + `maskIp` + `csvEscape` RFC 4180 + hidratación actorEmail best-effort
[S7] 2026-04-27 09:35 iter1 STARTED segurasist-api/src/modules/audit/audit-timeline.controller.ts — `GET /v1/audit/timeline` (60/min throttle) + `GET /v1/audit/timeline/export` (2/min throttle) + auditoría de auditoría (registra `export_downloaded` con resourceType='audit.timeline')
[S7] 2026-04-27 09:40 iter1 DONE segurasist-api/src/modules/audit/audit.module.ts — registra AuditTimelineController + AuditTimelineService (audit-writer + audit-context vienen de AuditPersistenceModule @Global)
[S7] 2026-04-27 09:50 iter1 DONE segurasist-api/test/integration/audit-timeline.spec.ts — 11 specs: pagination 50→3 pages (20/20/10), cross-tenant where tenantId asserted, OR shape (resourceType+resourceId | payloadDiff.path:['insuredId']), actionFilter propagation, CSV header + escape, multi-page CSV streaming, helpers maskIp/csvEscape edge cases
[S7] 2026-04-27 10:05 iter1 STARTED segurasist-web/packages/api-client/src/hooks/audit-timeline.ts — `useAuditTimeline` infiniteQuery con keyset cursor + `useDownloadAuditCSV` mutation con blob → `<a download>` + tipo AuditTimelineAction sincronizado con enum BE
[S7] 2026-04-27 10:08 iter1 DONE segurasist-web/packages/api-client/package.json — exports map agrega `./hooks/audit-timeline`
[S7] 2026-04-27 10:20 iter1 STARTED segurasist-web/apps/admin/components/audit-timeline/audit-timeline-item.tsx — item con icon-per-action (lucide), avatar+initials, timestamp relative+ISO tooltip, payloadDiff expand/collapse con aria-expanded
[S7] 2026-04-27 10:25 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/audit-timeline-export-button.tsx — Button con isPending/aria-busy + AlertBanner inline auto-hide 5s
[S7] 2026-04-27 10:35 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/audit-timeline.tsx — feed `role="feed"` + Skeleton/Empty/Error states + filtro action (Select 8 opciones) + botón "Cargar más" + IntersectionObserver auto-fetch (rootMargin 200px) + live region aria-live="polite"
[S7] 2026-04-27 10:38 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/index.ts — re-exports
[S7] 2026-04-27 10:42 iter1 DONE segurasist-web/apps/admin/app/(app)/insureds/[id]/timeline/page.tsx — Server Component dedicado full-width
[S7] 2026-04-27 10:45 iter1 DONE segurasist-web/apps/admin/app/(app)/insureds/[id]/auditoria.tsx — tab "Auditoría" delega al `<AuditTimeline>` (reemplaza inline list de S3-06)
[S7] 2026-04-27 11:00 iter1 DONE segurasist-web/apps/admin/test/integration/audit-timeline.spec.ts — 14 specs: skeleton/error/empty/list, hasNextPage flow + load-more click → fetchNextPage, action filter Select → re-call hook with actionFilter='update', export visibility hideExport prop, item expand/collapse + aria-expanded, action humanization (login → "Inició sesión"), null payloadDiff hides toggle, IP mask render
[S7] 2026-04-27 11:05 iter1 NEW-FINDING segurasist-api/src/modules/audit/audit-timeline.service.ts — `payloadDiff @> {insuredId:X}` query es lento sin functional index GIN(payload_diff) — Sprint 5 candidato si timeline carga >150ms p95 (no bloquea iter 1)
[S7] 2026-04-27 11:08 iter1 NEW-FINDING segurasist-api/src/modules/audit/dto/timeline.dto.ts — el enum AuditAction frontend está duplicado en api-client/hooks/audit-timeline.ts (string literal union) — Sprint 5 podría auto-generarlo desde OpenAPI (`pnpm --filter @segurasist/api-client openapi:gen`)
[S7] 2026-04-27 11:10 iter1 NEW-FINDING segurasist-web/apps/admin/components/audit-timeline/audit-timeline-item.tsx — `relativeTime` reimplementa `formatDistanceToNowStrict`; recomendable consolidar en `lib/format-relative-time.ts` si otros agentes (S2 reports) lo necesitan
[S7] 2026-04-27 11:15 iter1 iter1-complete — bundle S4-09 cerrado: 12 files creados/modificados, 25 specs nuevas (11 BE + 14 FE)
