import type { Meta, StoryObj } from '@storybook/react';
import { Tag } from './tag';

const meta: Meta<typeof Tag> = {
  title: 'Primitives/Tag',
  component: Tag,
  tags: ['autodocs'],
  args: { children: 'Premium' },
};
export default meta;
type Story = StoryObj<typeof Tag>;

export const Default: Story = {};
export const Removable: Story = { args: { removable: true, onRemove: () => {} } };
