import type { Meta, StoryObj } from '@storybook/react';
import { Pill } from './pill';

const meta: Meta<typeof Pill> = {
  title: 'Primitives/Pill',
  component: Pill,
  tags: ['autodocs'],
  args: { children: 'Todos' },
};
export default meta;
type Story = StoryObj<typeof Pill>;

export const Default: Story = {};
export const Active: Story = { args: { active: true } };
