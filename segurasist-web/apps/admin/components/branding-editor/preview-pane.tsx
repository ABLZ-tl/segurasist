'use client';

/**
 * Sprint 5 — MT-2 iter 1.
 *
 * <PreviewPane /> — simulación visual del portal del asegurado con los
 * valores actuales del form. NO llama API: es 100% derivado de las props.
 *
 * Por qué este componente vive en admin y no en `@segurasist/ui`:
 *   - Es una mock UI específica del editor — refleja la estructura del
 *     portal pero no es la implementación real (esa la rinde MT-3 con el
 *     TenantContextProvider).
 *   - Cuando MT-3 termine podemos importar `<PortalPreviewMock>` desde
 *     `@segurasist/ui` y reemplazarlo. TODO(MT-2 iter 2).
 *
 * Animación:
 *   - El wrapper externo recibe `key` que combina los hex actuales; cuando
 *     cualquiera cambia, GsapFade se re-monta y "respira" — consume
 *     `@segurasist/ui` de DS-1 (iter 2, CC-21).
 */

import * as React from 'react';
import { Card, GsapFade } from '@segurasist/ui';
import { cn } from '@segurasist/ui';

export interface PreviewPaneProps {
  displayName: string;
  tagline: string;
  primaryHex: string;
  accentHex: string;
  logoUrl: string | null;
  bgImageUrl: string | null;
}

export function PreviewPane({
  displayName,
  tagline,
  primaryHex,
  accentHex,
  logoUrl,
  bgImageUrl,
}: PreviewPaneProps): JSX.Element {
  const animKey = `${primaryHex}-${accentHex}-${logoUrl ?? ''}`;
  // Inline style aquí es OK: este componente vive en admin (no en portal,
  // donde CSP requiere style-nonce). Aplicamos `style` solo a elementos
  // mock controlados por las props del form.
  return (
    <Card
      data-testid="branding-preview"
      className="overflow-hidden border-border/60 shadow-sm"
    >
      <div
        className="relative h-full min-h-[420px] bg-bg"
        style={{
          backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Overlay para legibilidad cuando hay bg image. */}
        {bgImageUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-bg/40 to-bg/90"
          />
        )}

        <GsapFade key={animKey} className="relative h-full">
          {/* Header simulado */}
          <header
            className="flex items-center justify-between border-b px-5 py-3 transition-colors duration-200"
            style={{ borderColor: `${primaryHex}33` }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="grid h-9 w-9 place-items-center overflow-hidden rounded-md ring-1 ring-fg/10"
                style={{ backgroundColor: primaryHex }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-sm font-bold text-white">
                    {displayName.charAt(0).toUpperCase() || 'S'}
                  </span>
                )}
              </div>
              <span
                className="truncate text-sm font-semibold text-fg"
                data-testid="branding-preview-name"
              >
                {displayName || 'Tu marca'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-fg-muted">Mi cuenta</span>
              <div className="h-7 w-7 rounded-full bg-surface ring-1 ring-border" />
            </div>
          </header>

          {/* Hero card */}
          <div className="px-5 pb-6 pt-8">
            <div
              data-testid="branding-preview-hero"
              className="rounded-xl border bg-bg/95 p-6 shadow-sm transition-all duration-200"
              style={{
                borderColor: `${primaryHex}40`,
                boxShadow: `0 12px 40px -16px ${primaryHex}40`,
              }}
            >
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: accentHex }}
              >
                Cobertura activa
              </p>
              <h1
                className="mt-2 text-xl font-semibold leading-tight tracking-tight text-fg"
                data-testid="branding-preview-tagline"
              >
                {tagline || 'Mantente protegido — tu seguro al alcance.'}
              </h1>
              <p className="mt-2 text-sm text-fg-muted">
                Esto es una previsualización. Tus asegurados verán algo similar
                con el logo y los colores que definas.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform',
                    'pointer-events-none',
                  )}
                  style={{ backgroundColor: primaryHex }}
                  data-testid="branding-preview-button"
                >
                  Ver mi certificado
                </button>
                <a
                  className="text-sm font-medium underline-offset-4 hover:underline"
                  style={{ color: accentHex }}
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  tabIndex={-1}
                  data-testid="branding-preview-link"
                >
                  Conoce más
                </a>
              </div>
            </div>

            {/* Mock list */}
            <ul className="mt-5 space-y-2">
              {[
                { label: 'Atención hospitalaria', value: '12 / 30 visitas' },
                { label: 'Consulta general', value: '4 / 10 visitas' },
              ].map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs"
                >
                  <span className="text-fg">{item.label}</span>
                  <span
                    className="font-medium"
                    style={{ color: accentHex }}
                  >
                    {item.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </GsapFade>
      </div>
    </Card>
  );
}
