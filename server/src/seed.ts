import "dotenv/config";
import mongoose from "mongoose";
import { connectDb, dbName, disconnectDb } from "./lib/db.js";
import { Coupon, FoodItem, PricingRule, Product, Restaurant, Role, ServiceConfig, User } from "./models.js";
import { SEED_RESTAURANTS, SEED_FOOD_ITEMS, SEED_COUPONS, SEED_ROLES, SEED_PRICING, SEED_PRODUCTS, SERVICES } from "./seedData.js";

const WIPE_FLAG = "--confirm-wipe";

/**
 * DESTRUCTIVE when run with --confirm-wipe: drops ONLY the Goocart database
 * named by MONGODB_DB.
 *
 * Scoped deliberately. This cluster also hosts other projects (fileseva runs
 * its production data here), and dropping neighbouring databases would
 * destroy live systems with no way back on the free tier.
 */
async function wipeGoocartDatabase(): Promise<void> {
  const target = dbName();
  const client = mongoose.connection.getClient();

  const { databases } = await client.db().admin().listDatabases();
  const others = databases.map((d) => d.name).filter((n) => !["admin", "local", "config", target].includes(n));

  process.stdout.write(`  dropping database "${target}" ... `);
  await client.db(target).dropDatabase();
  console.log("done");

  if (others.length) console.log(`  left untouched: ${others.join(", ")}`);
}

async function seed(): Promise<void> {
  const wipe = process.argv.includes(WIPE_FLAG);

  console.log(`Connecting to Atlas (database: ${dbName()}) ...`);
  await connectDb();
  console.log("Connected.\n");

  if (wipe) {
    console.log(`WIPING the "${dbName()}" database only:`);
    await wipeGoocartDatabase();
    console.log("");
  } else {
    console.log(`Upserting into "${dbName()}" (pass ${WIPE_FLAG} to drop it first).\n`);
  }

  // Roles and their permissions.
  for (const role of SEED_ROLES) {
    await Role.findByIdAndUpdate(role.id, { label: role.label, description: role.description, permissions: role.permissions }, { upsert: true });
  }
  console.log(`roles          ${SEED_ROLES.length}`);

  for (const service of SERVICES) {
    await ServiceConfig.findByIdAndUpdate(service, { enabled: true }, { upsert: true });
  }
  console.log(`services       ${SERVICES.length}`);

  // Restaurants keep a stable `slug` so re-running the seed updates rather
  // than duplicating, and so food items can resolve their parent by slug.
  const restaurantIdBySlug = new Map<string, mongoose.Types.ObjectId>();
  for (const r of SEED_RESTAURANTS) {
    const doc = await Restaurant.findOneAndUpdate({ slug: r.slug }, { $set: r }, { upsert: true, new: true });
    restaurantIdBySlug.set(r.slug, doc!._id);
  }
  console.log(`restaurants    ${SEED_RESTAURANTS.length}`);

  let itemCount = 0;
  for (const item of SEED_FOOD_ITEMS) {
    const restaurantId = restaurantIdBySlug.get(item.restaurantSlug);
    if (!restaurantId) {
      console.warn(`  ! skipping "${item.name}" — unknown restaurant ${item.restaurantSlug}`);
      continue;
    }
    const { restaurantSlug, ...rest } = item;
    await FoodItem.findOneAndUpdate({ slug: item.slug }, { $set: { ...rest, restaurantId } }, { upsert: true });
    itemCount++;
  }
  console.log(`food items     ${itemCount}`);

  for (const rule of SEED_PRICING) {
    await PricingRule.findByIdAndUpdate(rule.service, { baseFare: rule.baseFare, perKm: rule.perKm, platformFee: rule.platformFee, partnerPayoutPercent: rule.partnerPayoutPercent }, { upsert: true });
  }
  console.log(`pricing rules  ${SEED_PRICING.length}`);

  const platformStore = await User.findOneAndUpdate(
    { email: "platform-store@goocart.local" },
    { $set: { name: "Goocart Local Store", role: "VENDOR_OWNER", status: "ACTIVE" } },
    { upsert: true, new: true },
  );
  for (const product of SEED_PRODUCTS) {
    await Product.findOneAndUpdate(
      { service: product.service, name: product.name, vendorId: platformStore!._id },
      { $set: { ...product, vendorId: platformStore!._id, vendorName: platformStore!.name } },
      { upsert: true },
    );
  }
  console.log(`service items  ${SEED_PRODUCTS.length}`);

  for (const c of SEED_COUPONS) {
    await Coupon.findOneAndUpdate({ code: c.code }, { $set: c }, { upsert: true });
  }
  console.log(`coupons        ${SEED_COUPONS.length}`);

  // Verify what actually landed, rather than trusting the writes.
  console.log("\nVerifying:");
  console.log(`  restaurants  ${await Restaurant.countDocuments()}`);
  console.log(`  food items   ${await FoodItem.countDocuments()}`);
  console.log(`  coupons      ${await Coupon.countDocuments()}`);
  console.log(`  open now     ${await Restaurant.countDocuments({ isOpen: true })}`);
  console.log(`  service items ${await Product.countDocuments({ stock: { $gt: 0 } })}`);

  await disconnectDb();
  console.log("\nSeed complete.");
}

seed().catch(async (error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
