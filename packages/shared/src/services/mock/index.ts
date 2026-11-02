/**
 * In-memory mock implementation of PlatformServices (Customer, Merchant,
 * Super Admin).
 *
 * It behaves like the trusted server: it re-validates input, enforces the
 * order/return/refund/ticket/policy state machines, the stock model, tenant
 * ownership (403 for other stores' resources), Super Admin TOTP +
 * idle checks, and idempotency keys. State is persisted to browser storage
 * (per viewer, best-effort) so a demo survives reloads.
 *
 * Never put real credentials here. Payment credentials sent to the mock are
 * validated and DISCARDED; only a masked hint is kept, as the real Edge
 * Function would return.
 */
import { formatPublicId } from '../../formatters';
import type { Order } from '../../types';
import type { PlatformServices } from '../contracts';
import { createAccountServices } from './account';
import { createAdminServices } from './admin';
import { createMockContext, type MockOptions } from './context';
import { createMerchantServices } from './merchant';
import { createReturnServices } from './returns';
import { DEMO_ACCOUNTS, DEMO_TOTP_CODE } from './seed';
import { createStorefrontServices } from './storefront';

export { DEMO_ACCOUNTS, DEMO_TOTP_CODE, DEMO_PASSWORD, DEMO_ADMIN_PASSWORD, DEMO_CUSTOMER_PASSWORD } from './seed';
export type { MockOptions, MockStorage } from './context';

export interface MockDevTools {
  reset(): void;
  /** Simulates the user clicking the verification link in their inbox. */
  simulateVerificationClick(email: string): void;
  /** Returns the most recent password-reset token (in production it is only emailed). */
  latestResetToken(): string | null;
  simulateIncomingOrder(): Promise<void>;
  /** Legacy test metadata only; changing this value does not authorize or block Admin access. */
  setAdminNetwork(network: 'allowlisted' | 'blocked'): void;
  adminNetwork(): 'allowlisted' | 'blocked';
  /** Ages the admin session past the 30-minute idle limit. */
  expireAdminSession(): void;
  demoAccounts: typeof DEMO_ACCOUNTS;
  demoTotpCode: string;
}

export type MockPlatformServices = PlatformServices & { dev: MockDevTools };
/** Back-compat name from the Merchant-only phase. */
export type MockMerchantServices = MockPlatformServices;

export function createMockServices(options: MockOptions = {}): MockPlatformServices {
  const ctx = createMockContext(options);
  const merchant = createMerchantServices(ctx);
  const storefront = createStorefrontServices(ctx);
  const services: MockPlatformServices = {
    ...merchant,
    returns: createReturnServices(ctx),
    storefront: storefront.storefront,
    checkout: storefront.checkout,
    account: createAccountServices(ctx),
    ...createAdminServices(ctx),
    dev: {
      reset: () => ctx.reset(),
      simulateVerificationClick(email: string) {
        const db = ctx.db;
        db.verificationLinkClicked[email.toLowerCase()] = true;
        const u = db.users.find((x) => x.profile.pendingEmail === email.toLowerCase());
        if (u) {
          u.profile.email = email.toLowerCase();
          u.profile.pendingEmail = null;
        }
        ctx.save();
      },
      latestResetToken() {
        const entries = Object.entries(ctx.db.resetTokens).filter(([, v]) => !v.used);
        return entries.length ? entries[entries.length - 1]![0] : null;
      },
      async simulateIncomingOrder() {
        await ctx.write(() => {
          const db = ctx.db;
          const store = db.stores.find((s) => s.ownerId === db.currentUserId);
          if (!store) return;
          const p = db.products.find(
            (x) => x.storeId === store.id && x.status === 'active' && x.productType === 'simple' && (x.stockQuantity ?? 0) > 0 && !x.deletedAt,
          );
          if (!p) return;
          const created = ctx.now();
          const oid = ctx.newId('9999');
          const orderNumber = formatPublicId('ORD', created, ++db.seq.order);
          const before = p.stockQuantity ?? 0;
          p.stockQuantity = before - 1;
          const charge = store.extensions.shipping.insideDhakaCharge;
          const order: Order = {
            id: oid,
            orderNumber,
            storeId: store.id,
            customerId: null,
            customerName: 'Mitu Akter',
            orderPhone: '01311000006',
            orderEmail: null,
            status: 'pending',
            paymentMethod: 'cod',
            paymentStatus: 'cod_pending',
            subtotal: p.basePrice,
            deliveryCharge: charge,
            totalAmount: p.basePrice + charge,
            currency: 'BDT',
            deliveryAddress: { recipientName: 'Mitu Akter', phone: '01311000006', address: 'Road 2, Mirpur 10', district: 'Dhaka', postalCode: null },
            cancellationReason: null,
            items: [
              {
                id: ctx.newId('8888'),
                orderId: oid,
                productId: p.id,
                variantId: null,
                productName: p.name,
                variantLabel: null,
                quantity: 1,
                unitPrice: p.basePrice,
                subtotal: p.basePrice,
              },
            ],
            createdAt: created.toISOString(),
            updatedAt: created.toISOString(),
          };
          db.orders.push(order);
          db.events.push({
            id: ctx.newId('7777'),
            orderId: oid,
            actorId: null,
            actorName: 'System',
            eventType: 'pending',
            notes: 'Order placed by customer.',
            proofImagePath: null,
            codAmount: null,
            createdAt: order.createdAt,
          });
          db.payments.push({
            id: ctx.newId('6666'),
            orderId: oid,
            method: 'cod',
            provider: 'cod',
            status: 'pending',
            amount: order.totalAmount,
            currency: 'BDT',
            providerReferenceMasked: null,
            createdAt: order.createdAt,
            verifiedAt: null,
          });
          ctx.recordMovement({
            storeId: store.id,
            productId: p.id,
            variantId: null,
            productName: p.name,
            variantLabel: null,
            quantityDelta: -1,
            reason: 'sale',
            actorId: null,
            actorName: 'System',
            referenceType: 'order',
            referenceId: orderNumber,
            note: null,
          });
          ctx.notify(store.ownerId, {
            type: 'new_order',
            title: 'New order received',
            body: `${orderNumber} from Mitu Akter • ৳${order.totalAmount}`,
            referenceType: 'order',
            referenceId: oid,
          });
          ctx.maybeLowStockAlert(p, before, before - 1, null);
        }, 0.2);
      },
      setAdminNetwork(network) {
        ctx.db.admin.network = network;
        ctx.db.admin.ip = network === 'allowlisted' ? '103.112.10.5' : '37.111.200.14';
        ctx.save();
        ctx.emit();
      },
      adminNetwork: () => ctx.db.admin.network,
      expireAdminSession() {
        ctx.db.admin.lastActivityAt = new Date(ctx.now().getTime() - 31 * 60_000).toISOString();
        ctx.save();
      },
      demoAccounts: DEMO_ACCOUNTS,
      demoTotpCode: DEMO_TOTP_CODE,
    },
  };
  return services;
}
