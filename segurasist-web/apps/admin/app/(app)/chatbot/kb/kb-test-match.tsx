'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <KbTestMatch /> — panel inline para probar una query contra una entry sin
 * persistir nada. Llama a `POST /v1/admin/chatbot/kb/:id/test-match`.
 *
 * UX:
 *   - Input grande con placeholder ("Pega una pregunta del asegurado...").
 *   - Botón "Probar" disabled si query vacío o ya pendiente.
 *   - Resultado:
 *       matched=true  → Badge success "Match (score X)" + chips de keywords.
 *       matched=false → Badge outline "Sin match" + sugerencia.
 *   - Empty state inicial sólo con copy guía + Lordicon "lab-flask".
 *
 * Sólo se muestra cuando hay `entryId` (no aplica al modo create — sólo a
 * entries persistidas).
 */

import * as React from 'react';
import { Badge, Button, Input } from '@segurasist/ui';
import { useTestKbMatch } from '@segurasist/api-client/hooks/admin-chatbot-kb';
import { KbIcon } from './_lordicons';

export interface KbTestMatchProps {
  entryId: string;
}

export function KbTestMatch({ entryId }: KbTestMatchProps): JSX.Element {
  const [query, setQuery] = React.useState('');
  const mut = useTestKbMatch(entryId);
  const result = mut.data;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const q = query.trim();
    if (!q || mut.isPending) return;
    mut.mutate(q);
  };

  return (
    <section
      data-testid="kb-test-match"
      className="rounded-md border border-border bg-surface p-4"
    >
      <header className="mb-3 flex items-center gap-2">
        <KbIcon kind="testMatch" trigger="loop" size={22} />
        <h3 className="text-sm font-semibold text-fg">Probar match</h3>
      </header>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Mensaje de prueba"
          data-testid="kb-test-match-input"
          placeholder="Pega una pregunta del asegurado..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
          className="flex-1 min-w-[14rem]"
        />
        <Button
          type="submit"
          data-testid="kb-test-match-submit"
          loading={mut.isPending}
          disabled={!query.trim() || mut.isPending}
        >
          Probar
        </Button>
      </form>

      <div className="mt-3 min-h-[3rem]" aria-live="polite">
        {mut.isError && (
          <p
            data-testid="kb-test-match-error"
            className="text-sm font-medium text-danger"
          >
            {mut.error instanceof Error
              ? mut.error.message
              : 'No pudimos correr la prueba.'}
          </p>
        )}

        {result && (
          <div data-testid="kb-test-match-result" className="space-y-2">
            <div className="flex items-center gap-2">
              {result.matched ? (
                <Badge variant="success" data-testid="kb-test-match-badge">
                  Match — score {result.score.toFixed(2)}
                </Badge>
              ) : (
                <Badge variant="outline" data-testid="kb-test-match-badge">
                  Sin match — score {result.score.toFixed(2)}
                </Badge>
              )}
            </div>
            {result.matchedKeywords.length > 0 && (
              <div>
                <p className="text-xs text-fg-muted">Keywords encontradas</p>
                <div
                  data-testid="kb-test-match-keywords"
                  className="mt-1 flex flex-wrap gap-1"
                >
                  {result.matchedKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-fg"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!result.matched && result.matchedKeywords.length === 0 && (
              <p className="text-sm text-fg-muted">
                Sin overlap de keywords. Considera enriquecer las keywords o
                ajustar el cuerpo de la entrada.
              </p>
            )}
          </div>
        )}

        {!result && !mut.isError && !mut.isPending && (
          <p className="text-sm text-fg-muted">
            Escribe un mensaje y pulsa Probar para ver el score del matcher.
          </p>
        )}
      </div>
    </section>
  );
}
