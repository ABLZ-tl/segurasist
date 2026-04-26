import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import { DatePicker } from './date-picker';

const meta: Meta<typeof DatePicker> = {
  title: 'Primitives/DatePicker',
  component: DatePicker,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof DatePicker>;

function DatePickerDemo() {
  const [d, setD] = React.useState<Date | undefined>();
  return <DatePicker value={d} onChange={setD} />;
}

export const Default: Story = {
  render: () => <DatePickerDemo />,
};

export const Disabled: Story = {
  render: () => <DatePicker onChange={() => {}} disabled />,
};
