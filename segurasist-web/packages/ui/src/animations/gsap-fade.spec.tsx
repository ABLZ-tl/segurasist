import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GsapFade } from './gsap-fade';

const { fromToMock, setMock, killMock } = vi.hoisted(() => ({
  fromToMock: vi.fn(),
  setMock: vi.fn(),
  killMock: vi.fn(),
}));

vi.mock('gsap', () => {
  const tween = { kill: killMock };
  const gsapStub = {
    fromTo: (...args: unknown[]) => {
      fromToMock(...args);
      return tween;
    },
    set: (...args: unknown[]) => {
      setMock(...args);
      return tween;
    },
    from: (...args: unknown[]) => {
      fromToMock(...args);
      return tween;
    },
    to: vi.fn(),
    registerPlugin: vi.fn(),
  };
  return { default: gsapStub, ...gsapStub };
});

function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('<GsapFade>', () => {
  beforeEach(() => {
    fromToMock.mockClear();
    setMock.mockClear();
    killMock.mockClear();
    cleanup();
  });

  it('animates fromTo when reduced motion is OFF', async () => {
    setReducedMotion(false);
    const { unmount } = render(
      <GsapFade duration={0.5} delay={0.1} y={20}>
        <p>hello</p>
      </GsapFade>,
    );
    // useEffect is sync after render in jsdom; flush microtasks just in case.
    await Promise.resolve();
    expect(fromToMock).toHaveBeenCalledTimes(1);
    const args = fromToMock.mock.calls[0]!;
    expect(args[1]).toMatchObject({ opacity: 0, y: 20 });
    expect(args[2]).toMatchObject({ opacity: 1, y: 0, duration: 0.5, delay: 0.1 });
    unmount();
    expect(killMock).toHaveBeenCalled();
  });

  it('uses gsap.set when prefers-reduced-motion is reduce', async () => {
    setReducedMotion(true);
    render(
      <GsapFade>
        <p>hello reduced</p>
      </GsapFade>,
    );
    await Promise.resolve();
    // Wait one tick so the matchMedia effect commits.
    await new Promise((r) => setTimeout(r, 0));
    expect(setMock).toHaveBeenCalled();
    expect(fromToMock).not.toHaveBeenCalled();
  });

  it('renders children', () => {
    setReducedMotion(false);
    const { getByText } = render(
      <GsapFade>
        <span>visible-child</span>
      </GsapFade>,
    );
    expect(getByText('visible-child')).toBeTruthy();
  });

  it('cleans up the tween on unmount', async () => {
    setReducedMotion(false);
    const { unmount } = render(
      <GsapFade>
        <span>x</span>
      </GsapFade>,
    );
    await Promise.resolve();
    unmount();
    expect(killMock).toHaveBeenCalled();
  });

  it('CC-09: sets data-motion-ready=true immediately under reduced motion', async () => {
    setReducedMotion(true);
    const { container } = render(
      <GsapFade>
        <span>r</span>
      </GsapFade>,
    );
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const root = container.querySelector('[data-gsap-fade="true"]');
    expect(root?.getAttribute('data-motion-ready')).toBe('true');
  });

  it('CC-09: passes onComplete to gsap.fromTo so motion-ready can flip to true', async () => {
    setReducedMotion(false);
    render(
      <GsapFade>
        <span>x</span>
      </GsapFade>,
    );
    await Promise.resolve();
    expect(fromToMock).toHaveBeenCalled();
    const args = fromToMock.mock.calls[0]!;
    // 3rd arg is the "to" tween config; must include an onComplete callback.
    expect(typeof (args[2] as { onComplete?: unknown }).onComplete).toBe('function');
  });
});
