import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  age: number;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Ana', age: 30 },
  { id: 'r2', name: 'Bruno', age: 25 },
];

const COLS: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nombre', cell: (r) => r.name },
  { id: 'age', header: 'Edad', cell: (r) => r.age },
];

describe('<DataTable>', () => {
  it('renders headers and rows', () => {
    render(<DataTable data={ROWS} columns={COLS} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Edad' })).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('renders the empty state when data is empty', () => {
    render(
      <DataTable
        data={[]}
        columns={COLS}
        rowKey={(r) => r.id}
        emptyTitle="Vacío"
        emptyDescription="No hay nada"
      />,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Vacío')).toBeTruthy();
    expect(screen.getByText('No hay nada')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders skeletons (aria-busy) while loading', () => {
    const { container } = render(
      <DataTable data={ROWS} columns={COLS} rowKey={(r) => r.id} loading />,
    );
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('uses provided rowKey for unique keys per row', () => {
    const keys: string[] = [];
    const rowKey = (r: Row, i: number) => {
      keys.push(`${r.id}-${i}`);
      return `${r.id}-${i}`;
    };
    render(<DataTable data={ROWS} columns={COLS} rowKey={rowKey} />);
    expect(keys).toEqual(['r1-0', 'r2-1']);
  });

  it('handles cell function returning null/undefined safely', () => {
    const cols: DataTableColumn<Row>[] = [
      { id: 'name', header: 'N', cell: (r) => r.name },
      { id: 'maybe', header: 'M', cell: () => null },
    ];
    render(<DataTable data={ROWS} columns={cols} rowKey={(r) => r.id} />);
    // Should still render two rows worth of <td>
    const tbody = screen.getByRole('table').querySelector('tbody');
    expect(tbody?.querySelectorAll('tr').length).toBe(2);
  });

  it('invokes onRowClick when a row is clicked and applies cursor class', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable data={ROWS} columns={COLS} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    const firstRow = screen.getAllByRole('row')[1]; // 0 = thead
    expect(firstRow).toHaveClass('cursor-pointer');
    await user.click(within(firstRow!).getByText('Ana'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('does not add cursor-pointer when no onRowClick', () => {
    render(<DataTable data={ROWS} columns={COLS} rowKey={(r) => r.id} />);
    const firstRow = screen.getAllByRole('row')[1];
    expect(firstRow).not.toHaveClass('cursor-pointer');
  });

  it('renders an sr-only caption when provided', () => {
    render(
      <DataTable
        data={ROWS}
        columns={COLS}
        rowKey={(r) => r.id}
        caption="Lista de usuarios"
      />,
    );
    expect(screen.getByText('Lista de usuarios')).toHaveClass('sr-only');
  });

  it('applies col scope by default and respects override', () => {
    const cols: DataTableColumn<Row>[] = [
      { id: 'name', header: 'N', cell: (r) => r.name, scope: 'row' },
      { id: 'age', header: 'A', cell: (r) => r.age },
    ];
    render(<DataTable data={ROWS} columns={cols} rowKey={(r) => r.id} />);
    const nameHeader = screen.getByRole('rowheader', { name: 'N' });
    const ageHeader = screen.getByRole('columnheader', { name: 'A' });
    expect(nameHeader).toHaveAttribute('scope', 'row');
    expect(ageHeader).toHaveAttribute('scope', 'col');
  });
});
