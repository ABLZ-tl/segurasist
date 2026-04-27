/**
 * S3-06 — Local hook re-export para la vista 360° del asegurado.
 *
 * La lógica vive en `@segurasist/api-client/hooks/insureds`. El admin app
 * re-exporta acá por convención del story (`apps/admin/lib/hooks/...`) y
 * para permitir overrides locales (e.g. `vi.mock` puntual en tests del
 * componente sin tocar el package compartido).
 */

export { useInsured360, insuredsKeys } from '@segurasist/api-client/hooks/insureds';
export type { Insured360 } from '@segurasist/api-client';
