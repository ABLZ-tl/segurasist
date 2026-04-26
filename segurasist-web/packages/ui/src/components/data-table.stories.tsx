import type { Meta, StoryObj } from '@storybook/react';
import { DataTable, type DataTableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  pkg: string;
  status: string;
}

const rows: Row[] = [
  { id: '1', name: 'Carmen López', pkg: 'Premium', status: 'Vigente' },
  { id: '2', name: 'Roberto Salas', pkg: 'Básico', status: 'Vigente' },
  { id: '3', name: 'María Hernández', pkg: 'Platinum', status: 'Vencida' },
];

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nombre', cell: (r) => r.name },
  { id: 'pkg', header: 'Paquete', cell: (r) => r.pkg },
  { id: 'status', header: 'Estado', cell: (r) => r.status },
];

const meta: Meta = { title: 'Primitives/DataTable', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <DataTable data={rows} columns={columns} rowKey={(r) => r.id} />,
};
export const Loading: Story = {
  render: () => <DataTable data={[]} columns={columns} rowKey={(r) => r.id} loading />,
};
export const Empty: Story = {
  render: () => <DataTable data={[]} columns={columns} rowKey={(r) => r.id} />,
};
