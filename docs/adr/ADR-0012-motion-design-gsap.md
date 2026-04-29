# ADR-0012 — Motion design: GSAP como engine único

- **Status**: Accepted (Sprint 5 iter 1, 2026-04-28)
- **Authors**: DS-1 (Design System Lead)
- **Audit refs**: `docs/sprint5/DISPATCH_PLAN.md` §Coordinación, pedido explícito Tech Lead 2026-04-28
- **Trigger**: El cliente exigió "UI/UX de alto valor, no genérica" y mencionó GSAP por nombre. Necesitamos una decisión vinculante para que MT-2, MT-3 y S5-3 consuman las mismas primitives sin reintroducir Framer Motion o CSS-only en paralelo.

## Context

SegurAsist está cerrando Sprint 5 con un design system maduro
(`packages/ui` ~26 componentes Radix + tokens + Storybook). Sprint 5 añade
dos features de alto valor visual:

1. Branding por tenant configurable desde admin (logos, colores, fondo).
2. Transiciones, page transitions y micro-interacciones de calidad
   "premium" en admin y portal.

Hay tres familias razonables de motion engines:

- **A) GSAP free + ScrollTrigger** — pidió el cliente; ecosistema maduro,
  control fine-grained, timelines, ScrollTrigger free. Penaliza bundle
  (~50KB gzipped core, +20KB ScrollTrigger).
- **B) Framer Motion** — idiomático en React, declarativo, layout
  animations potentes. Bundle similar. Cubre 80 % de los casos pero
  ScrollTrigger / smooth scroll requieren plugin extra y la API
  declarativa colisiona con flujos imperativos (e.g. tween en respuesta
  a un evento WebSocket).
- **C) CSS-only + Tailwind animate** — gratis, cero JS, perfecto para
  hover básico. Insuficiente para page transitions con Next App Router
  (necesitamos hookear el cambio de pathname) y para staggered entrance
  con timelines complejos.

## Decision

**Adoptamos GSAP free como motion engine único** para SegurAsist desde
Sprint 5. Esta decisión cubre admin, portal y cualquier app futura.

Reglas:

1. GSAP se instala únicamente en `@segurasist/ui` (`packages/ui`). Ninguna
   app debe declarar `gsap` en su `package.json` propio (DRY + bundle
   único, evitar dupes en Next chunking).
2. Las apps consumen las primitives desde `@segurasist/ui`:
   `<GsapFade>`, `<GsapStagger>`, `<PageTransition>`, `<GsapHover>` y
   el hook `useGsap`.
3. Toda primitive GSAP TIENE QUE respetar
   `prefers-reduced-motion: reduce`. Cuando el usuario lo pide, la
   animación se vuelve un `gsap.set` instantáneo. Esto es WCAG 2.3.3
   (no opcional).
4. Plugins GSAP pagos (SplitText, MorphSVG, etc.) NO se usan sin
   escalación a Tech Lead. ScrollTrigger gratis es suficiente para
   Sprint 5.
5. SSR safety: cualquier archivo que importe `gsap` debe estar bajo
   `'use client'`. La ejecución del tween va dentro de `useEffect` con
   cleanup `kill()` en unmount. Esto evita reflows durante hydration.
6. Tests jsdom mockean `gsap` con stubs por método (`fromTo`, `set`,
   `to`, `from`, `kill`). Las primitives DEBEN ser unit-testables sin
   ejecutar animaciones reales.

## Consequences

**Positivas**

- Una sola API consistente para todo motion en SegurAsist.
- Cliente recibe lo que pidió textualmente.
- Reduced-motion garantizado a nivel de componente, no responsabilidad
  del consumidor.
- Bundle único al estar en `@segurasist/ui`; Next dedupea.

**Negativas / trade-offs**

- ~70KB gzipped extras en client bundle. Mitigación: code-split por
  ruta + dynamic import de las páginas más pesadas.
- API imperativa requiere envolver en componentes/hook con
  cleanup obligatorio, vs Framer Motion que limpia automáticamente.
- Si en el futuro necesitamos SplitText / MorphSVG (motion premium real),
  habrá que evaluar licencia GSAP Business (~$199/año/dev). Lo
  escalamos.

## Alternatives rejected

- **Framer Motion**: la API declarativa es bonita pero crea fricción al
  controlar timelines complejos y page transitions con App Router. La
  decisión del cliente es vinculante.
- **CSS-only / Tailwind animate**: insuficiente para page transitions
  con cambios de ruta y staggered entrance complejos.

## Validation

- `packages/ui/src/animations/**` con tests jsdom verde
  (`gsap-fade.spec.tsx`).
- Reduced-motion: cubierto en test (`setReducedMotion(true)` →
  `gsap.set` no `fromTo`).
- DEVELOPER_GUIDE.md (post code-freeze) añade la regla "no instalar
  gsap fuera de @segurasist/ui" en la sección DRY.
