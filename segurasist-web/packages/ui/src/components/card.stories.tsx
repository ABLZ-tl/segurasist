import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';

const meta: Meta = { title: 'Primitives/Card', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Vigencia activa</CardTitle>
        <CardDescription>Tu póliza está vigente hasta el 31 de marzo de 2027.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-muted">Paquete Premium · MAC Polanco</p>
      </CardContent>
      <CardFooter>
        <Button>Descargar certificado</Button>
      </CardFooter>
    </Card>
  ),
};
