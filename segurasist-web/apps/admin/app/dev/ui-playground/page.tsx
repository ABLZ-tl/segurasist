/**
 * `/dev/ui-playground` — DS-1 Sprint 5 component sandbox.
 *
 * Gated by `NODE_ENV !== 'production'`. The page mounts the playground from
 * `@segurasist/ui` so we keep zero design-system code in the admin app.
 * In production this returns `notFound()` to avoid leaking dev surfaces.
 */
import { notFound } from 'next/navigation';
import { UiPlaygroundPage } from '@segurasist/ui';

const IS_DEV = process.env.NODE_ENV !== 'production';

export default function UiPlaygroundRoute(): JSX.Element {
  if (!IS_DEV) {
    notFound();
  }
  return <UiPlaygroundPage enabled />;
}
