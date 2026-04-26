/**
 * PrismaService unit test.
 *
 * El service es @Injectable({ scope: Scope.REQUEST }) y construye un
 * PrismaClient real en su constructor. Para no abrir conexiones a la BD,
 * mockeamos `@prisma/client` antes de importar el service.
 */
/* eslint-disable import/order */
import { ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

type ExecuteRawMock = jest.Mock<Promise<unknown>, [unknown]>;
type TxModelMock = Record<string, jest.Mock>;

interface PrismaClientMock {
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
  $extends: jest.Mock;
  // Modelos: cada uno con findMany/etc.
  tenant: TxModelMock;
}

const lastInstance: { value: PrismaClientMock | null } = { value: null };

jest.mock('@prisma/client', () => {
  const Prisma = {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: [...strings],
      values,
    }),
  };
  class PrismaClient {
    public $connect: jest.Mock;
    public $disconnect: jest.Mock;
    public $transaction: jest.Mock;
    public $extends: jest.Mock;
    public tenant: TxModelMock;

    constructor() {
      this.$connect = jest.fn().mockResolvedValue(undefined);
      this.$disconnect = jest.fn().mockResolvedValue(undefined);
      this.tenant = {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      };
      // $extends devuelve un proxy que reusa los mocks: por simplicidad
      // devolvemos un objeto con la misma forma del client.
      this.$extends = jest.fn().mockImplementation((cfg: unknown) => {
        // Guardamos el config para que los tests puedan extraer el callback de query.
        (this as unknown as { __extendsCfg: unknown }).__extendsCfg = cfg;
        return this;
      });
      // $transaction(cb): construye un "tx client" tipo el root y lo pasa al cb.
      this.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const txExec: ExecuteRawMock = jest.fn().mockResolvedValue(undefined);
        const tx = {
          $executeRaw: txExec,
          tenant: {
            findMany: jest.fn().mockResolvedValue(['tx-row']),
            findUnique: jest.fn(),
            create: jest.fn().mockResolvedValue({ id: 't1' }),
            update: jest.fn(),
            delete: jest.fn(),
          },
        };
        return cb(tx);
      });
      lastInstance.value = this as unknown as PrismaClientMock;
    }
  }
  return { PrismaClient, Prisma };
});
// Importar después del mock — IMPORT INTENCIONALMENTE FUERA DEL TOP para que el
// jest.mock() de arriba se aplique antes de evaluar el módulo bajo test.
// eslint-disable-next-line import/order
import { PrismaService } from './prisma.service';

const VALID_TENANT = '11111111-1111-1111-1111-111111111111';

function makeRequest(tenantId?: string): FastifyRequest & { tenant?: { id: string } } {
  return { tenant: tenantId ? { id: tenantId } : undefined } as unknown as FastifyRequest & {
    tenant?: { id: string };
  };
}

