# ADR-012 — Cross-Region DR a us-east-1 (revisado por ADR-014)

- Status: accepted (revisado por ADR-014, 2026-04-25)
- Date: 2026-04-25
- Decision-makers: Tech Lead, DevOps Lead, CISO
- Reference: Arquitectura SegurAsist §7.12

## Contexto

El doc Arquitectura original (§7.12) definía DR cross-region como `us-east-1 → us-east-2`. Tras el ADR-014 que cambió la región primaria a `mx-central-1` por requerimiento de Roy/MAC, la pareja DR cambió.

## Decisión

DR cross-region: **`mx-central-1` (primary) → `us-east-1` (secondary)**.

Razones:
- `us-east-1` tiene la mayor disponibilidad de servicios AWS (incluyendo los que requieren región fija como ACM-for-CloudFront).
- Latencia desde CDMX a `us-east-1`: ~70 ms (aceptable para DR manual con RTO 4h).
- Reduce número de regiones distintas a operar (la que ya usamos para CloudFront/Amplify ACM).

## Consecuencias

- RDS cross-region read replica desde mx-central-1 hacia us-east-1.
- S3 cross-region replication para buckets `audit`, `certificates`, `exports`.
- Runbook RB-003 (failover) actualizado con el nuevo destino.
- Costo de transferencia entre regiones: ~$0.02/GB (calculado en presupuesto).

## Alternativas consideradas

- **us-east-2 (Ohio)**: era el DR original. Rechazado para evitar operar 3 regiones distintas (mx-central-1 + us-east-1 para CloudFront + us-east-2 para DR).
- **sa-east-1 (São Paulo)**: más cercano geopolíticamente pero tiene menos servicios y sale más caro (~+25%).
- **mx-central-1 multi-AZ sin DR cross-region**: insuficiente — un evento regional (cortes en zona, problemas de conectividad regional con AWS) dejaría el servicio caído más allá del RTO contractual.
