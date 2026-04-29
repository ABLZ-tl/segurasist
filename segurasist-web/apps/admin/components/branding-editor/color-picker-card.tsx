'use client';

/**
 * Sprint 5 — MT-2 iter 1.
 *
 * <ColorPickerCard /> — card con:
 *   - Swatch circular grande (preview).
 *   - Input nativo `type=color` (paleta del SO).
 *   - Input `type=text` con la representación hex sincronizada bidireccional.
 *   - Badge de contraste WCAG AA contra blanco (warning si <4.5).
 *
 * No usa react-hook-form internamente; el padre (BrandingEditor) lo cablea
 * via `value` controlado. Esto permite testearlo aisladamente y reutilizarlo
 * en otros editores futuros (theme dark, marca secundaria, etc.).
 *
 * Accesibilidad:
 *   - Cada input tiene su `<label htmlFor>` enlazado.
 *   - El badge WCAG es `role="status"` para que SR lo anuncie polite.
 */

import * as React from 'react';
import { Card, CardContent, Input } from '@segurasist/ui';
import { cn } from '@segurasist/ui';
import { contrastVsWhite, isValidHex, passesWcagAa } from './_contrast';

export interface ColorPickerCardProps {
  /** Identificador estable para los htmlFor / data-testid. */
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
  description?: string;
  /** Mensaje de error inline (si el padre RHF detectó issue). */
  error?: string;
  disabled?: boolean;
}

export function ColorPickerCard({
  id,
  label,
  value,
  onChange,
  description,
  error,
  disabled,
}: ColorPickerCardProps): JSX.Element {
  // Mantener el text-input como `string` separado para permitir typing
  // intermedio (ej. "#ab" mientras escribe). Sólo propagamos al padre cuando
  // el formato es válido para evitar re-renders ruidosos del preview.
  const [text, setText] = React.useState(value);
  React.useEffect(() => {
    setText(value);
  }, [value]);

  const handleNative = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.toLowerCase();
    setText(next);
    onChange(next);
  };

  const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
    let next = e.target.value.trim().toLowerCase();
    if (next && !next.startsWith('#')) next = `#${next}`;
    setText(next);
    if (isValidHex(next)) onChange(next);
  };

  const valid = isValidHex(value);
  const ratio = valid ? contrastVsWhite(value) : 1;
  const lowContrast = valid && !passesWcagAa(value);

  return (
    <Card
      data-testid={`color-picker-${id}`}
      className={cn('overflow-hidden', disabled && 'opacity-50')}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-4">
          {/* Swatch — etiqueta visual + click target alternativo. */}
          <label
            htmlFor={`${id}-native`}
            aria-label={`Selector de color ${label}`}
            className={cn(
              'relative grid h-14 w-14 shrink-0 place-items-center rounded-full border border-border shadow-inner ring-1 ring-fg/5 transition-transform',
              !disabled && 'cursor-pointer hover:scale-[1.04] active:scale-100',
              disabled && 'cursor-not-allowed',
            )}
            style={{ backgroundColor: valid ? value : 'transparent' }}
          >
            {!valid && (
              <span className="text-[10px] font-medium text-fg-muted">N/A</span>
            )}
          </label>
          <div className="min-w-0 flex-1 space-y-1">
            <label
              htmlFor={`${id}-text`}
              className="block text-sm font-medium text-fg"
            >
              {label}
            </label>
            {description && (
              <p className="text-xs text-fg-muted">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/*
            Input nativo — invisible visualmente pero accesible (no `sr-only`
            para que los browsers sigan abriendo el picker en focus).
            Ancho 0 + opacity 0 mantiene el evento change.
          */}
          <input
            id={`${id}-native`}
            data-testid={`color-picker-${id}-native`}
            type="color"
            value={valid ? value : '#000000'}
            onChange={handleNative}
            disabled={disabled}
            className="h-10 w-12 cursor-pointer rounded-md border border-border bg-bg p-1"
            aria-label={`${label} (paleta)`}
          />
          <Input
            id={`${id}-text`}
            data-testid={`color-picker-${id}-text`}
            type="text"
            value={text}
            onChange={handleText}
            disabled={disabled}
            invalid={!!error || (text.length > 0 && !isValidHex(text))}
            placeholder="#3366ff"
            maxLength={7}
            inputMode="text"
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            className="font-mono uppercase tracking-wider"
            aria-describedby={`${id}-help`}
          />
        </div>

        <div id={`${id}-help`} className="flex items-center gap-2">
          {valid ? (
            <span
              role="status"
              data-testid={`color-picker-${id}-wcag`}
              data-wcag-pass={passesWcagAa(value) ? 'true' : 'false'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                lowContrast
                  ? 'border-warning/40 bg-warning/10 text-fg'
                  : 'border-success/40 bg-success/10 text-fg',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  lowContrast ? 'bg-warning' : 'bg-success',
                )}
              />
              {lowContrast
                ? `Contraste bajo (${ratio.toFixed(2)}:1)`
                : `WCAG AA ${ratio.toFixed(2)}:1`}
            </span>
          ) : (
            <span className="text-[11px] text-fg-muted">
              Hex inválido (formato esperado: #rrggbb)
            </span>
          )}
        </div>

        {error && (
          <p
            role="alert"
            data-testid={`color-picker-${id}-error`}
            className="text-sm font-medium text-danger"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
