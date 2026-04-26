import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@segurasist/ui';

export interface AccessDeniedProps {
  /** Optional override for the description copy. */
  description?: string;
}

/**
 * Server-renderable placeholder for routes the current role cannot access.
 *
 * The FE shows this instead of 404 so users get an explanation and a path
 * forward. Authorization itself lives on the API; this is purely UX.
 */
export function AccessDenied({ description }: AccessDeniedProps): JSX.Element {
  return (
    <div
      role="status"
      className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center"
    >
      <div aria-hidden className="mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-elevated text-fg-muted">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h1 className="text-lg font-semibold tracking-tighter text-fg lg:text-xl">
        Acceso restringido
      </h1>
      <p className="mt-1.5 max-w-md text-sm text-fg-muted">
        {description ??
          'No tienes acceso a esta sección con tu rol actual. Si crees que es un error, contacta al administrador del tenant.'}
      </p>
      <div className="mt-5">
        <Button asChild>
          <Link href="/dashboard">Volver al resumen</Link>
        </Button>
      </div>
    </div>
  );
}
