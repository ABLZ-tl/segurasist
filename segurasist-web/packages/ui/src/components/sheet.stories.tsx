import type { Meta, StoryObj } from '@storybook/react';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './sheet';
import { Button } from './button';

const meta: Meta = { title: 'Primitives/Sheet', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Right: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Abrir panel</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Nuevo paquete</SheetTitle>
          <SheetDescription>Define nombre, coberturas y vigencia.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
};
