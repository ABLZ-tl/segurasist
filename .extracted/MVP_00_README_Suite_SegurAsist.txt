README de la Suite Documental — MVP SegurAsist
Índice maestro · Mapa de lectura por rol · FAQ · Insumos previos
Campo
Valor
Documento
README de la Suite Documental — MVP SegurAsist
Versión
v1.0 – Abril 2026
Audiencia
Todo el equipo + Roy
Clasificación
Interno – Confidencial
Cliente ancla
Hospitales MAC – Roy / Innovación Segura
Fecha
2026-04-25

1. Propósito
Este README es la portada de la suite documental del MVP SegurAsist (Hospitales MAC, abril 2026). Indexa los 8 documentos generados, indica el orden de lectura sugerido por rol y los puntos de entrada por pregunta frecuente.
La suite se construye a partir de tres insumos previos ya cerrados: la propuesta a Roy del 14 de abril, la Matriz de Evaluación SaaS V2 (88.7% cumplimiento, riesgo Medio) y el Stack Tecnológico Definitivo (100% AWS, decisiones cerradas). Toda la documentación parte del supuesto de que esas tres bases no se discuten.

2. Inventario de la suite
#
Documento
Audiencia primaria
Owner
00
MVP_00_README_Suite_SegurAsist.docx (este documento)
Todo el equipo + Roy
PM
01
MVP_01_PRD_SegurAsist.docx — Product Requirements Document
PO, PM, leads, sponsor
PO
02
MVP_02_Plan_Proyecto_SegurAsist.docx — Sprints, RACI, ceremonias, riesgos
PM, leads, sponsor
PM
03
MVP_03_Arquitectura_SegurAsist.docx — C4 + ADRs + modelo de datos multi-tenant
Tech Lead, BE, FE, DevOps, CISO
Tech Lead
04
MVP_04_Backend_NestJS_SegurAsist.docx — API, módulos, workers, datos, observabilidad
Backend, Tech Lead, DevOps, QA
Backend Lead
05
MVP_05_Frontend_NextJS_SegurAsist.docx — Monorepo Next.js, design system, pantallas
Frontend, UX, QA, Tech Lead
Frontend Lead
06
MVP_06_DevOps_IaC_SegurAsist.docx — AWS, Terraform, CI/CD, observabilidad, DR
DevOps, SRE, Tech Lead, CISO
DevOps Lead
07
MVP_07_QA_Pruebas_SegurAsist.docx — Estrategia QA, casos críticos, cross-tenant gate, UAT
QA, leads, CISO
QA Lead
08
MVP_08_Seguridad_Cumplimiento_SegurAsist.docx — Mapeo V2 → implementación
CISO, Tech Lead, DevOps, QA
CISO
Todos los documentos están en /Users/ablz/Documents/Claude/Projects/SegurAsist/, junto con los insumos originales (matriz V2, presentación, stack definitivo, plan cumplimiento).

3. Mapa de lectura por rol
3.1 Tech Lead
	•	Arquitectura (03) — entender los pilares y ADRs cerrados.
	•	Backend (04) — validar contratos y estructura.
	•	Frontend (05) — validar consistencia con backend.
	•	DevOps (06) — alinear con DevOps Lead sobre IaC y CI/CD.
	•	Seguridad (08) — entender controles activos.
	•	PRD (01) y Plan (02) — para discusiones con PO/PM.
3.2 Backend Senior
	•	PRD (01) §4 — requerimientos funcionales por feature.
	•	Arquitectura (03) — modelo de datos, RLS, ADRs.
	•	Backend (04) — su biblia día a día.
	•	Seguridad (08) — controles que implementar en código.
	•	QA (07) §4 cross-tenant gate — su PR no merge sin esto.
	•	DevOps (06) §13 — Dockerfile y deploy.
3.3 Frontend Senior
	•	PRD (01) — personas, journeys, criterios.
	•	Frontend (05) — biblia día a día.
	•	Backend (04) §6 — endpoints REST y formato de errores.
	•	QA (07) §3.4 — casos críticos del portal asegurado.
	•	Arquitectura (03) §3 — composición de contenedores.
	•	Seguridad (08) §3.13, §3.16 — headers y autenticación.
3.4 DevOps / SRE
	•	DevOps (06) — biblia día a día.
	•	Arquitectura (03) §5, §9 — despliegue y seguridad arquitectónica.
	•	Seguridad (08) §3.22-3.25, §5 — controles de infraestructura.
	•	Backend (04) §13, §14 — Dockerfile, env vars.
	•	QA (07) §5, §6 — DAST y performance gates.
	•	Plan (02) §4.1 Sprint 0 — checklist de habilitadores.
3.5 QA Lead
	•	PRD (01) §4 — criterios de aceptación a probar.
	•	QA (07) — biblia día a día.
	•	Backend (04) §12 — strategy backend testing.
	•	Frontend (05) §10 — strategy frontend testing.
	•	Seguridad (08) §3.12-3.15, §5 — controles que QA verifica.
	•	Plan (02) §9 DoD — checklist por historia.
3.6 Product Owner
	•	PRD (01) — biblia.
	•	Plan (02) — sprints, RACI, ceremonias.
	•	Frontend (05) §4, §5 — pantallas para validar con stakeholders.
	•	QA (07) §8 UAT — preparar scripts con MAC.
	•	Seguridad (08) §7 — qué comunicar a MAC sobre cumplimiento.
