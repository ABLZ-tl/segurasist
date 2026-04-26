'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

/** Mobile-only search icon button that opens the command palette via the same
 *  keyboard event the global listener already handles. */
export function MobileSearchTrigger(): JSX.Element {
  const trigger = React.useCallback((): void => {
    const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
    const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true });
    window.dispatchEvent(ev);
  }, []);

  return (
    <button
      type="button"
      onClick={trigger}
      aria-label="Buscar"
      className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted active:bg-bg-elevated lg:hidden"
    >
      <Search className="h-5 w-5" />
    </button>
  );
}
