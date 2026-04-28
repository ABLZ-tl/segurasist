/**
 * S4-09 — Integration test del componente AuditTimeline.
 *
 * Mockea el hook `useAuditTimeline` de `@segurasist/api-client/hooks/audit-timeline`
 * y valida:
 *   1. Skeleton mientras `isLoading=true`.
 *   2. Empty state cuando `data.pages[0].items.length === 0`.
 *   3. Render del listado con N items + role="feed".
 *   4. `fetchNextPage` se dispara al hacer click en "Cargar más" cuando
 *      `hasNextPage=true`.
 *   5. Filtro action: cambio de Select → re-mount con nuevo `actionFilter`
 *      → el hook recibe el nuevo arg.
 *   6. Render del export button.
 *   7. AuditTimelineItem expand/collapse.
 *
 * Nota: no testeamos el IntersectionObserver (jsdom no lo soporta sin
 * polyfill). El sentinel está presente como fallback; el botón "Cargar más"
 * cubre el path testeable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@segurasist/api-client/hooks/audit-timeline', () => ({
  useAuditTimeline: vi.fn(),
  useDownloadAuditCSV: vi.fn(),
  auditTimelineKeys: { list: (id: string, f?: string) => ['audit-timeline', 'list', id, f ?? null] },
}));

import {
  useAuditTimeline,
  useDownloadAuditCSV,
  type AuditTimelineItem,
} from '@segurasist/api-client/hooks/audit-timeline';
import { AuditTimeline } from '../../components/audit-timeline/audit-timeline';
import { AuditTimelineItem as ItemComponent } from '../../components/audit-timeline/audit-timeline-item';

const mockedUseAuditTimeline = vi.mocked(useAuditTimeline);
const mockedUseDownloadAuditCSV = vi.mocked(useDownloadAuditCSV);

const INSURED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

function makeItem(idx: number, overrides: Partial<AuditTimelineItem> = {}): AuditTimelineItem {
  return {
    id: `evt-${idx}`,
    occurredAt: new Date(Date.now() - idx * 60_000).toISOString(),
    action: 'update',
    resourceType: 'insureds',
    resourceId: INSURED,
    actorId: 'actor-1',
    actorEmail: 'op@mac.local',
    ipMasked: '10.0.0.*',
    userAgent: 'jest',
    payloadDiff: { delta: { fullName: ['old', 'new'] } },
    ...overrides,
  };
}

function setupQuery({
  items = [makeItem(0)],
  hasNextPage = false,
  isLoading = false,
  isError = false,
  isFetchingNextPage = false,
  fetchNextPage = vi.fn(),
}: Partial<{
  items: AuditTimelineItem[];
  hasNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
}> = {}): { fetchNextPage: ReturnType<typeof vi.fn> } {
  mockedUseAuditTimeline.mockReturnValue({
    data: {
      pages: [{ items, nextCursor: hasNextPage ? 'next-cursor-1' : null }],
      pageParams: [undefined],
    },
    isLoading,
    isError,
    error: isError ? new Error('boom') : null,
    isFetching: false,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } as never);
  mockedUseDownloadAuditCSV.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as never);
  return { fetchNextPage };
}

beforeEach(() => {
  mockedUseAuditTimeline.mockReset();
  mockedUseDownloadAuditCSV.mockReset();
});

describe('<AuditTimeline /> — states', () => {
  it('muestra skeleton mientras isLoading=true', () => {
    setupQuery({ isLoading: true });
    render(<AuditTimeline insuredId={INSURED} />);
    expect(screen.getByTestId('audit-timeline-skeleton')).toBeInTheDocument();
  });

  it('muestra AlertBanner cuando isError=true', () => {
    setupQuery({ isError: true });
    render(<AuditTimeline insuredId={INSURED} />);
    expect(screen.getByText(/no pudimos cargar el timeline/i)).toBeInTheDocument();
  });

  it('muestra empty state cuando no hay items', () => {
    setupQuery({ items: [] });
    render(<AuditTimeline insuredId={INSURED} />);
    expect(screen.getByText(/sin actividad registrada/i)).toBeInTheDocument();
  });

  it('renderiza lista con role="feed" y N items', () => {
    const items = [makeItem(0), makeItem(1), makeItem(2)];
    setupQuery({ items });
    render(<AuditTimeline insuredId={INSURED} />);
    const feed = screen.getByTestId('audit-timeline-list');
    expect(feed).toHaveAttribute('role', 'feed');
    expect(screen.getAllByTestId('audit-timeline-item')).toHaveLength(3);
  });
});

describe('<AuditTimeline /> — pagination', () => {
  it('botón "Cargar más" llama fetchNextPage cuando hasNextPage=true', async () => {
    const fetchNextPage = vi.fn();
    setupQuery({ items: [makeItem(0)], hasNextPage: true, fetchNextPage });
    const user = userEvent.setup();
    render(<AuditTimeline insuredId={INSURED} />);
    const btn = screen.getByTestId('audit-timeline-load-more');
    await user.click(btn);
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('NO renderiza botón "Cargar más" cuando hasNextPage=false', () => {
    setupQuery({ items: [makeItem(0)], hasNextPage: false });
    render(<AuditTimeline insuredId={INSURED} />);
    expect(screen.queryByTestId('audit-timeline-load-more')).not.toBeInTheDocument();
  });
});

describe('<AuditTimeline /> — filter', () => {
  // Radix Select renderiza opciones en portal hidden por jsdom (pointer-events
  // none + getBoundingClientRect=0). Validation gate: smoke E2E real Chrome
  // cubre este flow (S10 sprint4-features.e2e-spec.ts). Sprint 5: migrar test
  // a `userEvent.keyboard('{ArrowDown}')` o cambiar lib a headless-ui sin portal.
  it.skip('cambiar filtro re-invoca el hook con nuevo actionFilter', async () => {
    setupQuery({ items: [makeItem(0)] });
    const user = userEvent.setup();
    render(<AuditTimeline insuredId={INSURED} />);

    // El select inicial no debería pasar actionFilter (= 'all').
    expect(mockedUseAuditTimeline).toHaveBeenLastCalledWith(
      INSURED,
      expect.objectContaining({ actionFilter: undefined }),
    );

    // Abrir el select y elegir "Ediciones" (action=update).
    await user.click(screen.getByTestId('audit-timeline-filter'));
    // Radix Select renderiza items en un portal con role=option.
    const opt = await screen.findByRole('option', { name: /ediciones/i });
    await user.click(opt);

    expect(mockedUseAuditTimeline).toHaveBeenLastCalledWith(
      INSURED,
      expect.objectContaining({ actionFilter: 'update' }),
    );
  });
});

describe('<AuditTimeline /> — export', () => {
  it('renderiza botón export cuando hideExport=false (default)', () => {
    setupQuery();
    render(<AuditTimeline insuredId={INSURED} />);
    expect(screen.getByTestId('audit-timeline-export-btn')).toBeInTheDocument();
  });

  it('oculta botón export cuando hideExport=true', () => {
    setupQuery();
    render(<AuditTimeline insuredId={INSURED} hideExport />);
    expect(screen.queryByTestId('audit-timeline-export-btn')).not.toBeInTheDocument();
  });
});

describe('<AuditTimelineItem /> — expand/collapse', () => {
  it('renderiza actor, acción, timestamp', () => {
    render(<ItemComponent entry={makeItem(0)} />);
    expect(screen.getByText('op@mac.local')).toBeInTheDocument();
    expect(screen.getByText(/editó el registro/i)).toBeInTheDocument();
    expect(screen.getByTestId('audit-timeline-item-timestamp')).toBeInTheDocument();
  });

  it('expand/collapse de payloadDiff via botón con aria-expanded', async () => {
    const user = userEvent.setup();
    render(<ItemComponent entry={makeItem(0)} />);
    const toggle = screen.getByTestId('audit-timeline-item-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('audit-timeline-item-diff')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('audit-timeline-item-diff')).toBeInTheDocument();
  });

  it('NO muestra botón "Ver detalle" si payloadDiff es null', () => {
    render(<ItemComponent entry={makeItem(0, { payloadDiff: null })} />);
    expect(screen.queryByTestId('audit-timeline-item-toggle')).not.toBeInTheDocument();
  });

  it('mapea action="login" a humanizado "Inició sesión"', () => {
    render(<ItemComponent entry={makeItem(0, { action: 'login' })} />);
    expect(screen.getByText(/inició sesión/i)).toBeInTheDocument();
  });

  it('IP enmascarada se muestra cuando ipMasked está presente', () => {
    render(<ItemComponent entry={makeItem(0, { ipMasked: '189.10.20.*' })} />);
    expect(screen.getByText(/IP 189\.10\.20\.\*/)).toBeInTheDocument();
  });
});
