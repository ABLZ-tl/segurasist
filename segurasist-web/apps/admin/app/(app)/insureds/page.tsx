'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  DataTable,
  Input,
  Pagination,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { Plus, Upload } from 'lucide-react';

interface Row {
  id: string;
  curp: string;
  name: string;
  pkg: string;
  validity: string;
  status: 'active' | 'expired' | 'cancelled';
}

// Mock — replaced by `useInsureds` from @segurasist/api-client/hooks/insureds.
const MOCK: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: `ins-${1000 + i}`,
  curp: `CURP${String(100000 + i)}MDFRPN0${i % 10}`,
  name: ['Carmen López', 'Roberto Salas', 'María Hernández', 'José Pérez'][i % 4]!,
  pkg: ['Básico', 'Premium', 'Platinum'][i % 3]!,
  validity: '31 mar 2027',
  status: i % 5 === 0 ? 'expired' : 'active',
}));

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nombre', cell: (r) => <span className="font-medium">{r.name}</span> },
  { id: 'curp', header: 'CURP', cell: (r) => <code className="font-mono text-xs">{r.curp}</code> },
  { id: 'pkg', header: 'Paquete', cell: (r) => r.pkg },
  { id: 'validity', header: 'Vigencia', cell: (r) => r.validity },
  {
    id: 'status',
    header: 'Estado',
    cell: (r) =>
      r.status === 'active' ? (
        <Badge variant="success">Vigente</Badge>
      ) : r.status === 'expired' ? (
        <Badge variant="danger">Vencida</Badge>
      ) : (
        <Badge variant="secondary">Cancelada</Badge>
      ),
  },
];

export default function InsuredsPage() {
  const [search, setSearch] = React.useState('');
  const [pkg, setPkg] = React.useState<string>('all');
  const [page, setPage] = React.useState(0);

  return (
    <div className="space-y-4">
      <Section
        title="Asegurados"
        description="Búsqueda y administración de membresías."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary">
              <Upload aria-hidden className="mr-2 h-4 w-4" />
              Carga masiva
            </Button>
            <Button>
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              Nuevo asegurado
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex-1 sm:min-w-[16rem]">
          <label htmlFor="insured-search" className="sr-only">
            Buscar
          </label>
          <Input
            id="insured-search"
            placeholder="Buscar por CURP, RFC, nombre o póliza..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={pkg} onValueChange={setPkg}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filtrar por paquete">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los paquetes</SelectItem>
            <SelectItem value="basic">Básico</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
            <SelectItem value="platinum">Platinum</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable data={MOCK} columns={columns} rowKey={(r) => r.id} caption="Listado de asegurados" />

      <Pagination
        hasPrev={page > 0}
        hasNext
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        pageInfo={`Página ${page + 1}`}
      />
    </div>
  );
}
