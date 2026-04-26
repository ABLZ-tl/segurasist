import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Section } from './section';

describe('<Section>', () => {
  it('renders a <section> element with title h2 and description', () => {
    render(
      <Section title="Pólizas" description="Resumen mensual">
        <p>body</p>
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Pólizas' })).toBeTruthy();
    expect(screen.getByText('Resumen mensual')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('omits header when no title/description/actions', () => {
    const { container } = render(
      <Section>
        <p>body</p>
      </Section>,
    );
    expect(container.querySelector('header')).toBeNull();
  });

  it('renders the actions slot when provided', () => {
    render(
      <Section title="t" actions={<button type="button">Add</button>}>
        body
      </Section>,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('header has stack-on-mobile flex classes', () => {
    const { container } = render(<Section title="t">body</Section>);
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header).toHaveClass('flex-col');
    expect(header).toHaveClass('sm:flex-row');
  });

  it('forwards ref to the underlying section element', () => {
    const ref = { current: null as HTMLElement | null };
    render(
      <Section ref={ref} title="t">
        body
      </Section>,
    );
    expect(ref.current?.tagName).toBe('SECTION');
  });
});
