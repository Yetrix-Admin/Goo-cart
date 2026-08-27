import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  emailVerifiedAt: text("email_verified_at"),
  phoneVerifiedAt: text("phone_verified_at"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const otpCodes = sqliteTable("otp_codes", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  purpose: text("purpose").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull(),
});

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const serviceConfig = sqliteTable("service_config", {
  service: text("service").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  service: text("service").notNull(),
  vendor: text("vendor").notNull(),
  vendorId: text("vendor_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: real("price").notNull(),
  stock: integer("stock").notNull(),
  rating: real("rating").notNull(),
  eta: text("eta").notNull(),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  service: text("service").notNull(),
  vendor: text("vendor").notNull(),
  vendorId: text("vendor_id").notNull(),
  customer: text("customer").notNull(),
  customerId: text("customer_id").notNull(),
  partner: text("partner"),
  partnerId: text("partner_id"),
  status: text("status").notNull(),
  total: real("total").notNull(),
  details: text("details").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const vendorOffers = sqliteTable("vendor_offers", {
  id: text("id").primaryKey(),
  vendorId: text("vendor_id").notNull(),
  vendor: text("vendor").notNull(),
  title: text("title").notNull(),
  code: text("code").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  minOrder: real("min_order").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pricingRules = sqliteTable("pricing_rules", {
  service: text("service").primaryKey(),
  baseFare: real("base_fare").notNull(),
  perKm: real("per_km").notNull(),
  platformFee: real("platform_fee").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: text("created_at").notNull(),
});
