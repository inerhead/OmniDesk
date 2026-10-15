/** Estado efectivo de una empresa (SPEC 18). Vive en `shared/kernel`: también lo usa el Outbox. */
export {
  tenantState,
  tenantStateSelect,
  type TenantState,
  type TenantStateSource,
} from '../../../shared/kernel/tenant-state';
