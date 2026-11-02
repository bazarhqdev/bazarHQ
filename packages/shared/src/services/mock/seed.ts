/**
 * Deterministic synthetic seed data for the mock service layer (all roles).
 * No real people, stores or credentials. Dates are relative to `now`.
 */
import { LIMITS } from '../../constants';
import { dayKey, formatPublicId } from '../../formatters';
import type {
  AccountUser,
  ActiveSession,
  Address,
  DeviceToken,
  Announcement,
  AuditLog,
  Category,
  DeliveryEvent,
  HealthComponent,
  InventoryMovement,
  Notification,
  Order,
  OrderItem,
  OrderStatus,
  PaymentConfig,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionSummary,
  Policy,
  Product,
  ProductVariant,
  Refund,
  ReturnRequest,
  Store,
  StoreCategory,
  SupportTicket,
  ThemeAdmin,
  TicketAuditEntry,
  TicketMessage,
} from '../../types';

export interface MockUser {
  profile: AccountUser;
  password: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** Super Admin only: TOTP enrolment (AUTH-09). */
  totpEnrolled?: boolean;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
}

export type StoredProduct = Product & { deletedAt: string | null };

export interface AdminState {
  /** Legacy network metadata retained for older mock fixtures; not an authorization factor. */
  network: 'allowlisted' | 'blocked';
  ip: string;
  pendingMfaUserId: string | null;
  mfaVerified: boolean;
  lastActivityAt: string | null;
}

export interface MockDb {
  version: number;
  seededAt: string;
  currentUserId: string | null;
  users: MockUser[];
  stores: Store[];
  themes: ThemeAdmin[];
  categories: Category[];
  products: StoredProduct[];
  movements: InventoryMovement[];
  orders: Order[];
  events: DeliveryEvent[];
  payments: PaymentTransactionSummary[];
  returns: ReturnRequest[];
  refunds: Refund[];
  paymentConfigs: PaymentConfig[];
  tickets: SupportTicket[];
  messages: TicketMessage[];
  ticketAudit: TicketAuditEntry[];
  notifications: Notification[];
  addresses: Address[];
  announcements: Announcement[];
  policies: Policy[];
  auditLogs: AuditLog[];
  health: HealthComponent[];
  admin: AdminState;
  sessions: Record<string, ActiveSession[]>;
  /** Subdomains reserved by synthetic merchants outside the seed. */
  takenSubdomains: string[];
  idempotency: Record<string, string>;
  visitors: Record<string, Record<string, number>>;
  seq: { order: number; ticket: number; ret: number; id: number };
  pendingTotpSecret: string | null;
  verificationLinkClicked: Record<string, boolean>;
  resetTokens: Record<string, { email: string; expiresAt: string; used: boolean }>;
  trackAttempts: number[];
  sslSessions: Record<string, { orderId: string; attemptId: string; used: boolean; amount: number }>;
  /** Hashed in production; the mock keeps the raw value only to match unregister calls. */
  deviceTokens: (DeviceToken & { token: string })[];
}

export const MOCK_DB_VERSION = 7;

export const DEMO_PASSWORD = 'Merchant123';
export const DEMO_CUSTOMER_PASSWORD = 'Customer123';
export const DEMO_ADMIN_PASSWORD = 'Admin12345';
/** Mock TOTP code. A real deployment verifies RFC 6238 codes server-side. */
export const DEMO_TOTP_CODE = '246810';

export const DEMO_ACCOUNTS = [
  { email: 'merchant@bazarhq.test', password: DEMO_PASSWORD, role: 'merchant', note: 'Merchant · Green Basket (published)' },
  { email: 'fashion@bazarhq.test', password: DEMO_PASSWORD, role: 'merchant', note: 'Merchant · Fashion Point (published)' },
  { email: 'new@bazarhq.test', password: DEMO_PASSWORD, role: 'merchant', note: 'Merchant without a store (onboarding)' },
  { email: 'unverified@bazarhq.test', password: DEMO_PASSWORD, role: 'merchant', note: 'Merchant, email not verified' },
  { email: 'suspended@bazarhq.test', password: DEMO_PASSWORD, role: 'merchant', note: 'Suspended merchant (Kids Heaven)' },
  { email: 'customer@bazarhq.test', password: DEMO_CUSTOMER_PASSWORD, role: 'customer', note: 'Customer · orders in 3 stores, saved addresses' },
  { email: 'admin@bazarhq.test', password: DEMO_ADMIN_PASSWORD, role: 'super_admin', note: `Super Admin · TOTP ${DEMO_TOTP_CODE}` },
  { email: 'admin2@bazarhq.test', password: DEMO_ADMIN_PASSWORD, role: 'super_admin', note: `Second Super Admin (dual approval) · TOTP ${DEMO_TOTP_CODE}` },
] as const;

