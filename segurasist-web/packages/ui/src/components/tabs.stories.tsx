import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta: Meta = { title: 'Primitives/Tabs', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="data" className="w-[28rem]">
      <TabsList>
        <TabsTrigger value="data">Datos</TabsTrigger>
        <TabsTrigger value="coverages">Coberturas</TabsTrigger>
        <TabsTrigger value="claims">Eventos</TabsTrigger>
        <TabsTrigger value="audit">Auditoría</TabsTrigger>
      </TabsList>
      <TabsContent value="data">Información personal y de póliza.</TabsContent>
      <TabsContent value="coverages">Lista de coberturas con consumo.</TabsContent>
      <TabsContent value="claims">Historial de siniestros.</TabsContent>
      <TabsContent value="audit">Timeline de auditoría.</TabsContent>
    </Tabs>
  ),
};
