import "dotenv/config";
import mongoose from "mongoose";
import { connectDb, dbName, disconnectDb } from "./lib/db.js";
import { Coupon, FoodItem, Restaurant, Role, ServiceConfig } from "./models.js";
import { SEED_RESTAURANTS, SEED_FOOD_ITEMS, SEED_COUPONS, SEED_ROLES, SERVICES } from "./seedData.js";

const WIPE_FLAG = "--confirm-wipe";

/**
 * DESTRUCTIVE when run with --confirm-wipe: drops every database on the
 * cluster except Mongo's own internal ones. Requested explicitly; guarded by
 * the flag so `npm run seed` can never do it by accident.
 */
async function wipeCluster(): Promise<void> {
  const admin = mongoose.connection.getClient().db().admin();
  const { databases } = await admin.listDatabases();
  const protectedDbs = new Set(["admin", "local", "config"]);

  for (const db of databases) {
    if (protectedDbs.has(db.name)) continue;
    process.stdout.write(`  dropping database "${db.name}" ... `);
    await mongoose.connection.getClient().db(db.name).dropDatabase();
    console.log("done");
  }
}

async function seed(): Promise<void> {
  const wipe = process.argv.includes(WIPE_FLAG);

  console.log(`Connecting to Atlas (database: ${dbName()}) ...`);
  await connectDb();
  console.log("Connected.\n");

  if (wipe) {
    console.log("WIPING CLUSTER — every database except admin/local/config:");
    await wipeCluster();
    console.log("");
  } else {
    console.log(`Upserting into "${dbName()}" (pass ${WIPE_FLAG} to wipe the cluster first).\n`);
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

  await disconnectDb();
  console.log("\nSeed complete.");
}

seed().catch(async (error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
