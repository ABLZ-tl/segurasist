import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarFallback, AvatarImage, initialsOf } from './avatar';

describe('<Avatar>', () => {
  it('renders fallback when no image src is provided', () => {
    render(
      <Avatar>
        <AvatarFallback>JC</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('JC')).toBeTruthy();
  });

  it('renders fallback content (Radix renders fallback synchronously when image not yet loaded in jsdom)', () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="user" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    // jsdom does not actually load images, so Radix shows the fallback.
    expect(screen.getByText('AB')).toBeTruthy();
  });

  it('applies default round shape and size classes on root', () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>X</AvatarFallback>
      </Avatar>,
    );
    const root = container.querySelector('span');
    expect(root).not.toBeNull();
    expect(root).toHaveClass('rounded-full');
    expect(root).toHaveClass('h-10');
    expect(root).toHaveClass('w-10');
  });
});

describe('initialsOf()', () => {
  it.each([
    ['Juan Carlos', 'JC'],
    ['Maria de la Luz Garcia', 'MD'],
    ['plato', 'P'],
    ['  espacios  raros ', 'ER'],
    ['', ''],
  ])('"%s" -> "%s"', (input, expected) => {
    expect(initialsOf(input)).toBe(expected);
  });

  it('uppercases initials regardless of input case', () => {
    expect(initialsOf('juan perez')).toBe('JP');
  });
});
