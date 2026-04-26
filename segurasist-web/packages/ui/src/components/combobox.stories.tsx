import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import { Combobox } from './combobox';

const meta: Meta<typeof Combobox> = {
  title: 'Primitives/Combobox',
  component: Combobox,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Combobox>;

const options = [
  { value: 'cdmx', label: 'Ciudad de México' },
  { value: 'gdl', label: 'Guadalajara' },
  { value: 'mty', label: 'Monterrey' },
  { value: 'pue', label: 'Puebla' },
];

function ComboboxDemo() {
  const [v, setV] = React.useState<string>('');
  return <Combobox options={options} value={v} onChange={setV} ariaLabel="Sede" />;
}

export const Default: Story = {
  render: () => <ComboboxDemo />,
};

export const Disabled: Story = {
  render: () => <Combobox options={options} value="cdmx" onChange={() => {}} disabled ariaLabel="Sede" />,
};