/* --------------------------- PRNG helpers --------------------------- */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uuidFrom(n: number, prefix = '0000'): string {
  const hex = n.toString(16).padStart(12, '0');
  return `${prefix.padStart(8, '0')}-0000-4000-8000-${hex}`;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

type VariantDef = [label: string, adj: number, stock: number];
/** Demo original/asking prices (display only) for a few products in each store. */
const COMPARE_AT: Record<string, number> = {
  'FRU-APL-1KG': 380,
  'FRU-MNG-1KG': 180,
  'GRO-OIL-MST': 165,
  'BEV-GRT-100': 320,
  'DR-KUR-PRN': 1550,
  'SH-RUN-01': 2990,
  'BG-LTH-BP': 4200,
  'AU-SPK-02': 3800,
  'PB-10K': 1990,
  'WR-SW-01': 4990,
};

interface ProductDef {
  name: string;
  description: string;
  category: string;
  price: number;
  stock?: number;
  threshold?: number;
  status?: Product['status'];
  sku: string;
  variants?: VariantDef[];
  ageDays: number;
}
interface StoreDef {
  key: string;
  ownerIndex: number;
  name: string;
  subdomain: string;
  status: Store['status'];
  category: StoreCategory;
  tagline: string;
  brandColour: string;
  themeIndex: number;
  ageDays: number;
  categories: string[];
  products: ProductDef[];
  orderCount: number;
  orderDays: number;
  methods: PaymentMethod[];
  configs: [PaymentMethod, boolean, string | null][];
}

const STORE_DEFS: StoreDef[] = [
  {
    key: 'gb',
    ownerIndex: 0,
    name: 'Green Basket',
    subdomain: 'greenbasket',
    status: 'published',
    category: 'groceries',
    tagline: 'Fresh Food • Healthy Life',
    brandColour: '#059669',
    themeIndex: 1,
    ageDays: 110,
    categories: ['Vegetables', 'Fruits', 'Groceries', 'Dairy & Eggs', 'Beverages', 'Snacks'],
    orderCount: 56,
    orderDays: 60,
    methods: ['cod', 'cod', 'cod', 'bkash', 'bkash', 'nagad', 'rocket', 'sslcommerz'],
    configs: [
      ['bkash', true, '••••5678'],
      ['nagad', true, '••••4321'],
      ['rocket', true, '••••7788'],
      ['sslcommerz', true, '••••e_01'],
      ['cod', true, null],
    ],
    products: [
      {
        name: 'Fresh Tomato (Local)',
        description: 'Fresh, farm-sourced local tomatoes, sold per kg.',
        category: 'Vegetables',
        price: 60,
        stock: 100,
        sku: 'VEG-TOM-1KG',
        ageDays: 100,
      },
      {
        name: 'Potato (Local)',
        description: 'Everyday local potatoes, washed and sorted, per kg.',
        category: 'Vegetables',
        price: 28,
        stock: 200,
        sku: 'VEG-POT-1KG',
        ageDays: 100,
      },
      {
        name: 'Onion (Local)',
        description: 'Local red onions with a strong aroma, per kg.',
        category: 'Vegetables',
        price: 45,
        stock: 8,
        threshold: 10,
        sku: 'VEG-ONI-1KG',
        ageDays: 98,
      },
      { name: 'Carrot', description: 'Crunchy, sweet carrots, per kg.', category: 'Vegetables', price: 60, stock: 0, sku: 'VEG-CAR-1KG', ageDays: 90 },
      {
        name: 'Broccoli',
        description: 'Fresh green broccoli heads, about 500 g each.',
        category: 'Vegetables',
        price: 120,
        stock: 25,
        sku: 'VEG-BRO-500',
        ageDays: 80,
      },
      { name: 'Banana (Sagor)', description: 'Ripe Sagor bananas, sold per dozen.', category: 'Fruits', price: 90, stock: 50, sku: 'FRU-BAN-DZN', ageDays: 95 },
      { name: 'Red Apple', description: 'Crisp, juicy red apples, per kg.', category: 'Fruits', price: 320, stock: 40, sku: 'FRU-APL-1KG', ageDays: 70 },
      {
        name: 'Mango (Himsagar)',
        description: 'Seasonal Himsagar mangoes from Rajshahi, per kg.',
        category: 'Fruits',
        price: 150,
        stock: 0,
        status: 'inactive',
        sku: 'FRU-MNG-1KG',
        ageDays: 60,
      },
      {
        name: 'Aromatic Rice (Chinigura)',
        description: 'Fragrant small-grain Chinigura rice for polao and payesh.',
        category: 'Groceries',
        price: 120,
        sku: 'GRO-RIC-CHN',
        ageDays: 100,
        variants: [
          ['1 kg', 0, 60],
          ['5 kg', 460, 12],
        ],
      },
      {
        name: 'Masoor Dal',
        description: 'Split red lentils, cleaned and packed, 1 kg.',
        category: 'Groceries',
        price: 135,
        stock: 70,
        sku: 'GRO-DAL-1KG',
        ageDays: 88,
      },
      {
        name: 'Mustard Oil',
        description: 'Cold-pressed mustard oil with a sharp, traditional taste.',
        category: 'Groceries',
        price: 140,
        sku: 'GRO-OIL-MST',
        ageDays: 85,
        threshold: 5,
        variants: [
          ['500 ml', 0, 30],
          ['1 litre', 130, 4],
          ['5 litre', 560, 0],
        ],
      },
      {
        name: 'Full Cream Milk',
        description: 'Pasteurised full cream milk, 1 litre pack.',
        category: 'Dairy & Eggs',
        price: 110,
        stock: 3,
        sku: 'DAI-MLK-1L',
        ageDays: 75,
      },
      {
        name: 'Farm Eggs',
        description: 'Brown farm eggs, packed fresh every morning.',
        category: 'Dairy & Eggs',
        price: 75,
        sku: 'DAI-EGG',
        ageDays: 92,
        threshold: 5,
        variants: [
          ['6 pcs', 0, 40],
          ['12 pcs', 70, 22],
          ['30 pcs', 270, 2],
        ],
      },
      {
        name: 'Green Tea',
        description: 'Sylhet green tea leaves, 100 g pouch.',
        category: 'Beverages',
        price: 280,
        stock: 18,
        status: 'draft',
        sku: 'BEV-GRT-100',
        ageDays: 4,
      },
      {
        name: 'Spiced Chanachur',
        description: 'Crunchy spiced chanachur mix, 250 g.',
        category: 'Snacks',
        price: 65,
        stock: 90,
        sku: 'SNK-CHN-250',
        ageDays: 50,
      },
      {
        name: 'Mineral Water',
        description: 'Bottled drinking water, 1.5 litre.',
        category: 'Beverages',
        price: 35,
        stock: 150,
        sku: 'BEV-WAT-15L',
        ageDays: 45,
      },
    ],
  },
  {
    key: 'fp',
    ownerIndex: 4,
    name: 'Fashion Point',
    subdomain: 'fashionpoint',
    status: 'published',
    category: 'fashion',
    tagline: 'Trendy Fashion for Everyone',
    brandColour: '#BE185D',
    themeIndex: 5,
    ageDays: 140,
    categories: ['T-Shirts', 'Dresses', 'Shoes', 'Bags', 'Accessories'],
    orderCount: 30,
    orderDays: 60,
    methods: ['cod', 'bkash', 'bkash', 'nagad', 'sslcommerz', 'sslcommerz'],
    configs: [
      ['bkash', true, '••••1122'],
      ['nagad', true, '••••3344'],
      ['rocket', false, null],
      ['sslcommerz', true, '••••fp_9'],
      ['cod', true, null],
    ],
    products: [
      {
        name: "Men's Cotton T-Shirt",
        description: 'Soft 100% cotton crew-neck T-shirt, breathable for Dhaka summers.',
        category: 'T-Shirts',
        price: 450,
        sku: 'TS-MEN-CTN',
        ageDays: 120,
        variants: [
          ['S', 0, 12],
          ['M', 0, 20],
          ['L', 0, 15],
          ['XL', 50, 4],
        ],
      },
      {
        name: 'Printed Kurti',
        description: 'Hand-block printed cotton kurti with three-quarter sleeves.',
        category: 'Dresses',
        price: 1250,
        sku: 'DR-KUR-PRN',
        ageDays: 90,
        variants: [
          ['S', 0, 6],
          ['M', 0, 9],
          ['L', 0, 3],
        ],
      },
      {
        name: 'Running Shoes',
        description: 'Lightweight running shoes with cushioned sole and mesh upper.',
        category: 'Shoes',
        price: 2450,
        sku: 'SH-RUN-01',
        ageDays: 75,
        variants: [
          ['40', 0, 5],
          ['41', 0, 7],
          ['42', 0, 2],
          ['43', 0, 0],
        ],
      },
      {
        name: 'Leather Backpack',
        description: 'Genuine leather backpack with padded laptop sleeve.',
        category: 'Bags',
        price: 3600,
        stock: 9,
        sku: 'BG-LTH-BP',
        ageDays: 100,
      },
      {
        name: 'Classic Sunglasses',
        description: 'UV400 polarised sunglasses with metal frame.',
        category: 'Accessories',
        price: 1200,
        stock: 25,
        sku: 'AC-SUN-CL',
        ageDays: 60,
      },
      {
        name: 'Silk Scarf',
        description: 'Lightweight printed silk scarf, 90 × 90 cm.',
        category: 'Accessories',
        price: 850,
        stock: 4,
        sku: 'AC-SCF-SLK',
        ageDays: 30,
      },
      {
        name: 'Denim Jacket',
        description: 'Classic blue denim jacket with button front.',
        category: 'T-Shirts',
        price: 2200,
        sku: 'TS-DNM-JKT',
        ageDays: 45,
        variants: [
          ['M', 0, 4],
          ['L', 0, 6],
        ],
      },
    ],
  },
  {
    key: 'tw',
    ownerIndex: 5,
    name: 'Tech World',
    subdomain: 'techworld',
    status: 'published',
    category: 'electronics',
    tagline: 'Gadgets you can trust',
    brandColour: '#2563EB',
    themeIndex: 0,
    ageDays: 150,
    categories: ['Audio', 'Chargers & Cables', 'Wearables', 'Computer Accessories'],
    orderCount: 25,
    orderDays: 60,
    methods: ['cod', 'bkash', 'nagad', 'rocket', 'sslcommerz', 'sslcommerz'],
    configs: [
      ['bkash', true, '••••9001'],
      ['nagad', true, '••••9002'],
      ['rocket', true, '••••9003'],
      ['sslcommerz', true, '••••tw_4'],
      ['cod', true, null],
    ],
    products: [
      {
        name: 'Wireless Earbuds',
        description: 'Bluetooth 5.3 earbuds with charging case and 24-hour battery.',
        category: 'Audio',
        price: 2490,
        stock: 30,
        sku: 'AU-EB-01',
        ageDays: 140,
      },
      {
        name: 'Bluetooth Speaker',
        description: 'Portable waterproof speaker with deep bass.',
        category: 'Audio',
        price: 3200,
        stock: 12,
        sku: 'AU-SPK-02',
        ageDays: 120,
      },
      {
        name: '20W Fast Charger',
        description: 'USB-C power delivery wall charger, 20 W.',
        category: 'Chargers & Cables',
        price: 950,
        stock: 60,
        sku: 'CH-20W-PD',
        ageDays: 100,
      },
      {
        name: 'USB-C Cable',
        description: 'Braided USB-C to USB-C charging cable.',
        category: 'Chargers & Cables',
        price: 350,
        sku: 'CB-USBC',
        ageDays: 100,
        variants: [
          ['1 m', 0, 80],
          ['2 m', 100, 40],
        ],
      },
      {
        name: 'Power Bank 10000 mAh',
        description: 'Slim power bank with dual output and LED indicator.',
        category: 'Chargers & Cables',
        price: 1650,
        stock: 3,
        sku: 'PB-10K',
        ageDays: 80,
      },
      {
        name: 'Smart Watch',
        description: 'Fitness smart watch with heart-rate and sleep tracking.',
        category: 'Wearables',
        price: 4200,
        sku: 'WR-SW-01',
        ageDays: 70,
        variants: [
          ['Black', 0, 8],
          ['Silver', 200, 5],
        ],
      },
      {
        name: 'Wireless Mouse',
        description: 'Silent-click wireless mouse with USB receiver.',
        category: 'Computer Accessories',
        price: 790,
        stock: 40,
        sku: 'CA-MS-01',
        ageDays: 60,
      },
      {
        name: 'Mechanical Keyboard',
        description: 'Compact mechanical keyboard with blue switches.',
        category: 'Computer Accessories',
        price: 3900,
        stock: 0,
        sku: 'CA-KB-01',
        ageDays: 55,
      },
    ],
  },
  {
    key: 'kh',
    ownerIndex: 3,
    name: 'Kids Heaven',
    subdomain: 'kidsheaven',
    status: 'suspended',
    category: 'other',
    tagline: 'Toys and clothes for little ones',
    brandColour: '#D97706',
    themeIndex: 3,
    ageDays: 200,
    categories: ['Toys'],
    orderCount: 6,
    orderDays: 50,
    methods: ['cod'],
    configs: [
      ['cod', true, null],
      ['bkash', false, null],
      ['nagad', false, null],
      ['rocket', false, null],
      ['sslcommerz', false, null],
    ],
    products: [
      {
        name: 'Building Blocks Set',
        description: 'Colourful 120-piece building blocks for ages 3+.',
        category: 'Toys',
        price: 1100,
        stock: 14,
        sku: 'TY-BLK-120',
        ageDays: 150,
      },
    ],
  },
  {
    key: 'hs',
    ownerIndex: 6,
    name: 'Home Style',
    subdomain: 'homestyle',
    status: 'draft',
    category: 'home_living',
    tagline: 'Décor for every corner',
    brandColour: '#0F766E',
    themeIndex: 2,
    ageDays: 12,
    categories: ['Décor'],
    orderCount: 0,
    orderDays: 1,
    methods: ['cod'],
    configs: [
      ['cod', false, null],
      ['bkash', false, null],
      ['nagad', false, null],
      ['rocket', false, null],
      ['sslcommerz', false, null],
    ],
    products: [
      { name: 'Ceramic Vase', description: 'Hand-glazed ceramic vase, 25 cm tall.', category: 'Décor', price: 1450, stock: 6, sku: 'DC-VAS-25', ageDays: 10 },
    ],
  },
];

/* ------------------------------ Seed -------------------------------- */

export function createSeed(now: Date = new Date()): MockDb {
  const rnd = mulberry32(20261021);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const between = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
  let idCounter = 1;
  const id = (prefix: string) => uuidFrom(idCounter++, prefix);
  const iso = (t: number) => new Date(t).toISOString();
  const t0 = now.getTime();
  const past = (ms: number) => iso(Math.min(t0 - ms, t0 - 60_000));

  const profile = (pid: string, email: string, fullName: string, over: Partial<AccountUser> = {}): AccountUser => ({
    id: pid,
    email,
    fullName,
    phone: null,
    avatarUrl: null,
    role: 'merchant',
    status: 'active',
    suspensionReason: null,
    emailVerified: true,
    pendingEmail: null,
    authProvider: 'email',
    twoFactorEnabled: false,
    createdAt: iso(t0 - 120 * DAY),
    ...over,
  });
  const user = (p: AccountUser, password: string, extra: Partial<MockUser> = {}): MockUser => ({
    profile: p,
    password,
    failedAttempts: 0,
    lockedUntil: null,
    ...extra,
  });

  /* ------------------------------ Users ------------------------------ */

  const merchantProfiles: AccountUser[] = [
    profile(uuidFrom(1, 'aaaa'), 'merchant@bazarhq.test', 'Nusrat Jahan', { phone: '01712345678', createdAt: iso(t0 - 115 * DAY) }),
    profile(uuidFrom(2, 'aaaa'), 'new@bazarhq.test', 'Rafiq Uddin', { createdAt: iso(t0 - 2 * DAY) }),
    profile(uuidFrom(3, 'aaaa'), 'unverified@bazarhq.test', 'Tanvir Hasan', { emailVerified: false, createdAt: iso(t0 - DAY) }),
    profile(uuidFrom(4, 'aaaa'), 'suspended@bazarhq.test', 'Sadia Islam', {
      status: 'suspended',
      suspensionReason: 'Repeated customer complaints about undelivered orders are under review by BazarHQ.',
      phone: '01811223344',
      createdAt: iso(t0 - 205 * DAY),
    }),
    profile(uuidFrom(5, 'aaaa'), 'fashion@bazarhq.test', 'Fahmida Rahman', { phone: '01911445566', createdAt: iso(t0 - 145 * DAY) }),
    profile(uuidFrom(6, 'aaaa'), 'tech@bazarhq.test', 'Sarah Khan', { phone: '01611778899', createdAt: iso(t0 - 155 * DAY) }),
    profile(uuidFrom(7, 'aaaa'), 'homestyle@bazarhq.test', 'Nabila Islam', { createdAt: iso(t0 - 13 * DAY) }),
  ];

  const people = [
    ['Rahim Uddin', '01711000001', 'rahim@example.com', 'Dhaka', true],
    ['Nabila Khan', '01811000002', 'nabila@example.com', 'Dhaka', true],
    ['Tanvir Hossain', '01911000003', null, 'Gazipur', false],
    ['Sara Islam', '01611000004', 'sara@example.com', 'Dhaka', true],
    ['Fahim Ahmed', '01511000005', 'customer@bazarhq.test', 'Dhaka', true],
    ['Mitu Akter', '01311000006', null, 'Narayanganj', false],
    ['Arif Chowdhury', '01711000007', 'arif@example.com', 'Dhaka', true],
    ['Sumaiya Rahman', '01811000008', 'sumaiya@example.com', 'Sylhet', true],
    ['Kamal Hossain', '01911000009', null, 'Dhaka', false],
    ['Lamia Haque', '01611000010', 'lamia@example.com', 'Dhaka', true],
    ['Shakil Ahmed', '01511000011', null, 'Rajshahi', false],
    ['Tasnim Ara', '01711000012', 'tasnim@example.com', 'Khulna', true],
  ] as const;
  type Person = (typeof people)[number];
  const customerId = (p: Person) => uuidFrom(people.indexOf(p) + 1, '1111');
  const FAHIM = people[4];
  const fahimId = customerId(FAHIM);

  const customerUsers: MockUser[] = people
    .filter((p) => p[4])
    .map((p) =>
      user(
        profile(customerId(p), p[2]!, p[0], { role: 'customer', phone: p[1], createdAt: iso(t0 - between(20, 160) * DAY) }),
        p === FAHIM ? DEMO_CUSTOMER_PASSWORD : `seed-${Math.random().toString(36).slice(2)}`,
      ),
    );

  const adminA = profile(uuidFrom(1, 'adad'), 'admin@bazarhq.test', 'Arif Hossain', {
    role: 'super_admin',
    phone: '01700000101',
    twoFactorEnabled: true,
    createdAt: iso(t0 - 300 * DAY),
  });
  const adminB = profile(uuidFrom(2, 'adad'), 'admin2@bazarhq.test', 'Mehnaz Karim', {
    role: 'super_admin',
    phone: '01700000102',
    twoFactorEnabled: true,
    createdAt: iso(t0 - 280 * DAY),
  });

  const users: MockUser[] = [
    ...merchantProfiles.map((p) => user(p, DEMO_PASSWORD)),
    ...customerUsers,
    user(adminA, DEMO_ADMIN_PASSWORD, { totpEnrolled: true, lastLoginAt: past(26 * HOUR), lastLoginIp: '103.112.10.5' }),
    user(adminB, DEMO_ADMIN_PASSWORD, { totpEnrolled: true, lastLoginAt: past(3 * DAY), lastLoginIp: '103.112.10.6' }),
  ];

  /* ------------------------------ Themes ----------------------------- */

  const themeDefs: [string, string, string, boolean][] = [
    ['Default', 'Balanced layout with a hero banner and product grid.', '#0B1F3A', true],
    ['Modern', 'Bold imagery, rounded cards and large category tiles.', '#059669', true],
    ['Minimal', 'Quiet typography with lots of white space.', '#334155', true],
    ['Classic', 'Traditional storefront with a top category menu.', '#92400E', true],
    ['Grocery', 'Quick-add buttons and dense listings for daily needs.', '#16A34A', true],
    ['Fashion', 'Editorial layout for apparel and lookbooks.', '#BE185D', true],
    ['Retired Classic', 'No longer offered to new stores.', '#64748B', false],
  ];
  const themes: ThemeAdmin[] = themeDefs.map(([name, description, accent, isActive], i) => ({
    id: uuidFrom(i + 1, 'cccc'),
    name,
    description,
    previewUrl: null,
    isActive,
    accent,
    usedBy: [],
    breakingChangeEffectiveAt: null,
    createdAt: iso(t0 - (400 - i * 20) * DAY),
  }));

  /* --------------------- Stores, catalogues, orders ------------------- */

  const stores: Store[] = [];
  const categories: Category[] = [];
  const products: StoredProduct[] = [];
  const orders: Order[] = [];
  const events: DeliveryEvent[] = [];
  const payments: PaymentTransactionSummary[] = [];
  const movements: InventoryMovement[] = [];
  const paymentConfigs: PaymentConfig[] = [];
  const visitors: Record<string, Record<string, number>> = {};
  let orderSeq = 1240;
  const forward: OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
  const storeIdByKey: Record<string, string> = {};
  let productCounter = 0;
  let categoryCounter = 0;
  let variantCounter = 0;

  const ownerOf = (store: Store) => merchantProfiles.find((p) => p.id === store.ownerId)!;

  interface OrderSpec {
    store: Store;
    person: Person;
    method: PaymentMethod;
    status: OrderStatus;
    createdAt: number;
    items: { product: StoredProduct; variant: ProductVariant | null; qty: number }[];
    paymentStatus?: PaymentStatus;
  }

  function buildOrder(spec: OrderSpec): Order {
    const { store, person, method, status } = spec;
    const [name, phone, email, district, registered] = person;
    const owner = ownerOf(store);
    const oid = id('9999');
    const items: OrderItem[] = spec.items.map(({ product: p, variant: v, qty }) => {
      const unit = p.basePrice + (v?.priceAdjustment ?? 0);
      return {
        id: id('8888'),
        orderId: oid,
        productId: p.id,
        variantId: v?.id ?? null,
        productName: p.name,
        variantLabel: v?.variantLabel ?? null,
        quantity: qty,
        unitPrice: unit,
        subtotal: unit * qty,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const deliveryCharge = district === 'Dhaka' ? store.extensions.shipping.insideDhakaCharge : store.extensions.shipping.outsideDhakaCharge;
    const total = subtotal + deliveryCharge;
    let paymentStatus: PaymentStatus;
    if (spec.paymentStatus) paymentStatus = spec.paymentStatus;
    else if (method === 'cod') paymentStatus = status === 'delivered' && rnd() < 0.9 ? 'cod_collected' : 'cod_pending';
    else if (status === 'cancelled') paymentStatus = pick<PaymentStatus>(['failed', 'failed', 'paid']);
    else if (status === 'pending') paymentStatus = pick<PaymentStatus>(['pending_verification', 'paid', 'pending']);
    else paymentStatus = 'paid';

    const created = spec.createdAt;
    const orderNumber = formatPublicId('ORD', new Date(created), ++orderSeq);
    const createdIso = iso(created);
    const reached = status === 'cancelled' ? forward.slice(0, between(1, 3)) : forward.slice(0, forward.indexOf(status) + 1);
    let t = created;
    let lastIso = createdIso;
    reached.forEach((s, idx) => {
      if (idx > 0) t += between(2, 20) * HOUR;
      t = Math.min(t, t0 - 5 * 60_000);
      lastIso = iso(t);
      events.push({
        id: id('7777'),
        orderId: oid,
        actorId: idx === 0 ? null : owner.id,
        actorName: idx === 0 ? 'System' : owner.fullName,
        eventType: s,
        notes: idx === 0 ? 'Order placed by customer.' : s === 'shipped' ? 'Handed to courier.' : null,
        proofImagePath: null,
        codAmount: null,
        createdAt: lastIso,
      });
    });
    let cancellationReason: string | null = null;
    if (status === 'cancelled') {
      t = Math.min(t + between(1, 10) * HOUR, t0 - 5 * 60_000);
      lastIso = iso(t);
      cancellationReason = pick([
        'Customer requested cancellation by phone.',
        'Item went out of stock before dispatch.',
        'Payment failed and the customer did not retry.',
      ]);
      events.push({
        id: id('7777'),
        orderId: oid,
        actorId: owner.id,
        actorName: owner.fullName,
        eventType: 'cancelled',
        notes: cancellationReason,
        proofImagePath: null,
        codAmount: null,
        createdAt: lastIso,
      });
    }
    if (paymentStatus === 'cod_collected') {
      t = Math.min(t + 30 * 60_000, t0 - 60_000);
      lastIso = iso(t);
      events.push({
        id: id('7777'),
        orderId: oid,
        actorId: owner.id,
        actorName: owner.fullName,
        eventType: 'cod_collected',
        notes: 'Cash collected at doorstep.',
        proofImagePath: null,
        codAmount: total,
        createdAt: lastIso,
      });
    }
    const config = paymentConfigs.find((c) => c.storeId === store.id && c.method === method);
    const attemptStatus: PaymentTransactionSummary['status'] =
      paymentStatus === 'paid' || paymentStatus === 'cod_collected' || paymentStatus === 'refunded'
        ? 'paid'
        : paymentStatus === 'failed'
          ? 'failed'
          : paymentStatus === 'pending_verification'
            ? 'pending_verification'
            : 'pending';
    payments.push({
      id: id('6666'),
      orderId: oid,
      method,
      provider: method,
      status: attemptStatus,
      amount: total,
      currency: 'BDT',
      providerReferenceMasked: method === 'cod' || attemptStatus === 'pending' ? null : `••••${between(1000, 9999)}`,
      createdAt: createdIso,
      verifiedAt: attemptStatus === 'paid' || attemptStatus === 'failed' ? iso(created + 3 * 60_000) : null,
    });
    void config;
    for (const it of items) {
      movements.push({
        id: id('5555'),
        storeId: store.id,
        productId: it.productId,
        variantId: it.variantId,
        productName: it.productName,
        variantLabel: it.variantLabel,
        quantityDelta: -it.quantity,
        reason: 'sale',
        actorId: null,
        actorName: 'System',
        referenceType: 'order',
        referenceId: orderNumber,
        note: null,
        createdAt: createdIso,
      });
      if (status === 'cancelled') {
        movements.push({
          id: id('5555'),
          storeId: store.id,
          productId: it.productId,
          variantId: it.variantId,
          productName: it.productName,
          variantLabel: it.variantLabel,
          quantityDelta: it.quantity,
          reason: 'cancellation_release',
          actorId: owner.id,
          actorName: owner.fullName,
          referenceType: 'order',
          referenceId: orderNumber,
          note: cancellationReason,
          createdAt: lastIso,
        });
      }
    }
    const order: Order = {
      id: oid,
      orderNumber,
      storeId: store.id,
      customerId: registered ? customerId(person) : null,
      customerName: name,
      orderPhone: phone,
      orderEmail: email,
      status,
      paymentMethod: method,
      paymentStatus,
      subtotal,
      deliveryCharge,
      totalAmount: total,
      currency: 'BDT',
      deliveryAddress: {
        recipientName: name,
        phone,
        address: pick([
          'House 12, Road 5, Dhanmondi',
          'Level 4, BRAC Tower, Mohakhali',
          'Flat 3B, Road 11, Banani',
          'House 7, Sector 4, Uttara',
          'Holding 22, Agrabad',
          'House 45, Zindabazar',
          'Road 2, Mirpur 10',
        ]),
        district,
        postalCode: null,
      },
      cancellationReason,
      items,
      createdAt: createdIso,
      updatedAt: lastIso,
    };
    orders.push(order);
    return order;
  }

  for (const def of STORE_DEFS) {
    const owner = merchantProfiles[def.ownerIndex]!;
    const storeId = uuidFrom(stores.length + 1, 'bbbb');
    storeIdByKey[def.key] = storeId;
    const store: Store = {
      id: storeId,
      ownerId: owner.id,
      name: def.name,
      subdomain: def.subdomain,
      status: def.status,
      themeId: themes[def.themeIndex]!.id,
      brandColour: def.brandColour,
      tagline: def.tagline,
      logoUrl: null,
      returnWindowDays: LIMITS.defaultReturnWindowDays,
      createdAt: iso(t0 - def.ageDays * DAY),
      updatedAt: iso(t0 - 3 * DAY),
      extensions: {
        category: def.category,
        bannerUrl: null,
        shipping: { insideDhakaCharge: 60, outsideDhakaCharge: 120, estimatedDaysInsideDhaka: 2, estimatedDaysOutsideDhaka: 4 },
        notificationPreferences: { newOrderEmail: true, newOrderSms: true, lowStockEmail: true, supportTicketEmail: true },
      },
    };
    stores.push(store);
    for (const [method, enabled, hint] of def.configs) {
      paymentConfigs.push({
        id: id('3333'),
        storeId,
        method,
        isEnabled: enabled,
        hasCredentials: method === 'cod' ? false : hint !== null,
        credentialHint: hint,
        environment: 'sandbox',
        validation: method === 'cod' ? 'not_required' : hint ? 'valid' : 'unverified',
        updatedAt: iso(t0 - 20 * DAY),
      });
    }
    const cats = def.categories.map((name, i) => {
      const c: Category = {
        id: uuidFrom(++categoryCounter, 'dddd'),
        storeId,
        name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        parentId: null,
        displayOrder: i,
      };
      categories.push(c);
      return c;
    });
    for (const d of def.products) {
      const pid = uuidFrom(++productCounter, 'eeee');
      const variants: ProductVariant[] = (d.variants ?? []).map(([label, adj, stock]) => ({
        id: uuidFrom(++variantCounter, 'ffff'),
        productId: pid,
        variantLabel: label,
        priceAdjustment: adj,
        stockQuantity: stock,
        status: 'active',
      }));
      const created = iso(t0 - d.ageDays * DAY);
      products.push({
        id: pid,
        storeId,
        name: d.name,
        description: d.description,
        categoryId: cats.find((c) => c.name === d.category)!.id,
        basePrice: d.price,
        productType: d.variants ? 'variant' : 'simple',
        stockQuantity: d.variants ? null : (d.stock ?? 0),
        lowStockThreshold: d.threshold ?? LIMITS.defaultLowStockThreshold,
        status: d.status ?? 'active',
        images: [],
        variants,
        createdAt: created,
        updatedAt: created,
        deletedAt: null,
        extensions: { sku: d.sku, compareAtPrice: COMPARE_AT[d.sku] ?? null },
      });
    }

    const sellable = products.filter((p) => p.storeId === storeId && p.status === 'active');
    for (let n = 0; n < def.orderCount; n++) {
      const ageHours = Math.floor(Math.pow(1 - n / def.orderCount, 1.25) * def.orderDays * 24) + between(1, 9);
      const ageDays = ageHours / 24;
      let status: OrderStatus;
      if (def.status === 'suspended') status = pick<OrderStatus>(['delivered', 'shipped', 'confirmed']);
      else if (ageDays > 6) status = rnd() < 0.1 ? 'cancelled' : 'delivered';
      else if (ageDays > 3) status = pick<OrderStatus>(['delivered', 'delivered', 'out_for_delivery', 'shipped', 'cancelled']);
      else if (ageDays > 1) status = pick<OrderStatus>(['shipped', 'processing', 'confirmed', 'out_for_delivery']);
      else status = pick<OrderStatus>(['pending', 'pending', 'confirmed', 'processing']);
      const chosen = new Set<string>();
      const lines: OrderSpec['items'] = [];
      for (let k = 0; k < between(1, 3); k++) {
        const p = pick(sellable);
        const v = p.productType === 'variant' ? pick(p.variants) : null;
        const key = `${p.id}:${v?.id ?? ''}`;
        if (chosen.has(key)) continue;
        chosen.add(key);
        lines.push({ product: p, variant: v, qty: between(1, def.category === 'groceries' ? 3 : 1) });
      }
      buildOrder({ store, person: pick(people.filter((p) => p !== FAHIM)), method: pick(def.methods), status, createdAt: t0 - ageHours * HOUR, items: lines });
    }

    const v: Record<string, number> = {};
    const scale = def.key === 'gb' ? 1 : def.status === 'published' ? 0.6 : 0.1;
    for (let d = 0; d < 120; d++) {
      v[dayKey(new Date(t0 - d * DAY))] = Math.round((between(28, 70) + Math.max(0, 40 - Math.floor(d / 3))) * scale);
    }
    visitors[storeId] = v;
  }

  const gb = stores.find((s) => s.subdomain === 'greenbasket')!;
  const fp = stores.find((s) => s.subdomain === 'fashionpoint')!;
  const tw = stores.find((s) => s.subdomain === 'techworld')!;
  const prod = (storeId: string, name: string) => products.find((p) => p.storeId === storeId && p.name === name)!;

  /* ------------------ Fahim's orders (customer demo) ------------------ */

  const fA = buildOrder({
    store: gb,
    person: FAHIM,
    method: 'bkash',
    status: 'delivered',
    createdAt: t0 - 3 * DAY,
    items: [
      { product: prod(gb.id, 'Red Apple'), variant: null, qty: 1 },
      { product: prod(gb.id, 'Banana (Sagor)'), variant: null, qty: 2 },
    ],
  });
  const fB = buildOrder({
    store: gb,
    person: FAHIM,
    method: 'cod',
    status: 'delivered',
    createdAt: t0 - 5 * DAY,
    paymentStatus: 'cod_collected',
    items: [{ product: prod(gb.id, 'Farm Eggs'), variant: prod(gb.id, 'Farm Eggs').variants[1]!, qty: 1 }],
  });
  const fC = buildOrder({
    store: tw,
    person: FAHIM,
    method: 'sslcommerz',
    status: 'out_for_delivery',
    createdAt: t0 - 2 * DAY,
    items: [{ product: prod(tw.id, 'Wireless Earbuds'), variant: null, qty: 1 }],
  });
  const fD = buildOrder({
    store: fp,
    person: FAHIM,
    method: 'nagad',
    status: 'delivered',
    createdAt: t0 - 24 * DAY,
    items: [{ product: prod(fp.id, 'Running Shoes'), variant: prod(fp.id, 'Running Shoes').variants[1]!, qty: 1 }],
  });
  const fE = buildOrder({
    store: gb,
    person: FAHIM,
    method: 'rocket',
    status: 'pending',
    createdAt: t0 - 40 * 60_000,
    paymentStatus: 'pending_verification',
    items: [{ product: prod(gb.id, 'Masoor Dal'), variant: null, qty: 2 }],
  });
  void fE;
  const twStalled = buildOrder({
    store: tw,
    person: people[0],
    method: 'bkash',
    status: 'delivered',
    createdAt: t0 - 16 * DAY,
    items: [{ product: prod(tw.id, 'Bluetooth Speaker'), variant: null, qty: 1 }],
  });
  const gbOld = orders.find((o) => o.storeId === gb.id && o.status === 'delivered' && o.paymentMethod !== 'cod' && o.customerId && o.customerId !== fahimId)!;
  const deliveredAt = (o: Order) => events.find((e) => e.orderId === o.id && e.eventType === 'delivered')?.createdAt ?? o.updatedAt;
  const storeName = (sid: string) => stores.find((s) => s.id === sid)!.name;

  // Make sure at least one delivered COD order still awaits collection (DM-05 demo).
  const codDelivered = [...orders]
    .reverse()
    .find((o) => o.storeId === gb.id && o.paymentMethod === 'cod' && o.status === 'delivered' && o.customerId !== fahimId);
  if (codDelivered && codDelivered.paymentStatus === 'cod_collected') {
    codDelivered.paymentStatus = 'cod_pending';
    const idx = events.findIndex((e) => e.orderId === codDelivered.id && e.eventType === 'cod_collected');
    if (idx >= 0) events.splice(idx, 1);
    const att = payments.find((p) => p.orderId === codDelivered.id);
    if (att) {
      att.status = 'pending';
      att.verifiedAt = null;
    }
  }

  /* --------------------------- Returns/refunds ------------------------- */

  let retSeq = 300;
  const returns: ReturnRequest[] = [];
  const mkReturn = (o: Order, over: Partial<ReturnRequest>): ReturnRequest => {
    const r: ReturnRequest = {
      id: id('4444'),
      returnNumber: formatPublicId('RET', new Date(Date.parse(over.createdAt ?? deliveredAt(o))), ++retSeq),
      orderId: o.id,
      orderNumber: o.orderNumber,
      storeId: o.storeId,
      storeName: storeName(o.storeId),
      customerId: o.customerId!,
      customerName: o.customerName,
      reason: 'damaged',
      conditionDescription: 'Item arrived damaged; packaging was torn.',
      evidenceStoragePath: null,
      evidenceUrl: null,
      status: 'requested',
      merchantResponse: null,
      returnMethod: null,
      refundAmountRequested: o.subtotal,
      createdAt: deliveredAt(o),
      decidedAt: null,
      receivedAt: null,
      closedAt: null,
      dispute: { status: 'none', escalatedAt: null, decision: null, adminNote: null },
      ...over,
    };
    returns.push(r);
    return r;
  };
  const gbOldDelivered = Date.parse(deliveredAt(gbOld));
  const rClosed = mkReturn(gbOld, {
    status: 'closed',
    reason: 'damaged',
    merchantResponse: 'Approved — sorry about the damage.',
    returnMethod: 'merchant_coordinated',
    createdAt: iso(gbOldDelivered + 3 * HOUR),
    decidedAt: iso(gbOldDelivered + 6 * HOUR),
    receivedAt: iso(gbOldDelivered + 30 * HOUR),
    closedAt: iso(gbOldDelivered + 50 * HOUR),
  });
  gbOld.paymentStatus = 'refunded';
  const rFahimB = mkReturn(fB, {
    status: 'requested',
    reason: 'not_as_described',
    conditionDescription: 'Several eggs were cracked and the pack was smaller than listed.',
    createdAt: past(5 * HOUR),
  });
  const rFahimD = mkReturn(fD, {
    status: 'rejected',
    reason: 'not_as_described',
    conditionDescription: 'Size 41 fits like 40; the colour is different from the photo.',
    merchantResponse: 'Shoes have been worn outdoors, so we cannot accept the return.',
    createdAt: iso(Date.parse(deliveredAt(fD)) + 2 * DAY),
    decidedAt: iso(Date.parse(deliveredAt(fD)) + 3 * DAY),
    dispute: { status: 'open', escalatedAt: iso(Date.parse(deliveredAt(fD)) + 4 * DAY), decision: null, adminNote: null },
  });
  const rStalled = mkReturn(twStalled, {
    status: 'received',
    reason: 'damaged',
    conditionDescription: 'Speaker does not charge.',
    merchantResponse: 'Approved.',
    returnMethod: 'customer_drop_off',
    createdAt: past(12 * DAY),
    decidedAt: past(11 * DAY),
    receivedAt: past(9 * DAY),
  });
  void rFahimB;

  const refunds: Refund[] = [
    {
      id: id('4545'),
      returnId: rClosed.id,
      returnNumber: rClosed.returnNumber,
      orderId: gbOld.id,
      orderNumber: gbOld.orderNumber,
      storeId: gb.id,
      storeName: gb.name,
      customerName: gbOld.customerName,
      amount: gbOld.subtotal,
      method: 'original_method',
      status: 'completed',
      gatewayReference: 'BK-RF-77120',
      confirmationReference: 'BK-RF-77120',
      initiatorId: gb.ownerId,
      initiatorName: 'Nusrat Jahan',
      processedAt: rClosed.closedAt,
      createdAt: rClosed.receivedAt!,
      events: [
        { status: 'initiated', actorName: 'Nusrat Jahan', note: null, createdAt: rClosed.receivedAt! },
        { status: 'completed', actorName: 'Nusrat Jahan', note: 'bKash refund confirmed by provider.', createdAt: rClosed.closedAt! },
      ],
    },
    {
      id: id('4545'),
      returnId: rStalled.id,
      returnNumber: rStalled.returnNumber,
      orderId: twStalled.id,
      orderNumber: twStalled.orderNumber,
      storeId: tw.id,
      storeName: tw.name,
      customerName: twStalled.customerName,
      amount: twStalled.subtotal,
      method: 'bkash',
      status: 'processing',
      gatewayReference: null,
      confirmationReference: null,
      initiatorId: tw.ownerId,
      initiatorName: 'Sarah Khan',
      processedAt: null,
      createdAt: past(8 * DAY),
      events: [
        { status: 'initiated', actorName: 'Sarah Khan', note: null, createdAt: past(8 * DAY) },
        { status: 'processing', actorName: 'Sarah Khan', note: 'Sent to bKash refund API; awaiting confirmation.', createdAt: past(8 * DAY - HOUR) },
      ],
    },
  ];

  /* ------------------------------ Support ----------------------------- */

  const tickets: SupportTicket[] = [];
  const messages: TicketMessage[] = [];
  const ticketAudit: TicketAuditEntry[] = [];
  let ticketSeq = 410;
  interface TicketDef {
    person: Person;
    store: Store | null;
    order: Order | null;
    cat: SupportTicket['category'];
    subject: string;
    desc: string;
    priority: SupportTicket['priority'];
    status: SupportTicket['status'];
    ageH: number;
    replies: [by: 'merchant' | 'customer' | 'admin', body: string][];
    escalated?: boolean;
  }
  const personOrder = (p: Person, s: Store) => orders.find((o) => o.storeId === s.id && o.customerName === p[0]) ?? null;
  const ticketDefs: TicketDef[] = [
    {
      person: people[1],
      store: gb,
      order: personOrder(people[1], gb),
      cat: 'delivery_issue',
      subject: 'Order not delivered yet',
      desc: 'My order was shipped three days ago but I have not received it. Can you check with the courier?',
      priority: 'urgent',
      status: 'open',
      ageH: 20,
      replies: [],
    },
    {
      person: people[2],
      store: gb,
      order: personOrder(people[2], gb),
      cat: 'payment_issue',
      subject: 'bKash payment deducted twice',
      desc: 'I see two deductions in my bKash statement for one order. Please check.',
      priority: 'urgent',
      status: 'in_progress',
      ageH: 30,
      replies: [['merchant', 'Thank you for reporting this. We are checking the transaction records and will update you shortly.']],
    },
    {
      person: people[3],
      store: gb,
      order: personOrder(people[3], gb),
      cat: 'order_issue',
      subject: 'Wrong item in my order',
      desc: 'I ordered 1 kg Chinigura rice but received 5 kg. Happy to keep it if I can pay the difference.',
      priority: 'normal',
      status: 'waiting_for_customer',
      ageH: 52,
      replies: [
        ['merchant', 'Sorry about the mix-up! Would you like to keep the 5 kg pack and pay the difference on your next order, or should we exchange it?'],
      ],
    },
    {
      person: people[0],
      store: gb,
      order: personOrder(people[0], gb),
      cat: 'return_refund',
      subject: 'Return for damaged eggs',
      desc: 'Three eggs in the 12-pack were broken on arrival.',
      priority: 'normal',
      status: 'resolved',
      ageH: 120,
      replies: [
        ['merchant', 'We have arranged a replacement for the broken eggs.'],
        ['customer', 'Received, thank you!'],
      ],
    },
    {
      person: people[6],
      store: gb,
      order: null,
      cat: 'other',
      subject: 'Do you deliver to Savar?',
      desc: 'I would like to order regularly. Do you deliver to Savar and what is the charge?',
      priority: 'normal',
      status: 'closed',
      ageH: 260,
      replies: [['merchant', 'Yes, we deliver to Savar. The outside-Dhaka charge of ৳120 applies.']],
    },
    {
      person: FAHIM,
      store: tw,
      order: fC,
      cat: 'delivery_issue',
      subject: 'Earbuds delivery time',
      desc: 'The order says out for delivery but the courier has not called. When will it arrive?',
      priority: 'normal',
      status: 'open',
      ageH: 80,
      replies: [],
    },
    {
      person: FAHIM,
      store: null,
      order: null,
      cat: 'account_issue',
      subject: 'Cannot change my phone number',
      desc: 'I changed my mobile number but the profile still shows the old one after saving.',
      priority: 'normal',
      status: 'in_progress',
      ageH: 26,
      replies: [['admin', 'Thanks Fahim — we are looking into the profile update issue and will get back to you.']],
    },
    {
      person: people[3],
      store: fp,
      order: personOrder(people[3], fp),
      cat: 'order_issue',
      subject: 'Received a different colour',
      desc: 'I ordered a blue kurti but received a green one. The shop has not replied for days.',
      priority: 'urgent',
      status: 'open',
      ageH: 100,
      replies: [],
      escalated: true,
    },
  ];
  for (const d of ticketDefs) {
    const tid = id('2222');
    const created = t0 - d.ageH * HOUR;
    let last = created;
    let firstMerchant: string | null = null;
    const owner = d.store ? ownerOf(d.store) : null;
    d.replies.forEach(([by, body], k) => {
      last = created + (k + 1) * between(2, 10) * HOUR;
      const sender =
        by === 'merchant'
          ? { id: owner!.id, name: `${owner!.fullName} (${d.store!.name})`, role: 'merchant' as const }
          : by === 'admin'
            ? { id: adminA.id, name: 'BazarHQ Support', role: 'super_admin' as const }
            : { id: customerId(d.person), name: d.person[0], role: 'customer' as const };
      const m: TicketMessage = {
        id: id('2223'),
        ticketId: tid,
        senderId: sender.id,
        senderName: sender.name,
        senderRole: sender.role,
        body,
        attachmentName: null,
        attachmentStoragePath: null,
        createdAt: iso(last),
      };
      if (by === 'merchant' && !firstMerchant) firstMerchant = m.createdAt;
      messages.push(m);
    });
    const escalationAt = d.escalated ? iso(created + 73 * HOUR) : null;
    const t: SupportTicket = {
      id: tid,
      queue: d.store ? 'store' : 'platform',
      storeName: d.store?.name ?? null,
      ticketNumber: formatPublicId('TKT', new Date(created), ++ticketSeq),
      customerId: customerId(d.person),
      customerName: d.person[0],
      storeId: d.store?.id ?? null,
      orderId: d.order?.id ?? null,
      orderNumber: d.order?.orderNumber ?? null,
      category: d.cat,
      subject: d.subject,
      description: d.desc,
      priority: d.priority,
      status: d.status,
      assignedTo: d.escalated || !d.store ? adminA.id : owner!.id,
      resolutionNote: d.status === 'resolved' || d.status === 'closed' ? 'Issue addressed with the customer.' : null,
      firstMerchantResponseAt: firstMerchant,
      escalationAt,
      closedAt: d.status === 'closed' ? iso(last + 2 * HOUR) : null,
      createdAt: iso(created),
      updatedAt: iso(Math.max(last, escalationAt ? Date.parse(escalationAt) : 0)),
      dispute: { status: d.escalated ? 'open' : 'none', decision: null, adminNote: null },
    };
    tickets.push(t);
    ticketAudit.push({
      id: id('2224'),
      ticketId: tid,
      actorName: d.person[0],
      eventType: 'created',
      previousValue: null,
      newValue: 'open',
      createdAt: t.createdAt,
    });
    if (d.status !== 'open')
      ticketAudit.push({
        id: id('2224'),
        ticketId: tid,
        actorName: owner?.fullName ?? 'BazarHQ Support',
        eventType: 'status_changed',
        previousValue: 'open',
        newValue: d.status,
        createdAt: iso(last),
      });
    if (escalationAt)
      ticketAudit.push({
        id: id('2224'),
        ticketId: tid,
        actorName: d.person[0],
        eventType: 'escalated',
        previousValue: null,
        newValue: 'super_admin',
        createdAt: escalationAt,
      });
  }

  /* ---------------------------- Notifications ------------------------- */

  const notifications: Notification[] = [];
  const note = (userId: string, n: Omit<Notification, 'id' | 'userId'>) => notifications.push({ id: id('1212'), userId, ...n });
  for (const s of [gb, fp, tw]) {
    const latest = orders.filter((o) => o.storeId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    latest.slice(0, 4).forEach((o, i) =>
      note(s.ownerId, {
        type: 'new_order',
        title: 'New order received',
        body: `${o.orderNumber} from ${o.customerName} • ৳${o.totalAmount}`,
        isRead: i > 1,
        referenceType: 'order',
        referenceId: o.id,
        createdAt: o.createdAt,
      }),
    );
  }
  note(gb.ownerId, {
    type: 'low_stock',
    title: 'Product low in stock',
    body: 'Onion (Local) has 8 units left (threshold 10).',
    isRead: false,
    referenceType: 'product',
    referenceId: prod(gb.id, 'Onion (Local)').id,
    createdAt: past(2 * HOUR),
  });
  note(gb.ownerId, {
    type: 'return',
    title: 'Return requested',
    body: `${rFahimB.returnNumber} — Not as described`,
    isRead: false,
    referenceType: 'return',
    referenceId: rFahimB.id,
    createdAt: rFahimB.createdAt,
  });
  note(gb.ownerId, {
    type: 'payment',
    title: 'Payment needs manual review',
    body: `Rocket payment for ${fE.orderNumber} is awaiting verification.`,
    isRead: false,
    referenceType: 'order',
    referenceId: fE.id,
    createdAt: past(30 * 60_000),
  });
  note(gb.ownerId, {
    type: 'announcement',
    title: 'Platform maintenance',
    body: 'BazarHQ will run scheduled maintenance on Friday 2:00–3:00 AM. Storefronts stay online.',
    isRead: true,
    referenceType: 'announcement',
    referenceId: null,
    createdAt: past(4 * DAY),
  });
  note(fahimId, {
    type: 'order_status',
    title: 'Out for delivery',
    body: `${fC.orderNumber} from Tech World is out for delivery.`,
    isRead: false,
    referenceType: 'order',
    referenceId: fC.id,
    createdAt: past(5 * HOUR),
  });
  note(fahimId, {
    type: 'return',
    title: 'Return rejected',
    body: `${rFahimD.returnNumber}: ${rFahimD.merchantResponse}`,
    isRead: true,
    referenceType: 'return',
    referenceId: rFahimD.id,
    createdAt: rFahimD.decidedAt!,
  });
  note(fahimId, {
    type: 'order_status',
    title: 'Order delivered',
    body: `${fA.orderNumber} from Green Basket was delivered.`,
    isRead: true,
    referenceType: 'order',
    referenceId: fA.id,
    createdAt: deliveredAt(fA),
  });
  for (const a of [adminA, adminB]) {
    note(a.id, {
      type: 'dispute',
      title: 'Return dispute escalated',
      body: `${rFahimD.returnNumber} (Fashion Point) was escalated by the customer.`,
      isRead: false,
      referenceType: 'return',
      referenceId: rFahimD.id,
      createdAt: rFahimD.dispute.escalatedAt!,
    });
    note(a.id, {
      type: 'refund',
      title: 'Refund stalled',
      body: `Refund for ${twStalled.orderNumber} (Tech World) has been processing for 8 days.`,
      isRead: false,
      referenceType: 'refund',
      referenceId: refunds[1]!.id,
      createdAt: past(DAY),
    });
  }
  notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /* ---------------------------- Addresses ----------------------------- */

  const addresses: Address[] = [
    {
      id: id('ad01'),
      customerId: fahimId,
      label: 'Home',
      recipientName: 'Fahim Ahmed',
      phone: '01511000005',
      address: 'House 12, Road 5, Dhanmondi',
      district: 'Dhaka',
      postalCode: '1205',
      isDefault: true,
      createdAt: past(60 * DAY),
      updatedAt: past(60 * DAY),
    },
    {
      id: id('ad01'),
      customerId: fahimId,
      label: 'Office',
      recipientName: 'Fahim Ahmed',
      phone: '01511000005',
      address: 'Level 4, BRAC Tower, Mohakhali',
      district: 'Dhaka',
      postalCode: '1212',
      isDefault: false,
      createdAt: past(40 * DAY),
      updatedAt: past(40 * DAY),
    },
  ];

  /* ------------------------- Platform administration ------------------ */

  const announcements: Announcement[] = [
    {
      id: id('an01'),
      title: 'Platform maintenance on Friday',
      body: 'BazarHQ will run scheduled maintenance on Friday 2:00–3:00 AM. Storefronts stay online; the merchant dashboard may be briefly unavailable.',
      audience: 'merchants',
      status: 'sent',
      scheduledAt: null,
      sentAt: past(4 * DAY),
      sentBy: adminA.id,
      sentByName: adminA.fullName,
      recipientCount: 6,
      createdAt: past(5 * DAY),
    },
    {
      id: id('an01'),
      title: 'New Privacy Policy coming soon',
      body: 'We are updating our Privacy Policy to explain how order and delivery data is retained. The new version will be published after review.',
      audience: 'all',
      status: 'scheduled',
      scheduledAt: iso(t0 + 3 * DAY),
      sentAt: null,
      sentBy: null,
      sentByName: null,
      recipientCount: null,
      createdAt: past(DAY),
    },
    {
      id: id('an01'),
      title: 'Eid delivery schedule',
      body: 'Draft: reminders for merchants about courier holidays during Eid. Add exact dates before sending.',
      audience: 'merchants',
      status: 'draft',
      scheduledAt: null,
      sentAt: null,
      sentBy: null,
      sentByName: null,
      recipientCount: null,
      createdAt: past(6 * HOUR),
    },
  ];

  const lorem = (topic: string) =>
    `${topic}\n\n1. Scope. These terms apply to merchants and customers using BazarHQ storefronts at *.bazarhq.com.\n2. Accounts. Keep your login details secure. Merchants are responsible for their store content and fulfilment.\n3. Payments. Payments are processed by bKash, Nagad, Rocket, SSLCommerz or collected as cash on delivery. BazarHQ never stores card numbers.\n4. Returns. Each store sets a return window; the default is seven calendar days from delivery.\n5. Data retention. Transaction records are retained for seven years as required by law.`;
  const policies: Policy[] = [
    {
      id: id('po01'),
      type: 'tos',
      version: '1.0',
      content: lorem('BazarHQ Terms of Service'),
      effectiveDate: dayKey(new Date(t0 - 200 * DAY)),
      submittedBy: adminA.id,
      submittedByName: adminA.fullName,
      approvedBy: adminB.id,
      approvedByName: adminB.fullName,
      approvedAt: past(201 * DAY),
      publishedAt: past(200 * DAY),
      status: 'published',
      createdAt: past(205 * DAY),
    },
    {
      id: id('po01'),
      type: 'privacy',
      version: '1.0',
      content: lorem('BazarHQ Privacy Policy'),
      effectiveDate: dayKey(new Date(t0 - 200 * DAY)),
      submittedBy: adminB.id,
      submittedByName: adminB.fullName,
      approvedBy: adminA.id,
      approvedByName: adminA.fullName,
      approvedAt: past(201 * DAY),
      publishedAt: past(200 * DAY),
      status: 'published',
      createdAt: past(205 * DAY),
    },
    {
      id: id('po01'),
      type: 'tos',
      version: '1.1',
      content: lorem('BazarHQ Terms of Service — v1.1 adds return-dispute escalation and support-ticket response times.'),
      effectiveDate: dayKey(new Date(t0 + 14 * DAY)),
      submittedBy: adminB.id,
      submittedByName: adminB.fullName,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      publishedAt: null,
      status: 'pending_approval',
      createdAt: past(20 * HOUR),
    },
  ];

  const kh = stores.find((s) => s.subdomain === 'kidsheaven')!;
  const auditLogs: AuditLog[] = [
    {
      id: id('au01'),
      actorId: adminA.id,
      actorName: adminA.fullName,
      action: 'merchant.suspended',
      resourceType: 'merchant',
      resourceId: kh.ownerId,
      metadata: { store: kh.name, reason: 'Repeated customer complaints about undelivered orders' },
      ipAddress: '103.112.10.5',
      createdAt: past(9 * DAY),
    },
    {
      id: id('au01'),
      actorId: adminA.id,
      actorName: adminA.fullName,
      action: 'theme.deactivated',
      resourceType: 'theme',
      resourceId: themes[6]!.id,
      metadata: { theme: 'Retired Classic' },
      ipAddress: '103.112.10.5',
      createdAt: past(30 * DAY),
    },
    {
      id: id('au01'),
      actorId: adminA.id,
      actorName: adminA.fullName,
      action: 'announcement.sent',
      resourceType: 'announcement',
      resourceId: announcements[0]!.id,
      metadata: { recipients: 6 },
      ipAddress: '103.112.10.5',
      createdAt: announcements[0]!.sentAt!,
    },
    {
      id: id('au01'),
      actorId: adminB.id,
      actorName: adminB.fullName,
      action: 'policy.submitted',
      resourceType: 'policy',
      resourceId: policies[2]!.id,
      metadata: { type: 'tos', version: '1.1' },
      ipAddress: '103.112.10.6',
      createdAt: policies[2]!.createdAt,
    },
    {
      id: id('au01'),
      actorId: adminA.id,
      actorName: adminA.fullName,
      action: 'admin.login',
      resourceType: 'session',
      resourceId: null,
      metadata: { mfa: 'totp' },
      ipAddress: '103.112.10.5',
      createdAt: past(26 * HOUR),
    },
    {
      id: id('au01'),
      actorId: null,
      actorName: 'System',
      action: 'payment_transaction.status_changed',
      resourceType: 'payment_transaction',
      resourceId: payments.find((p) => p.orderId === fC.id)!.id,
      metadata: { previous_status: 'pending', new_status: 'paid', source: 'sslcommerz_webhook' },
      ipAddress: null,
      createdAt: past(2 * DAY - 3 * 60_000),
    },
  ];
  auditLogs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const health: HealthComponent[] = [
    { key: 'web', name: 'Web application (Vercel)', status: 'operational', responseMs: 182, errorRatePct: 0.1, lastCheckedAt: past(60_000), note: null },
    { key: 'database', name: 'PostgreSQL (Supabase)', status: 'operational', responseMs: 24, errorRatePct: 0, lastCheckedAt: past(60_000), note: null },
    { key: 'auth', name: 'Supabase Auth', status: 'operational', responseMs: 96, errorRatePct: 0.2, lastCheckedAt: past(60_000), note: null },
    { key: 'storage', name: 'Supabase Storage', status: 'operational', responseMs: 140, errorRatePct: 0, lastCheckedAt: past(60_000), note: null },
    { key: 'edge_functions', name: 'Edge Functions', status: 'operational', responseMs: 210, errorRatePct: 0.4, lastCheckedAt: past(60_000), note: null },
    { key: 'email', name: 'Email (SMTP provider)', status: 'operational', responseMs: 640, errorRatePct: 0.3, lastCheckedAt: past(60_000), note: null },
    {
      key: 'sms',
      name: 'SMS (SSL Wireless)',
      status: 'degraded',
      responseMs: 2300,
      errorRatePct: 6.5,
      lastCheckedAt: past(60_000),
      note: 'Primary SMS provider slow; secondary provider and email fallback active.',
    },
    {
      key: 'push',
      name: 'Push (Firebase Cloud Messaging)',
      status: 'operational',
      responseMs: 320,
      errorRatePct: 0.5,
      lastCheckedAt: past(60_000),
      note: null,
    },
  ];

  /* ------------------------------ Sessions ---------------------------- */

  const merchantId = merchantProfiles[0]!.id;
  const sessions: Record<string, ActiveSession[]> = {
    [merchantId]: [
      { id: id('1313'), device: 'Chrome on Windows', platform: 'web', location: 'Dhaka, BD', lastActiveAt: iso(t0), current: true },
      { id: id('1313'), device: 'BazarHQ app on Android', platform: 'android', location: 'Dhaka, BD', lastActiveAt: past(5 * HOUR), current: false },
      { id: id('1313'), device: 'Firefox on Ubuntu', platform: 'web', location: 'Rangpur, BD', lastActiveAt: past(4 * DAY), current: false },
    ],
  };

  return {
    version: MOCK_DB_VERSION,
    seededAt: iso(t0),
    currentUserId: null,
    users,
    stores,
    themes,
    categories,
    products,
    movements: movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    orders,
    events,
    payments,
    returns,
    refunds,
    paymentConfigs,
    tickets,
    messages,
    ticketAudit,
    notifications,
    addresses,
    announcements,
    policies,
    auditLogs,
    health,
    admin: { network: 'allowlisted', ip: '103.112.10.5', pendingMfaUserId: null, mfaVerified: false, lastActivityAt: null },
    sessions,
    takenSubdomains: ['freshmart', 'beautyhub', 'greenbasket1', 'bookshelf'],
    idempotency: {},
    visitors,
    seq: { order: orderSeq, ticket: ticketSeq, ret: retSeq, id: idCounter + 1000 },
    pendingTotpSecret: null,
    verificationLinkClicked: {},
    resetTokens: {},
    trackAttempts: [],
    sslSessions: {},
    deviceTokens: [],
  };
}
