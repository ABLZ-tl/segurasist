import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../../../app/_components/theme-toggle';

describe('<ThemeToggle />', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    window.localStorage.removeItem('theme');
  });

  it('starts in light mode by default and exposes the right aria-label', async () => {
    render(<ThemeToggle />);
    const btn = await screen.findByRole('button', {
      name: /cambiar a modo oscuro/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it('reads the initial theme from data-theme on the html element', async () => {
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeToggle />);
    expect(
      await screen.findByRole('button', { name: /cambiar a modo claro/i }),
    ).toBeInTheDocument();
  });

  it('toggles the theme on click and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = await screen.findByRole('button', {
      name: /cambiar a modo oscuro/i,
    });

    await user.click(btn);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(
      screen.getByRole('button', { name: /cambiar a modo claro/i }),
    ).toBeInTheDocument();

    await user.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
