import type { Meta, StoryObj } from '@storybook/react';
import { Avatar, AvatarFallback, AvatarImage, initialsOf } from './avatar';

const meta: Meta = { title: 'Primitives/Avatar', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="https://i.pravatar.cc/80?img=12" alt="Carmen López" />
      <AvatarFallback>{initialsOf('Carmen López')}</AvatarFallback>
    </Avatar>
  ),
};

export const FallbackOnly: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>{initialsOf('Roberto Salas')}</AvatarFallback>
    </Avatar>
  ),
};
