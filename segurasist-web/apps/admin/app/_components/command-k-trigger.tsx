'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

export function CommandKTrigger(): JSX.Element {
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => {
    setMac(typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
  }, []);

  const trigger = (): void => {
    const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: !mac, bubbles: true });
    window.dispatchEvent(ev);
  };

  return (
    <button
      type="button"
      onClick={trigger}
      className="group flex h-8 w-full max-w-[420px] items-center gap-2 rounded-md border border-border bg-bg-elevated/60 px-2.5 text-[13px] text-fg-muted transition-colors duration-fast hover:border-border-strong hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Abrir paleta de comandos"
    >
      <Search className="h-3.5 w-3.5 text-fg-subtle" />
      <span className="flex-1 text-left">Buscar...</span>
      <kbd className="hidden items-center gap-0.5 font-mono text-[10px] text-fg-subtle sm:inline-flex">
        <span className="rounded border border-border bg-bg px-1 py-px">{mac ? '⌘' : 'Ctrl'}</span>
        <span className="rounded border border-border bg-bg px-1 py-px">K</span>
      </kbd>
    </button>
  );
}
