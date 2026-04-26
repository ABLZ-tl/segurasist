import type { Meta, StoryObj } from '@storybook/react';
import { Section } from './section';
import { Button } from './button';

const meta: Meta<typeof Section> = {
  title: 'Primitives/Section',
  component: Section,
  tags: ['autodocs'],
  args: {
    title: 'Asegurados activos',
    description: 'Listado de asegurados con vigencia activa.',
  },
};
export default meta;
type Story = StoryObj<typeof Section>;

export const Default: Story = {};
export const WithActions: Story = {
  args: {
    actions: <Button size="sm">Nuevo asegurado</Button>,
  },
};