3.7 Project Manager
	•	Plan (02) — biblia.
	•	PRD (01) §1, §6, §8 — alcance, KPIs, riesgos.
	•	DevOps (06) §11 costos — para reporting financiero.
	•	QA (07) §10, §11 release gates y métricas — para criterios Go-Live.
	•	Seguridad (08) §7 — comunicación periódica a MAC.
3.8 CISO
	•	Seguridad (08) — biblia.
	•	Arquitectura (03) §9 — visión arquitectónica de seguridad.
	•	Backend (04) §10 — controles en código.
	•	DevOps (06) §10 — hardening continuo.
	•	QA (07) §4, §5 — gates seguridad.
	•	Plan (02) §9.3 release-ready — gates que aprueba CISO.
3.9 Roy (Sponsor)
	•	PRD (01) §1 resumen ejecutivo + §6 KPIs.
	•	Plan (02) §1 hitos + §7 plan de comunicación.
	•	Seguridad (08) §2 resumen + §7 comunicación a MAC.
	•	DevOps (06) §11 costos — postura financiera.

4. Preguntas frecuentes (entrada rápida)
Si necesitas...
Ve a...
Entender qué entregamos a MAC en el MVP
PRD (01) §1.2 + Plan (02) §1.1 hitos
Saber por qué AWS y no GCP
Arquitectura (03) §7.1 ADR-001 + Stack Definitivo §2.1
Saber cómo se aísla MAC de futuros clientes
Arquitectura (03) §4.2 + Backend (04) §4.4 + Seguridad (08) §3.15
Conocer la estructura de carpetas backend
Backend (04) §2
Conocer la estructura de carpetas frontend
Frontend (05) §2
Saber el formato de errores de la API
Backend (04) §5.2
Entender los gates de release
Plan (02) §9.3 + QA (07) §10.3
Saber qué tests son bloqueantes para PR
QA (07) §4 cross-tenant + §10.1
Conocer los SLAs de uptime y RTO/RPO
PRD (01) §5.2 + DevOps (06) §9
Conocer los costos AWS estimados
Stack Definitivo §3 + DevOps (06) §11
Saber cómo deplegamos a producción
DevOps (06) §6 + Backend (04) §13
Conocer el plan de UAT con MAC
QA (07) §8 + Plan (02) §4.6
Saber por qué Cognito y no Auth0
Arquitectura (03) §7.4 ADR-004 + Stack Definitivo §2.3
Saber cómo los certificados se generan y entregan
PRD (01) §4.3 + Backend (04) §7.2 + §7.3
Saber qué hacer en una brecha
DevOps (06) §8.4 RB-010 + Seguridad (08) §3.20
Saber qué pasa con los datos al fin de contrato
PRD (01) §1.3 fuera de alcance + Seguridad (08) §3.32, §3.33

5. Insumos previos no incluidos en esta suite
Estos documentos son fundamento y se asumen leídos:
Documento
Versión
Aporte
Propuesta Hospitales MAC (Presentacion_Hospitales_MAC.pptx)
v1.0 - 14 abr 2026
Define las 6 funcionalidades del MVP, modelo económico, fases
Matriz_Evaluacion_SaaS_Proveedores-HospitalesMAC_v2.xlsx
v2 - 25 abr 2026
33 controles evaluados; 88.7% cumplimiento sostenido
Cuestionario_Seguridad_SegurAsist.xlsx
abril 2026
Respuestas técnicas detalladas por control
Stack_Tecnologico_Definitivo_SegurAsist.docx
v1.0 - 24 abr 2026
Decisiones de arquitectura cerradas; cero ambigüedad de tooling
Plan_Accion_Cumplimiento_SegurAsist.docx
abril 2026
Roadmap ISO 27001 + SOC 2; gaps remediation
Propuesta_Tecnica_Hospitales_MAC.docx (Entregable)
abril 2026
Especificación técnica entregada al cliente
Pricing_Hospitales_MAC.xlsx
abril 2026
Modelo económico 3 años

6. Mantenimiento de la suite
	•	Convención de versiones: vMAYOR.MENOR. Cambio MAYOR = decisión arquitectónica nueva o cambio de scope. MENOR = correcciones, refinamientos.
	•	Owner por documento es responsable de mantenerlo al día. Cambios significativos se anuncian en #segurasist-eng.
	•	Cualquier ADR nuevo se publica primero en /docs/adr/ del repo segurasist-infra y se referencia desde el doc Arquitectura en su próxima versión.
	•	Plan (02) se actualiza cada fin de sprint con velocidad real, riesgos cerrados, hitos avanzados. PM responsable.
	•	Seguridad (08) se re-evalúa formalmente cada 6 meses contra una matriz V3, V4, etc.
	•	Esta suite se entrega bajo NDA y nunca se publica externamente sin redacción de información sensible.
7. Próximos pasos al recibir esta suite
	•	Roy revisa PRD (01), Plan (02) y comunica fecha de firma de contrato.
	•	Tech Lead convoca al equipo a sesión de alineamiento (D-1 del Plan).
	•	DevOps inicia checklist Sprint 0 (Plan §3): cuentas AWS, sandbox SES, repos GitHub.
	•	CISO firma acuse de Mapeo Seguridad (08) y archiva en repo Compliance.
	•	PM agenda kick-off oficial (Día 1) y configura Linear / Slack / status semanal.
	•	Equipo lee documentos asignados según mapa de lectura (§3) en los primeros 2 días hábiles.
