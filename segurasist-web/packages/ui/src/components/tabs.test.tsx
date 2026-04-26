import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function Harness({
  defaultValue = 'a',
  onValueChange,
}: {
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <Tabs defaultValue={defaultValue} onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>
  );
}

describe('<Tabs>', () => {
  it('renders the default panel and selected tab', () => {
    render(<Harness defaultValue="a" />);
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Panel A')).toBeTruthy();
    expect(screen.queryByText('Panel B')).toBeNull();
  });

  it('switches active tab when another trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness defaultValue="a" />);
    await user.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Panel B')).toBeTruthy();
  });

  it('invokes onValueChange with the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness defaultValue="a" onValueChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('respects controlled value prop', () => {
    function Controlled() {
      const [value, setValue] = React.useState('b');
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel A</TabsContent>
          <TabsContent value="b">Panel B</TabsContent>
        </Tabs>
      );
    }
    render(<Controlled />);
    expect(screen.getByText('Panel B')).toBeTruthy();
  });

  it('TabsTrigger applies active state styles via data-state', async () => {
    const user = userEvent.setup();
    render(<Harness defaultValue="a" />);
    const triggerB = screen.getByRole('tab', { name: 'B' });
    expect(triggerB).toHaveAttribute('data-state', 'inactive');
    await user.click(triggerB);
    expect(triggerB).toHaveAttribute('data-state', 'active');
  });
});
