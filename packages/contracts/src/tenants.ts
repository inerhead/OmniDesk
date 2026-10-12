import { z } from 'zod';

export const TenantSlugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](-?[a-z0-9])*$/, 'Solo minúsculas, números y guiones simples');

/** `POST /api/v1/tenants`: quien la crea queda como OWNER y la empresa pasa a ser la activa. */
export const CreateTenantRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: TenantSlugSchema,
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantSchema = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });
export type Tenant = z.infer<typeof TenantSchema>;
