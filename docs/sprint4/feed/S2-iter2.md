# S2 — Iter 2 feed

> Append-only. Formato: `[S2] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>`

## Entradas

[S2] 2026-04-29 09:00 iter2 STARTED docs/sprint4/feed/S2-iter2.md — follow-up consolidado vía S-MULTI: verificar packageId filter en utilizacion (S1 iter2).

[S2] 2026-04-29 09:05 iter2 VERIFY segurasist-api/src/modules/reports/reports.service.ts:316 — `getUtilizacion(from, to, topN, scope)` continúa sin parámetro `packageId`. Inspeccionado también `reports.controller.ts:159-200` (handler `utilizacion`): query schema `UtilizacionQuerySchema` NO expone `packageId`; el handler invoca `this.reports.getUtilizacion(q.from, q.to, q.topN, scope)` con la firma de iter 1.

[S2] 2026-04-29 09:08 iter2 DONE no-action segurasist-web/packages/api-client/src/hooks/reports.ts:106-115 — `UtilizacionFilters` mantiene `{from, to, topN?, tenantId?}` sin `packageId`. Coherente con el BE iter 2 actual. NO se agrega `packageId?: string` al hook (la regla del dispatch S-MULTI condicionaba la edición a "si S1 agregó el filtro"; al no haber filtro BE el cambio FE introduciría un query param que el controller descarta, generando UI con efecto vacío). // for-S1 (si stakeholders aún quieren el filtro, agregar al ZodSchema del controller + scope.where en groupBy de coverages).

[S2] 2026-04-29 09:10 iter2 DONE no-action segurasist-web/apps/admin/app/(app)/reports/utilizacion/page.tsx — sin selector de paquete (consistente con la decisión de iter 1, ratificada en iter 2 al no llegar el filtro BE). // info-only

[S2] 2026-04-29 09:12 iter2 NEW-FINDING reports/utilizacion packageId — el filtro packageId quedó como backlog Sprint 5 (originalmente flagged en `[S2] iter1 NEW-FINDING admin/(app)/reports/utilizacion`). Si stakeholders priorizan, BE debe: (a) extender `UtilizacionQuerySchema` con `packageId: z.string().uuid().optional()`; (b) en `ReportsService.getUtilizacion` agregar `packageId` a `cacheKey` + `where: { ...tenantWhere, ...(packageId ? { coverage: { packageId } } : {}) }` en `coverageUsage.groupBy`; (c) FE agrega `packageId?: string` a `UtilizacionFilters` + `<PackageSelector />` en la página. // for-S1 + for-stakeholders

[S2] 2026-04-29 09:14 iter2 iter2-complete — verificación completada: `packageId` filter NO entró en S1 iter 2; ningún cambio FE necesario. Hooks + UI siguen alineados al BE actual.
