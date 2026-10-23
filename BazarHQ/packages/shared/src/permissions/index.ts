/**
 * Role → permission matrix (SRS §4.3, §9.3).
 *
 * Used by route guards and to hide actions a role can't take. This is a UX
 * control only (AUTHZ-03); RLS and trusted server operations are the
 * security boundary.
 */
import type { Role } from '../types';

export const PERMISSIONS = [
  // Storefront / customer
  'storefront:browse',
  'order:place',
  'order:read_own',
  'address:manage_own',
  'return:request',
  'ticket:submit',
  'ticket:reply_own',
  // Merchant
  'store:manage_own',
  'product:manage_own',
  'inventory:adjust_own',
  'order:update_status_own',
  'order:cancel_own',
  'cod:record_collection',
  'payment:manual_review_own',
  'payment_config:manage_own',
  'return:review_own',
  'refund:process_own',
  'ticket:manage_assigned',
  'analytics:read_own',
  // Super Admin
  'admin:access',
  'analytics:read_platform',
  'merchant:suspend',
  'merchant:delete',
  'store:read_all',
  'customer:read_all',
  'theme:manage',
  'announcement:manage',
  'policy:submit',
  'policy:approve',
  'policy:publish',
  'ticket:manage_all',
  'dispute:resolve',
  'refund:intervene',
  'payment:manual_review_any',
  'audit:read',
  'health:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER: readonly Permission[] = [
  'storefront:browse',
  'order:place',
  'order:read_own',
  'address:manage_own',
  'return:request',
  'ticket:submit',
  'ticket:reply_own',
];

const MERCHANT: readonly Permission[] = [
  'storefront:browse',
  'store:manage_own',
  'product:manage_own',
  'inventory:adjust_own',
  'order:update_status_own',
  'order:cancel_own',
  'cod:record_collection',
  'payment:manual_review_own',
  'payment_config:manage_own',
  'return:review_own',
  'refund:process_own',
  'ticket:manage_assigned',
  'analytics:read_own',
];

/**
 * Super Admin: read-only business oversight. Note what is NOT here:
 * order:update_status_* (no ordinary order/delivery changes, §13.1),
 * payment_config:* (never touches merchant credentials, FR-SA-10),
 * order:place, product:manage_*.
 */
const SUPER_ADMIN: readonly Permission[] = [
  'admin:access',
  'analytics:read_platform',
  'merchant:suspend',
  'merchant:delete',
  'store:read_all',
  'customer:read_all',
  'theme:manage',
  'announcement:manage',
  'policy:submit',
  'policy:approve',
  'policy:publish',
  'ticket:manage_all',
  'dispute:resolve',
  'refund:intervene',
  'payment:manual_review_any',
  'audit:read',
  'health:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: CUSTOMER,
  merchant: MERCHANT,
  super_admin: SUPER_ADMIN,
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return permission === 'storefront:browse' || permission === 'order:place';
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Where each role lands after signing in. */
export const ROLE_HOME: Readonly<Record<Role, string>> = {
  customer: '/customer',
  merchant: '/merchant/dashboard',
  super_admin: '/admin/dashboard',
};

/** Policy dual approval (FR-SA-18, DB-12): submitter and approver must differ. */
export function canApprovePolicy(adminId: string, submittedBy: string): boolean {
  return adminId !== submittedBy;
}
