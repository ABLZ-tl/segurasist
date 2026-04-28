'use client';

/**
 * S4-09 — Botón de export CSV del timeline.
 *
 * Click → `useDownloadAuditCSV` mutation → blob → download.
 *
 * UX:
 *   - Disabled durante la mutation (`isPending`).
 *   - Estado de error con AlertBanner inline (auto-hide 5s).
 *   - aria-busy="true" durante la descarga (lectores anuncian el progreso).
 */
import * as React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@segurasist/ui';
import { useDownloadAuditCSV } from '@segurasist/api-client/hooks/audit-timeline';

interface Props {
  insuredId: string;
}

export function AuditTimelineExportButton({ insuredId }: Props): React.ReactElement {
  const { mutateAsync, isPending } = useDownloadAuditCSV(insuredId);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const onClick = React.useCallback(async () => {
    setError(null);
    try {
      await mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar.');
    }
  }, [mutateAsync]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending}
        data-testid="audit-timeline-export-btn"
      >
        <Download aria-hidden className="mr-2 h-4 w-4" />
        {isPending ? 'Generando…' : 'Exportar CSV'}
      </Button>
      {error && (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid="audit-timeline-export-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
