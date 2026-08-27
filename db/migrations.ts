// Versioned D1 schema migrations, applied idempotently at runtime (see runMigrations
// below) since the Workers runtime has no filesystem access to read generated SQL
// files and this deployment has no wrangler.toml to drive `wrangler d1 migrations`.
// Each migration's statements run once, tracked in `_schema_migrations`.

import {
  SEED_ADDON_GROUPS,
  SEED_ADDONS,
  SEED_CATEGORIES,
  SEED_COUPONS,
  SEED_FOOD_ITEMS,
  SEED_OFFERS,
  SEED_RESTAURANTS,
  SEED_VARIANTS,
} from "./catalogSeed";

export const ROLES: { id: string; label: string; description: string }[] = [
  { id: "CUSTOMER", label: "Customer", description: "Orders food, groceries, essentials and books rides or parcels." },
  { id: "VENDOR_OWNER", label: "Vendor Owner", description: "Owns and fully manages a restaurant, grocery, vegetable or mart store." },
  { id: "VENDOR_MANAGER", label: "Vendor Manager", description: "Manages day-to-day store operations on behalf of a vendor owner." },
  { id: "DELIVERY_PARTNER", label: "Delivery Partner", description: "Delivers orders, parcels and bike-taxi rides." },
  { id: "SUPER_ADMIN", label: "Super Admin", description: "Full platform access across every domain." },
  { id: "OPERATIONS_ADMIN", label: "Operations Admin", description: "Runs live operations: orders, rides, parcels, vendors and partners." },
  { id: "FINANCE_ADMIN", label: "Finance Admin", description: "Manages pricing, commissions, settlements and refunds." },
  { id: "SUPPORT_ADMIN", label: "Support Admin", description: "Handles customer, vendor and partner support tickets." },
  { id: "MARKETING_ADMIN", label: "Marketing Admin", description: "Manages offers, coupons, banners and campaigns." },
  { id: "CITY_ADMIN", label: "City Admin", description: "Manages service areas, vendors and partners for a specific city." },
];

export const PERMISSIONS: { id: string; description: string }[] = [
  { id: "product.manage_own", description: "Create and update products for a vendor's own store." },
  { id: "order.manage_own_vendor", description: "Accept, prepare and hand off a vendor's own orders." },
  { id: "order.manage_own_partner", description: "Accept and progress delivery, ride and parcel jobs." },
  { id: "order.manage_all", description: "View and transition any order across the platform." },
  { id: "order.cancel_any", description: "Cancel any order, ride or parcel." },
  { id: "pricing.manage", description: "Configure bike-taxi and parcel pricing rules." },
  { id: "service.manage", description: "Enable or disable services for an area." },
  { id: "user.manage", description: "Change user roles and account status." },
  { id: "vendor.manage", description: "Approve, suspend or configure vendors." },
  { id: "partner.manage", description: "Approve, suspend or configure delivery partners." },
  { id: "settlement.manage", description: "Manage vendor and delivery partner settlements." },
  { id: "support.manage", description: "Manage support tickets and disputes." },
  { id: "audit.view", description: "View the platform audit log." },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CUSTOMER: [],
  VENDOR_OWNER: ["product.manage_own", "order.manage_own_vendor"],
  VENDOR_MANAGER: ["product.manage_own", "order.manage_own_vendor"],
  DELIVERY_PARTNER: ["order.manage_own_partner"],
  SUPER_ADMIN: PERMISSIONS.map((p) => p.id),
  OPERATIONS_ADMIN: ["order.manage_all", "order.cancel_any", "service.manage", "vendor.manage", "partner.manage", "audit.view"],
  FINANCE_ADMIN: ["pricing.manage", "settlement.manage", "audit.view"],
  SUPPORT_ADMIN: ["support.manage", "order.manage_all", "audit.view"],
  MARKETING_ADMIN: ["audit.view"],
  CITY_ADMIN: ["service.manage", "vendor.manage", "partner.manage", "audit.view"],
};

const SERVICES = ["Food", "Grocery", "Vegetables", "Mart", "Bike Taxi", "Parcel"];

type Migration = { id: number; name: string; statements: string[] };

