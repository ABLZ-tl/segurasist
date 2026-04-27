/**
 * S3-06 — Vista 360° del asegurado.
 *
 * Server Component thin wrapper que delega al `Insured360Client`. El client
 * pega contra `/v1/insureds/:id/360` con `useInsured360`, controla URL state
 * de tabs y dispara `notFound()` cuando el backend responde 404.
 *
 * Mantenemos las subrutas hijas (`/coverages`, `/claims`, `/audit`,
 * `/certificates`) como deep-links legacy — Sprint 4 las consolida o las
 * elimina; por ahora no rompen nada porque siguen siendo accesibles vía URL.
 */
import { Insured360Client } from './insured-360-client';

interface PageProps {
  params: { id: string };
}

export default function InsuredDetailPage({ params }: PageProps) {
  return <Insured360Client insuredId={params.id} />;
}
