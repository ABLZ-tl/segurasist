/**
 * Sprint 5 — S5-3 finisher (iter 2).
 *
 * Helper que mapea acciones del editor KB a iconos visuales. Históricamente
 * apuntaba al catálogo Lordicon publicado por DS-1
 * (`@segurasist/ui/lord-icon/catalog.ts`). En iter 2 verificamos que DS-1
 * NO ha publicado aún los IDs `<TODO_ID_LAB_FLASK>` ni `<TODO_ID_IMPORT_EXPORT>`
 * — `listUnresolvedIcons()` los sigue listando.
 *
 * Decisión iter 2 (CC-15):
 *   - Para los nombres del catálogo que SÍ están resueltos (`edit-pencil`,
 *     `trash-bin`, `checkmark-success`, `warning-triangle`, `search`)
 *     seguimos usando `<LordIcon>` — cero regresión visual.
 *   - Para los nombres con `<TODO_ID_*>` (`lab-flask`, `import-export`)
 *     fallback a Lucide icons (consistente con el resto de S5-3 — el
 *     drawer de edición ya importa `lucide-react`). Esto evita el render
 *     de un span vacío sized en empty-state, panel test-match y CSV
 *     dropzone, que es la peor UX posible (white-square del fallback span).
 *
 * Cuando DS-1 publique los IDs definitivos en el catálogo, este archivo es
 * el único punto a tocar para volver a `<LordIcon>` — los call sites
 * consumen el componente `<KbIcon>` por kind en vez de un name de catálogo.
 *
 * Nota: este módulo es `.ts` (no `.tsx`) — usamos `React.createElement`
 * para mantener la convención del archivo iter 1 y minimizar diff churn.
 * El import path no cambia (`./_lordicons`), así que los tests existentes
 * siguen siendo validos.
 */
import * as React from 'react';
import { LordIcon, type LordIconName } from '@segurasist/ui';
import {
  Edit3,
  FlaskConical,
  Search as SearchIcon,
  ShieldAlert,
  Trash2,
  Upload,
  CheckCircle2,
} from 'lucide-react';

/**
 * Catálogo "logical" — mapea propósitos del editor a nombres del catálogo
 * Lordicon. Mantenemos `KB_ICONS` como string-table para no romper imports
 * que ya lo consumen y para servir como single-source-of-truth de los
 * nombres canónicos. Los call sites NUEVOS deben usar `<KbIcon kind="...">`.
 */
export const KB_ICONS = {
  rowEdit: 'edit-pencil',
  rowDelete: 'trash-bin',
  testMatch: 'lab-flask',
  csvImport: 'import-export',
  emptyState: 'lab-flask',
  saveSuccess: 'checkmark-success',
  warning: 'warning-triangle',
  search: 'search',
} as const satisfies Record<string, LordIconName>;

export type KbIconKey = keyof typeof KB_ICONS;

/**
 * Claves cuyo `<TODO_ID_*>` aún no fue resuelto por DS-1 → render via Lucide.
 * Cuando DS-1 publique los IDs en `catalog.ts`, **borrar entradas** de este
 * Set para volver al render Lordicon. Auditable mediante:
 *   `import { listUnresolvedIcons } from '@segurasist/ui';`
 */
const UNRESOLVED_KIND: ReadonlySet<KbIconKey> = new Set([
  'testMatch',
  'csvImport',
  'emptyState',
]);

const LUCIDE_FALLBACK: Record<
  KbIconKey,
  React.ComponentType<{ size?: number | string; className?: string }>
> = {
  rowEdit: Edit3,
  rowDelete: Trash2,
  testMatch: FlaskConical,
  csvImport: Upload,
  emptyState: FlaskConical,
  saveSuccess: CheckCircle2,
  warning: ShieldAlert,
  search: SearchIcon,
};

export interface KbIconProps {
  kind: KbIconKey;
  size?: number;
  /** Trigger Lordicon — ignorado en fallback Lucide. */
  trigger?: 'hover' | 'click' | 'loop' | 'in';
  className?: string;
  /** Override aria-label si el icono es informativo y no decorativo. */
  ariaLabel?: string;
}

/**
 * Adapter que renderiza Lordicon o Lucide según el estado del catálogo.
 * El call site dice `kind="csvImport"` y obtiene el mejor visual disponible.
 * Cuando el catálogo Lordicon esté completo, `UNRESOLVED_KIND` queda vacío
 * y todos los renders vuelven a Lordicon — sin tocar call sites.
 */
export function KbIcon({
  kind,
  size = 24,
  trigger = 'hover',
  className,
  ariaLabel,
}: KbIconProps): JSX.Element {
  if (UNRESOLVED_KIND.has(kind)) {
    const Lucide = LUCIDE_FALLBACK[kind];
    return React.createElement(Lucide, { size, className });
  }
  return React.createElement(LordIcon, {
    name: KB_ICONS[kind],
    trigger,
    size,
    className,
    ariaLabel,
  });
}
