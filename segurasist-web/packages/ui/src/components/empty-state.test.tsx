import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('<EmptyState>', () => {
  it('renders the title in an h3', () => {
    render(<EmptyState title="Sin resultados" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Sin resultados' })).toBeTruthy();
  });

  it('omits description when not provided', () => {
    render(<EmptyState title="Vacío" />);
    expect(screen.queryByRole('paragraph')).toBeNull();
    expect(screen.queryByText(/.+/, { selector: 'p' })).toBeNull();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Vacío" description="No hay datos" />);
    expect(screen.getByText('No hay datos')).toBeTruthy();
  });

  it('renders the action slot', () => {
    render(
      <EmptyState
        title="Vacío"
        action={<button type="button">Crear</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Crear' })).toBeTruthy();
  });

  it('uses role="status" so screen readers announce the state', () => {
    render(<EmptyState title="x" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders custom icon when provided', () => {
    render(<EmptyState title="x" icon={<svg data-testid="my-icon" />} />);
    expect(screen.getByTestId('my-icon')).toBeTruthy();
  });
});
