import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';

describe('<Card> family', () => {
  it('renders Card with header, title, description, content, and footer', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getByText('Desc')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Footer')).toBeTruthy();
  });

  it('CardTitle renders an h3', () => {
    render(<CardTitle>Hello</CardTitle>);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Hello');
  });

  it('Card applies border + rounded + shadow base classes', () => {
    const { container } = render(<Card data-testid="c">x</Card>);
    const div = container.firstElementChild;
    expect(div).toHaveClass('rounded-lg');
    expect(div).toHaveClass('border');
    expect(div).toHaveClass('shadow-sm');
  });

  it('CardContent applies expected padding classes', () => {
    const { container } = render(<CardContent>x</CardContent>);
    expect(container.firstElementChild).toHaveClass('p-6');
    expect(container.firstElementChild).toHaveClass('pt-0');
  });

  it('passes className through to root', () => {
    const { container } = render(<Card className="custom">x</Card>);
    expect(container.firstElementChild).toHaveClass('custom');
  });
});
