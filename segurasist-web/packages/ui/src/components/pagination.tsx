'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/cn';

export interface PaginationProps {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageInfo?: string;
  className?: string;
}

/**
 * Cursor-based pagination: only Prev/Next; the parent supplies cursors.
 */
export function Pagination({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  pageInfo,
  className,
}: PaginationProps) {
  return (
    <nav
      aria-label="Paginación"
      className={cn('flex items-center justify-between gap-3 py-2', className)}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={!hasPrev}
        aria-label="Página anterior"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Anterior
      </Button>
      {pageInfo && <span className="text-sm text-fg-muted">{pageInfo}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        aria-label="Siguiente página"
      >
        Siguiente
        <ChevronRight aria-hidden className="h-4 w-4" />
      </Button>
    </nav>
  );
}
