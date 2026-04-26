import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('<Button>', () => {
  it.each([
    ['primary', 'bg-accent'],
    ['secondary', 'bg-bg-elevated'],
    ['ghost', 'active:bg-bg-elevated'],
    ['destructive', 'bg-danger'],
    ['outline', 'border'],
    ['link', 'underline-offset-4'],
  ])('variant %s applies expected class %s', (variant, expectedClass) => {
    render(<Button variant={variant as never}>X</Button>);
    expect(screen.getByRole('button')).toHaveClass(expectedClass);
  });

  it.each([
    ['sm', 'min-h-[44px]'],
    ['md', 'h-11'],
    ['lg', 'h-12'],
    ['icon', 'w-11'],
  ])('size %s applies %s class', (size, expectedClass) => {
    render(<Button size={size as never}>X</Button>);
    expect(screen.getByRole('button')).toHaveClass(expectedClass);
  });

  it('uses default variant primary and size md when none provided', () => {
    render(<Button>Default</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-accent');
    expect(btn).toHaveClass('h-11');
  });

  it('renders as a native <button> by default', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button').tagName).toBe('BUTTON');
  });

  it('forwards ref to the underlying button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>R</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('does not invoke onClick when disabled', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(
      <Button disabled onClick={handler}>
        X
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('invokes onClick on click when enabled', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(<Button onClick={handler}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('with asChild renders the child as the rendered element and forwards classes', () => {
    render(
      <Button asChild>
        <a href="/foo">link</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', '/foo');
    expect(link).toHaveClass('bg-accent');
  });

  it('shows loading spinner and is disabled when loading', () => {
    render(<Button loading>Submit</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('renders loadingText in place of children when provided and loading', () => {
    render(
      <Button loading loadingText="Sending...">
        Send
      </Button>,
    );
    expect(screen.getByText('Sending...')).toBeTruthy();
    expect(screen.queryByText('Send')).toBeNull();
  });

  it('passes through arbitrary html attributes', () => {
    render(
      <Button data-testid="x" type="submit">
        Y
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn).toHaveAttribute('data-testid', 'x');
  });
});
