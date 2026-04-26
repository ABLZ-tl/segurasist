import type { PrismaService } from '@common/prisma/prisma.service';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

/**
 * Factory que devuelve un PrismaService completamente mockeado (deep proxy).
 *
 * Usar en unit tests de servicios que dependen de PrismaService:
 *   const prisma = mockPrismaService();
 *   prisma.client.tenant.findMany.mockResolvedValue([...]);
 *
 * El cliente expuesto es `prisma.client` (el extended con RLS), pero por
 * conveniencia el deep proxy también expone los modelos en la raíz del
 * objeto (PrismaService root) para compatibilidad. En el código de
 * producción siempre se usa `prisma.client.<model>`.
 */
export function mockPrismaService(): DeepMockProxy<PrismaService> {
  return mockDeep<PrismaService>();
}