const migrations: Migration[] = [
  {
    id: 1,
    name: "baseline",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, platform_user_id TEXT UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS service_config (service TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, service TEXT NOT NULL, vendor TEXT NOT NULL, vendor_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL, rating REAL NOT NULL DEFAULT 0, eta TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, service TEXT NOT NULL, vendor TEXT NOT NULL, vendor_id TEXT NOT NULL, customer TEXT NOT NULL, customer_id TEXT NOT NULL, partner TEXT, partner_id TEXT, status TEXT NOT NULL, total REAL NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS pricing_rules (service TEXT PRIMARY KEY, base_fare REAL NOT NULL, per_km REAL NOT NULL, platform_fee REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_products_service ON products(service)`,
      `CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_vendor_status ON orders(vendor_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_partner_status ON orders(partner_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_service_status ON orders(service, status)`,
      ...SERVICES.map(
        (service) =>
          `INSERT INTO service_config(service, enabled) SELECT '${service}', 1 WHERE NOT EXISTS (SELECT 1 FROM service_config WHERE service='${service}')`,
      ),
    ],
  },
  {
    id: 2,
    name: "standalone_auth_and_rbac",
    statements: [
      // Rebuild `users` rather than ALTER: SQLite refuses to DROP COLUMN a
      // column that carries a UNIQUE constraint (platform_user_id did), so the
      // old ChatGPT-sign-in-only identity column is dropped via a table swap
      // instead. This platform now issues its own credentials rather than
      // trusting upstream SIWC headers.
      `CREATE TABLE users_new (id TEXT PRIMARY KEY, email TEXT NOT NULL, phone TEXT, password_hash TEXT, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, email_verified_at TEXT, phone_verified_at TEXT, last_login_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `INSERT INTO users_new (id,email,name,role,status,created_at,updated_at) SELECT id,email,name,role,status,created_at,updated_at FROM users`,
      `DROP TABLE users`,
      `ALTER TABLE users_new RENAME TO users`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, ip TEXT, user_agent TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS otp_codes (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_otp_identifier_purpose ON otp_codes(identifier, purpose, created_at)`,
      `CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS permissions (id TEXT PRIMARY KEY, description TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_permissions (role_id TEXT NOT NULL, permission_id TEXT NOT NULL, PRIMARY KEY (role_id, permission_id))`,
      ...ROLES.map(
        (role) =>
          `INSERT INTO roles(id, label, description) VALUES ('${role.id}', '${escape(role.label)}', '${escape(role.description)}') ON CONFLICT(id) DO UPDATE SET label=excluded.label, description=excluded.description`,
      ),
      ...PERMISSIONS.map(
        (perm) =>
          `INSERT INTO permissions(id, description) VALUES ('${perm.id}', '${escape(perm.description)}') ON CONFLICT(id) DO UPDATE SET description=excluded.description`,
      ),
      ...Object.entries(ROLE_PERMISSIONS).flatMap(([roleId, permissionIds]) =>
        permissionIds.map(
          (permissionId) =>
            `INSERT INTO role_permissions(role_id, permission_id) VALUES ('${roleId}', '${permissionId}') ON CONFLICT DO NOTHING`,
        ),
      ),
    ],
  },
  {
    id: 3,
    name: "food_catalog",
    statements: [
      `CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_url TEXT,
        rating REAL NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        cuisines TEXT NOT NULL DEFAULT '',
        delivery_time_min INTEGER NOT NULL DEFAULT 30,
        delivery_time_max INTEGER NOT NULL DEFAULT 45,
        distance_km REAL NOT NULL DEFAULT 0,
        price_for_one REAL,
        price_for_two REAL,
        veg_only INTEGER NOT NULL DEFAULT 0,
        is_open INTEGER NOT NULL DEFAULT 1,
        area TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL DEFAULT 0,
        longitude REAL NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS restaurant_offers (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS menu_categories (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS food_items (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        price REAL NOT NULL,
        veg INTEGER NOT NULL DEFAULT 1,
        rating REAL NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        bestseller INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS food_item_variants (
        id TEXT PRIMARY KEY,
        food_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS food_item_addon_groups (
        id TEXT PRIMARY KEY,
        food_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        multi_select INTEGER NOT NULL DEFAULT 1,
        max_select INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS food_item_addons (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS coupons (
        code TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        min_order REAL NOT NULL DEFAULT 0,
        max_discount REAL,
        active INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE INDEX IF NOT EXISTS idx_offers_restaurant ON restaurant_offers(restaurant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON menu_categories(restaurant_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_food_items_restaurant ON food_items(restaurant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_food_items_category ON food_items(category_id)`,
      `CREATE INDEX IF NOT EXISTS idx_variants_item ON food_item_variants(food_item_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_addon_groups_item ON food_item_addon_groups(food_item_id)`,
      `CREATE INDEX IF NOT EXISTS idx_addons_group ON food_item_addons(group_id)`,

      ...SEED_RESTAURANTS.map((r) =>
        insertRow("restaurants", {
          id: r.id, name: r.name, image_url: r.imageUrl, rating: r.rating, rating_count: r.ratingCount,
          cuisines: r.cuisines, delivery_time_min: r.deliveryTimeMin, delivery_time_max: r.deliveryTimeMax,
          distance_km: r.distanceKm, price_for_one: r.priceForOne, price_for_two: r.priceForTwo,
          veg_only: r.vegOnly, is_open: r.isOpen, area: r.area, latitude: r.latitude, longitude: r.longitude,
        }),
      ),
      ...SEED_OFFERS.map((o) => insertRow("restaurant_offers", { id: o.id, restaurant_id: o.restaurantId, title: o.title, description: o.description })),
      ...SEED_CATEGORIES.map((c) => insertRow("menu_categories", { id: c.id, restaurant_id: c.restaurantId, name: c.name, sort_order: c.sortOrder })),
      ...SEED_FOOD_ITEMS.map((f) =>
        insertRow("food_items", {
          id: f.id, restaurant_id: f.restaurantId, category_id: f.categoryId, name: f.name, description: f.description,
          image_url: f.imageUrl, price: f.price, veg: f.veg, rating: f.rating, rating_count: f.ratingCount,
          bestseller: f.bestseller, available: f.available,
        }),
      ),
      ...SEED_VARIANTS.map((v) => insertRow("food_item_variants", { id: v.id, food_item_id: v.foodItemId, name: v.name, price: v.price, sort_order: v.sortOrder })),
      ...SEED_ADDON_GROUPS.map((g) =>
        insertRow("food_item_addon_groups", { id: g.id, food_item_id: g.foodItemId, name: g.name, required: g.required, multi_select: g.multiSelect, max_select: g.maxSelect }),
      ),
      ...SEED_ADDONS.map((a) => insertRow("food_item_addons", { id: a.id, group_id: a.groupId, name: a.name, price: a.price })),
      ...SEED_COUPONS.map((c) =>
        insertRow("coupons", { code: c.code, title: c.title, description: c.description, type: c.type, value: c.value, min_order: c.minOrder, max_discount: c.maxDiscount, active: c.active }),
      ),
    ],
  },
  {
    id: 4,
    name: "food_orders",
    statements: [
      `CREATE TABLE IF NOT EXISTS food_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        restaurant_id TEXT NOT NULL,
        restaurant_name TEXT NOT NULL,
        restaurant_area TEXT NOT NULL DEFAULT '',
        restaurant_latitude REAL NOT NULL DEFAULT 0,
        restaurant_longitude REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        coupon_code TEXT,
        instructions TEXT NOT NULL DEFAULT '[]',
        item_total REAL NOT NULL,
        restaurant_discount REAL NOT NULL DEFAULT 0,
        coupon_discount REAL NOT NULL DEFAULT 0,
        delivery_fee REAL NOT NULL DEFAULT 0,
        platform_fee REAL NOT NULL DEFAULT 0,
        taxes REAL NOT NULL DEFAULT 0,
        tip REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        delivery_address TEXT NOT NULL,
        delivery_otp TEXT NOT NULL,
        estimated_delivery_minutes INTEGER NOT NULL DEFAULT 30,
        partner_id TEXT,
        partner_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS food_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        food_item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        image_url TEXT,
        veg INTEGER NOT NULL DEFAULT 1,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL,
        variant_id TEXT,
        variant_name TEXT,
        addons TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE TABLE IF NOT EXISTS food_order_status_history (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        actor_id TEXT,
        actor_role TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_food_orders_customer ON food_orders(customer_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_food_orders_restaurant ON food_orders(restaurant_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_food_orders_partner ON food_orders(partner_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_food_orders_status ON food_orders(status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_food_order_items_order ON food_order_items(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_food_order_history_order ON food_order_status_history(order_id, created_at)`,
    ],
  },
  {
    id: 5,
    name: "restaurant_ownership",
    statements: [
      // Vendor scoping needs a real link from a vendor user to their store;
      // comparing a user id against a restaurant id can never match.
      `ALTER TABLE restaurants ADD COLUMN owner_user_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants(owner_user_id)`,
    ],
  },
  {
    // id 6: this migration originally shipped as id 4, colliding with
    // "food_orders". The runner records applied ids, so the duplicate was
    // silently skipped and vendor_offers was never created.
    id: 6,
    name: "vendor_offers",
    statements: [
      `CREATE TABLE IF NOT EXISTS vendor_offers (
        id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        vendor TEXT NOT NULL,
        title TEXT NOT NULL,
        code TEXT NOT NULL,
        discount_percent INTEGER NOT NULL,
        min_order REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_offers_vendor_code ON vendor_offers(vendor_id, code)`,
      `CREATE INDEX IF NOT EXISTS idx_vendor_offers_vendor_active ON vendor_offers(vendor_id, active)`,
      `PRAGMA optimize`,
    ],
  },
];

function escape(value: string): string {
  return value.replaceAll("'", "''");
}

function sqlValue(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${escape(value)}'`;
}

function insertRow(table: string, row: Record<string, string | number | null>): string {
  const columns = Object.keys(row);
  const values = columns.map((c) => sqlValue(row[c]));
  return `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")})`;
}

export async function runMigrations(db: D1Database): Promise<number[]> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS _schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  ).run();
  const applied = new Set(
    (await db.prepare(`SELECT id FROM _schema_migrations`).all<{ id: number }>()).results.map((r) => r.id),
  );
  const pending = migrations.filter((m) => !applied.has(m.id)).sort((a, b) => a.id - b.id);
  for (const migration of pending) {
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      db
        .prepare(`INSERT INTO _schema_migrations(id, name, applied_at) VALUES (?, ?, ?)`)
        .bind(migration.id, migration.name, new Date().toISOString()),
    ]);
  }
  return pending.map((m) => m.id);
}
