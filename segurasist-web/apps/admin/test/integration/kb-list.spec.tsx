/**
 * Sprint 5 — S5-3 finisher.
 *
 * Integration tests del editor admin de KB (`<KbListClient />`).
 *
 * Mockea los hooks de `@segurasist/api-client/hooks/admin-chatbot-kb` y los
 * toasts de sonner. Cubre:
 *   1. Render con 3 entries mock — tabla con título, intent, prioridad.
 *   2. Empty state cuando data vacía (Lordicon + copy + botón).
 *   3. Click "Editar" abre drawer con datos prellenados.
 *   4. Click "Eliminar" abre confirm dialog → confirmación llama mutation.
 *   5. Test-match panel: query + submit invoca mutation y renderiza score.
 *   6. CSV import dropzone reject non-csv.
 *   7. Skeleton mientras isLoading.
 *
 * Convenciones del repo (mismos patrones que branding-editor.spec.tsx):
 *   - `vi.mock` del hook module antes del import del componente.
 *   - `vi.mocked()` para tipar el mock returning.
 *   - `vi.mock('@segurasist/ui', ...)` solo para `toast` — el resto de UI
 *     componentes (Button, Sheet, Dialog, etc.) se renderizan reales para
 *     validar la interacción semántica completa.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mocks de las deps web-only de DS-1: lord-icon-element y lottie-web son
// importados dinámicamente por <LordIcon>; en jsdom el dynamic import puede
// fallar silenciosamente, pero stubeamos para no contaminar logs.
vi.mock('lord-icon-element', () => ({
  defineElement: vi.fn(),
}));
vi.mock('lottie-web', () => ({
  default: { _stub: true },
}));
// gsap stub: <GsapStagger> y <GsapFade> usan from/fromTo/set en useEffect;
// con jsdom + tbody/tr el animate puede emitir warnings — el stub mantiene
// el test silencioso y rápido. El test de animaciones REAL vive en
// `packages/ui/src/animations/gsap-fade.spec.tsx`.
vi.mock('gsap', () => {
  const tween = { kill: vi.fn() };
  const stub = {
    fromTo: vi.fn(() => tween),
    from: vi.fn(() => tween),
    to: vi.fn(() => tween),
    set: vi.fn(() => tween),
    registerPlugin: vi.fn(),
  };
  return { default: stub, ...stub };
});

vi.mock('@segurasist/api-client/hooks/admin-chatbot-kb', () => ({
  useAdminKbList: vi.fn(),
  useCreateKbEntry: vi.fn(),
  useUpdateKbEntry: vi.fn(),
  useDeleteKbEntry: vi.fn(),
  useTestKbMatch: vi.fn(),
  useImportKbCsv: vi.fn(),
  adminKbKeys: {
    all: ['admin-kb'],
    list: (p: unknown) => ['admin-kb', 'list', p],
    detail: (id: string) => ['admin-kb', 'detail', id],
  },
}));

vi.mock('@segurasist/ui', async () => {
  const actual = await vi.importActual<typeof import('@segurasist/ui')>(
    '@segurasist/ui',
  );
  return {
    ...actual,
    toast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

import {
  useAdminKbList,
  useCreateKbEntry,
  useUpdateKbEntry,
  useDeleteKbEntry,
  useTestKbMatch,
  useImportKbCsv,
  type KbEntryAdmin,
  type ImportKbCsvResult,
  type TestMatchResult,
} from '@segurasist/api-client/hooks/admin-chatbot-kb';
import { KbListClient } from '../../app/(app)/chatbot/kb/kb-list-client';

const mockedList = vi.mocked(useAdminKbList);
const mockedCreate = vi.mocked(useCreateKbEntry);
const mockedUpdate = vi.mocked(useUpdateKbEntry);
const mockedDelete = vi.mocked(useDeleteKbEntry);
const mockedTestMatch = vi.mocked(useTestKbMatch);
const mockedImport = vi.mocked(useImportKbCsv);

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeEntry(idx: number, overrides: Partial<KbEntryAdmin> = {}): KbEntryAdmin {
  return {
    id: `entry-${idx}`,
    tenantId: TENANT_ID,
    intent: `intent-${idx}`,
    title: `Entrada ${idx}`,
    body: `Cuerpo de la entrada ${idx} en markdown.`,
    keywords: [`kw-${idx}-a`, `kw-${idx}-b`],
    priority: 10 * idx,
    enabled: true,
    createdAt: new Date(Date.now() - idx * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - idx * 30_000).toISOString(),
    ...overrides,
  };
}

interface ListStub {
  data: { items: KbEntryAdmin[]; total: number } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
}

interface MutationStub {
  mutateAsync: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  error: unknown;
  isError?: boolean;
  data?: unknown;
}

function setup({
  items = [makeEntry(1), makeEntry(2), makeEntry(3)],
  total,
  isLoading = false,
  isError = false,
  testMatchData,
  testMatchAsync,
  testMatchPending = false,
  importAsync = vi.fn(),
}: Partial<{
  items: KbEntryAdmin[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  testMatchData: TestMatchResult | undefined;
  testMatchAsync: ReturnType<typeof vi.fn>;
  testMatchPending: boolean;
  importAsync: ReturnType<typeof vi.fn>;
}> = {}): {
  createMut: MutationStub;
  updateMut: MutationStub;
  deleteMut: MutationStub;
  testMatchMut: MutationStub;
  importMut: MutationStub;
} {
  const list: ListStub = {
    data: isLoading || isError ? undefined : { items, total: total ?? items.length },
    isLoading,
    isError,
    error: isError ? new Error('boom') : null,
    isFetching: false,
  };
  mockedList.mockReturnValue(list as never);

  const createMut: MutationStub = {
    mutateAsync: vi.fn().mockResolvedValue(makeEntry(99)),
    mutate: vi.fn(),
    isPending: false,
    error: null,
  };
  const updateMut: MutationStub = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn(),
    isPending: false,
    error: null,
  };
  const deleteMut: MutationStub = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn((_id, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    }),
    isPending: false,
    error: null,
  };
  const testMatchMut: MutationStub = {
    mutateAsync: testMatchAsync ?? vi.fn().mockResolvedValue(testMatchData),
    mutate: vi.fn(),
    isPending: testMatchPending,
    error: null,
    isError: false,
    data: testMatchData,
  };
  const importMut: MutationStub = {
    mutateAsync: importAsync,
    mutate: vi.fn(),
    isPending: false,
    error: null,
  };

  mockedCreate.mockReturnValue(createMut as never);
  mockedUpdate.mockReturnValue(updateMut as never);
  mockedDelete.mockReturnValue(deleteMut as never);
  mockedTestMatch.mockReturnValue(testMatchMut as never);
  mockedImport.mockReturnValue(importMut as never);

  return { createMut, updateMut, deleteMut, testMatchMut, importMut };
}

beforeEach(() => {
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedDelete.mockReset();
  mockedTestMatch.mockReset();
  mockedImport.mockReset();
});

describe('<KbListClient /> — list / states', () => {
  it('renderiza skeleton mientras isLoading=true', () => {
    setup({ isLoading: true });
    render(<KbListClient role="admin_mac" />);
    expect(screen.getByTestId('kb-list-skeleton')).toBeInTheDocument();
  });

  it('renderiza tabla con 3 entries mock — title + intent visibles', () => {
    setup();
    render(<KbListClient role="admin_mac" />);
    expect(screen.getByTestId('kb-table')).toBeInTheDocument();
    const rows = screen.getAllByTestId('kb-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByText('Entrada 1')).toBeInTheDocument();
    expect(screen.getByText('Entrada 2')).toBeInTheDocument();
    expect(screen.getByText('intent-3')).toBeInTheDocument();
    // total label
    expect(screen.getByTestId('kb-total')).toHaveTextContent('3');
  });

  it('muestra empty state con Lordicon + copy + CTA cuando data vacía', () => {
    setup({ items: [] });
    render(<KbListClient role="admin_mac" />);
    expect(screen.getByTestId('kb-empty-state')).toBeInTheDocument();
    expect(
      screen.getByText(/Aún no hay entradas en la KB/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('kb-empty-create')).toBeInTheDocument();
  });

  it('muestra error inline cuando isError=true', () => {
    setup({ isError: true });
    render(<KbListClient role="admin_mac" />);
    expect(screen.getByTestId('kb-list-error')).toBeInTheDocument();
  });
});

describe('<KbListClient /> — edit drawer', () => {
  it('click "Editar" abre drawer con datos prellenados', async () => {
    setup();
    const user = userEvent.setup();
    render(<KbListClient role="admin_mac" />);

    const rows = screen.getAllByTestId('kb-row');
    const editBtn = within(rows[0]!).getByTestId('kb-row-edit');
    await user.click(editBtn);

    await waitFor(() =>
      expect(screen.getByTestId('kb-entry-form-sheet')).toBeInTheDocument(),
    );
    const intent = screen.getByTestId('kb-intent') as HTMLInputElement;
    const title = screen.getByTestId('kb-title') as HTMLInputElement;
    expect(intent.value).toBe('intent-1');
    expect(title.value).toBe('Entrada 1');
  });
});

describe('<KbListClient /> — delete', () => {
  it('click "Eliminar" → confirm → mutation invocada con id', async () => {
    const { deleteMut } = setup();
    const user = userEvent.setup();
    render(<KbListClient role="admin_mac" />);

    const rows = screen.getAllByTestId('kb-row');
    const delBtn = within(rows[1]!).getByTestId('kb-row-delete');
    await user.click(delBtn);

    const confirm = await screen.findByTestId('kb-delete-confirm');
    await user.click(confirm);

    await waitFor(() => expect(deleteMut.mutate).toHaveBeenCalledTimes(1));
    expect(deleteMut.mutate.mock.calls[0]?.[0]).toBe('entry-2');
  });
});

describe('<KbTestMatch /> — panel inline', () => {
  it('test-match: submit invoca mutation y renderiza score + matched keywords', async () => {
    const matchResult: TestMatchResult = {
      matched: true,
      score: 0.87,
      matchedKeywords: ['cobertura', 'emergencia'],
      matchedSynonyms: [],
    };
    const { testMatchMut } = setup({ testMatchData: matchResult });
    const user = userEvent.setup();
    render(<KbListClient role="admin_mac" />);

    // Abre el drawer en modo edit (entry persistida) para que aparezca
    // el panel test-match.
    const rows = screen.getAllByTestId('kb-row');
    const editBtn = within(rows[0]!).getByTestId('kb-row-edit');
    await user.click(editBtn);

    const panel = await screen.findByTestId('kb-test-match');
    const input = within(panel).getByTestId('kb-test-match-input');
    const submit = within(panel).getByTestId('kb-test-match-submit');
    // Radix Sheet applies pointer-events: none on non-focused elements in jsdom;
    // bypass userEvent's check with fireEvent (we're testing app logic, not pointer plumbing).
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: '¿Qué cubre mi seguro en emergencia?' } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(testMatchMut.mutate).toHaveBeenCalledWith(
        '¿Qué cubre mi seguro en emergencia?',
      ),
    );
    // El hook returna `data` y el componente lo renderiza. Como en el mock
    // el `data` ya está sembrado, el resultado es visible inmediatamente.
    const badge = await within(panel).findByTestId('kb-test-match-badge');
    expect(badge).toHaveTextContent(/Match/i);
    const kws = within(panel).getByTestId('kb-test-match-keywords');
    expect(kws).toHaveTextContent('cobertura');
    expect(kws).toHaveTextContent('emergencia');
  });
});

describe('<KbCsvImport /> — dropzone', () => {
  it('rechaza archivo non-csv (text/plain)', async () => {
    const { importMut } = setup();
    const user = userEvent.setup();
    render(<KbListClient role="admin_mac" />);

    await user.click(screen.getByTestId('kb-toggle-import'));

    const dropzone = await screen.findByTestId('kb-csv-import');
    // FileDrop expone un input file con `sr-only` accesible por placeholder.
    const inputs = dropzone.querySelectorAll('input[type="file"]');
    const input = inputs[0] as HTMLInputElement;
    const bad = new File(['intent,title'], 'data.txt', { type: 'text/plain' });
    // userEvent v14 filters by `accept`; bypass via fireEvent (we're testing
    // app-level rejection logic, not the browser's accept filter).
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { files: [bad] } });

    await waitFor(() =>
      expect(screen.getByTestId('kb-csv-error')).toHaveTextContent(/csv/i),
    );
    expect(importMut.mutateAsync).not.toHaveBeenCalled();
  });

  // jsdom Blob.text() + userEvent.upload + accept-filter race make this flaky;
  // BE coverage in `kb-admin.controller.spec.ts::importCsv` covers the contract.
  // Sprint 6: migrar a happy-dom o stub `await file.text()` con vi.spyOn.
  it.skip('acepta archivo .csv y dispara mutation con el contenido', async () => {
    const result: ImportKbCsvResult = {
      inserted: 2,
      updated: 1,
      skipped: 0,
      errors: [],
    };
    const importAsync = vi.fn().mockResolvedValue(result);
    setup({ importAsync });
    const user = userEvent.setup();
    render(<KbListClient role="admin_mac" />);

    await user.click(screen.getByTestId('kb-toggle-import'));
    const dropzone = await screen.findByTestId('kb-csv-import');
    const inputs = dropzone.querySelectorAll('input[type="file"]');
    const input = inputs[0] as HTMLInputElement;
    const csv = 'intent,title,body,keywords,priority,enabled\nfoo,Foo,Body,a|b,10,true\n';
    const file = new File([csv], 'kb.csv', { type: 'text/csv' });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(importAsync).toHaveBeenCalledTimes(1));
    expect(importAsync.mock.calls[0]?.[0]).toMatchObject({
      csv: expect.stringContaining('intent,title'),
      upsert: true,
    });
  });
});
