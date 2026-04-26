import { z } from 'zod';

/**
 * Roles que el API admite crear/asignar vía `/v1/users`. `admin_segurasist`
 * NO se acepta — sólo se inserta vía seed/manual (cross-tenant) y `insured`
 * vive en otra pool y se aprovisiona por flujo distinto.
 */
const ManageableRole = z.enum(['admin_mac', 'operator', 'supervisor']);

const UserStatusEnum = z.enum(['active', 'invited', 'disabled']);
const UserRoleQueryEnum = z.enum(['admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured']);

export const ListUsersQuerySchema = z.object({
  q: z.string().min(1).max(120).optional(),
  role: UserRoleQueryEnum.optional(),
  status: UserStatusEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Sólo respetado para superadmin; el service ignora si el caller no es platformAdmin.
  tenantId: z.string().uuid().optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  fullName: z.string().min(2).max(120),
  role: ManageableRole,
  tenantId: z.string().uuid().optional(),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    role: ManageableRole.optional(),
    status: UserStatusEnum.optional(),
    mfaEnrolled: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Body vacío: debe incluir al menos un campo',
  });
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
