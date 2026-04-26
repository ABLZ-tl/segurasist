import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('<Badge>', () => {
  it.each([
    ['default', 'bg-primary'],
    ['secondary', 'bg-surface'],
    ['outline', 'border-border'],
    ['success', 'bg-success'],
    ['warning', 'bg-warning'],
    ['danger', 'bg-danger'],
  ])('variant %s applies %s class', (variant, expectedClass) => {
    render(<Badge variant={variant as never}>X</Badge>);
    expect(screen.getByText('X')).toHaveClass(expectedClass);
  });

  it('renders text content as-is', () => {
    render(<Badge>Activo</Badge>);
    expect(screen.getByText('Activo')).toBeTruthy();
  });

  it('uses default variant when none provided', () => {
    render(<Badge>X</Badge>);
    expect(screen.getByText('X')).toHaveClass('bg-primary');
  });

  it('passes through arbitrary html attributes', () => {
    render(
      <Badge data-testid="b" aria-label="lbl">
        X
      </Badge>,
    );
    const el = screen.getByTestId('b');
    expect(el).toHaveAttribute('aria-label', 'lbl');
  });

  it('merges custom className with variant classes', () => {
    render(<Badge className="custom-cls">X</Badge>);
    const el = screen.getByText('X');
    expect(el).toHaveClass('custom-cls');
    expect(el).toHaveClass('bg-primary');
  });
});