describe('PrismaService', () => {
  beforeEach(() => {
    lastInstance.value = null;
    jest.clearAllMocks();
  });

  it('onModuleInit conecta el cliente raíz', async () => {
    const svc = new PrismaService(makeRequest(VALID_TENANT));
    await svc.onModuleInit();
    expect(lastInstance.value?.$connect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy desconecta el cliente raíz', async () => {
    const svc = new PrismaService(makeRequest(VALID_TENANT));
    await svc.onModuleDestroy();
    expect(lastInstance.value?.$disconnect).toHaveBeenCalledTimes(1);
  });

  describe('withTenant()', () => {
    it('abre $transaction y ejecuta SET set_config(app.current_tenant) antes del callback', async () => {
      const svc = new PrismaService(makeRequest(VALID_TENANT));
      let setCalled = false;
      const result = await svc.withTenant(async (tx) => {
        const txAny = tx as unknown as { $executeRaw: jest.Mock; tenant: { findMany: jest.Mock } };
        // El test verifica que el SET ya corrió (el mock $transaction lo invoca primero antes del cb).
        expect(txAny.$executeRaw).toHaveBeenCalledTimes(1);
        const sqlArg = txAny.$executeRaw.mock.calls[0]?.[0] as { values: unknown[] };
        expect(sqlArg.values).toContain(VALID_TENANT);
        setCalled = true;
        return 'ok';
      });
      expect(setCalled).toBe(true);
      expect(result).toBe('ok');
      expect(lastInstance.value?.$transaction).toHaveBeenCalledTimes(1);
    });

    it('lanza ForbiddenException si el request no tiene tenant', async () => {
      const svc = new PrismaService(makeRequest(undefined));
      await expect(svc.withTenant(async () => undefined)).rejects.toThrow(ForbiddenException);
      await expect(svc.withTenant(async () => undefined)).rejects.toThrow('Tenant context missing');
    });

    it('lanza ForbiddenException si el tenantId no es UUID válido', async () => {
      const svc = new PrismaService(makeRequest('not-a-uuid'));
      await expect(svc.withTenant(async () => undefined)).rejects.toThrow('Tenant id malformed');
    });

    it.each([
      'too-short',
      '11111111-1111-1111-1111',
      "11111111-1111-1111-1111-11111111111'; DROP TABLE users;",
      '11111111111111111111111111111111',
    ])('rechaza tenantId malformado: %s', async (bad) => {
      const svc = new PrismaService(makeRequest(bad));
      await expect(svc.withTenant(async () => undefined)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('client (extends RLS wrapper)', () => {
    function getQueryCallback(): (params: {
      args: unknown;
      query: (a: unknown) => Promise<unknown>;
      model: string | undefined;
      operation: string;
    }) => Promise<unknown> {
      const cfg = (lastInstance.value as unknown as { __extendsCfg: { query: { $allOperations: unknown } } })
        .__extendsCfg;
      return cfg.query.$allOperations as never;
    }

    it('cuando hay model, abre transacción, fija app.current_tenant y re-despacha al modelo del tx', async () => {
      const svc = new PrismaService(makeRequest(VALID_TENANT));
      void svc; // ya construido — el wrapper está registrado
      const cb = getQueryCallback();

      const out = await cb({
        args: { where: { id: 1 } },
        query: jest.fn().mockResolvedValue('NEVER-CALLED'),
        model: 'Tenant',
        operation: 'findMany',
      });

      expect(out).toEqual(['tx-row']);
      // $transaction fue invocada
      expect(lastInstance.value?.$transaction).toHaveBeenCalledTimes(1);
    });

    it('cuando NO hay model (raw $executeRaw/$queryRaw), invoca query(args) directo sin SET', async () => {
      const svc = new PrismaService(makeRequest(VALID_TENANT));
      void svc;
      const cb = getQueryCallback();

      const directQuery = jest.fn().mockResolvedValue('raw-result');
      const out = await cb({
        args: 'raw-args',
        query: directQuery,
        model: undefined,
        operation: 'queryRaw',
      });

      expect(out).toBe('raw-result');
      expect(directQuery).toHaveBeenCalledWith('raw-args');
      expect(lastInstance.value?.$transaction).not.toHaveBeenCalled();
    });

    it('lanza ForbiddenException si el tenant context falta cuando el wrapper se invoca', () => {
      const svc = new PrismaService(makeRequest(undefined));
      void svc;
      const cb = getQueryCallback();
      // El assertTenant interno es sincrónico → el throw no cae en una Promise rejection.
      expect(() => cb({ args: {}, query: jest.fn(), model: 'Tenant', operation: 'findMany' })).toThrow(
        ForbiddenException,
      );
    });

    it('lanza error legible si el modelo es desconocido en el tx client', async () => {
      const svc = new PrismaService(makeRequest(VALID_TENANT));
      void svc;
      const cb = getQueryCallback();

      // El mock de $transaction sólo expone `tenant`. Pedir `Insured` debe romper.
      await expect(
        cb({ args: {}, query: jest.fn(), model: 'Insured', operation: 'findMany' }),
      ).rejects.toThrow(/modelo desconocido/);
    });

    it('lanza error legible si la operación es desconocida en el modelo', async () => {
      const svc = new PrismaService(makeRequest(VALID_TENANT));
      void svc;
      const cb = getQueryCallback();
      await expect(
        cb({ args: {}, query: jest.fn(), model: 'Tenant', operation: 'doesNotExist' }),
      ).rejects.toThrow(/operación desconocida/);
    });
  });
});
