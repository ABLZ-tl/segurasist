'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <HistoryClient /> — listado de conversaciones del chatbot del insured.
 *
 * UX:
 *   - Cards en grid responsive (1 col mobile, 2 cols sm+, 3 cols lg+).
 *   - `<GsapStagger staggerDelay={0.05}>` para entrada al mount.
 *   - Empty state: Lordicon "chat-bubble" idle 96px + copy.
 *   - Click en card abre `<ConversationThreadDrawer />` slide-in.
 *   - Skeletons en loading; toast de error si falla.
 *
 * Datos:
 *   - `useChatbotConversations({ limit, offset })` — paginación simple
 *     (botón "Cargar más" cuando hay > 20 totales). Retención BE = 30d
 *     (las conversaciones viejas ya no aparecen).
 */

import * as React from 'react';
import {
  AlertBanner,
  Button,
  GsapStagger,
  LordIcon,
  PageTransition,
  Skeleton,
} from '@segurasist/ui';
import { useChatbotConversations } from '@segurasist/api-client/hooks/chatbot-history';
import { ConversationCard } from './conversation-card';
import { ConversationThreadDrawer } from './conversation-thread-drawer';

const PAGE_SIZE = 20;

export function HistoryClient(): JSX.Element {
  const [offset, setOffset] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const { data, isLoading, isError, error, isFetching } = useChatbotConversations({
    limit: PAGE_SIZE,
    offset,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = items.length > 0 && offset + items.length < total;

  return (
    <PageTransition routeKey="chatbot-history">
      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-8 pt-4 md:max-w-4xl">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mis conversaciones
          </h1>
          <p className="text-sm text-fg-muted">
            Histórico de tus charlas con el asistente. Las conversaciones se
            guardan por 30 días.
          </p>
        </header>

        {isLoading && (
          <div
            data-testid="history-skeleton"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {isError && (
          <AlertBanner
            tone="danger"
            title="No pudimos cargar tus conversaciones"
            data-testid="history-error"
          >
            {error instanceof Error
              ? error.message
              : 'Reintenta en unos segundos. Si persiste, contacta a soporte.'}
          </AlertBanner>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div
            data-testid="history-empty"
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center"
          >
            <LordIcon name="chat-bubble" trigger="loop" size={96} />
            <h2 className="mt-4 text-base font-semibold text-fg">
              Aún no has tenido conversaciones con el asistente.
            </h2>
            <p className="mt-1 max-w-md text-sm text-fg-muted">
              Cuando empieces, las verás aquí.
            </p>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <>
            <GsapStagger
              as="div"
              staggerDelay={0.05}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {items.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  onSelect={(id) => setSelectedId(id)}
                />
              ))}
            </GsapStagger>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  loading={isFetching}
                  data-testid="history-load-more"
                >
                  Cargar más
                </Button>
              </div>
            )}
          </>
        )}

        <ConversationThreadDrawer
          conversationId={selectedId}
          open={!!selectedId}
          onOpenChange={(o) => {
            if (!o) setSelectedId(null);
          }}
        />
      </div>
    </PageTransition>
  );
}
