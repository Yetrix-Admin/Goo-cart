"""Migrate Goocart's local D1 data into the MongoDB collections used by the API.

The operation is repeatable: records are upserted by their stable business key
or by a deterministic ObjectId derived from the former D1 id. It never drops a
database or deletes records. Atlas credentials are read from the environment,
``server/.env``, or a hidden prompt and are never printed.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = PROJECT_ROOT / ".atlas-tools" / "deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))

from bson import ObjectId  # type: ignore[import-not-found]  # noqa: E402
from pymongo import MongoClient  # type: ignore[import-not-found]  # noqa: E402
from pymongo.server_api import ServerApi  # type: ignore[import-not-found]  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate Goocart D1 data into the live MongoDB schema")
    parser.add_argument("sqlite_path", type=Path, help="Path to the local D1 SQLite database")
    parser.add_argument("--database", help="Target database (defaults to MONGODB_DB or goocart)")
    parser.add_argument("--dry-run", action="store_true", help="Validate both databases and print source counts only")
    return parser.parse_args()


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def stable_id(kind: str, legacy_id: Any) -> ObjectId:
    digest = hashlib.sha256(f"goocart:d1:{kind}:{legacy_id}".encode()).hexdigest()
    return ObjectId(digest[:24])


def as_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=parsed.tzinfo or UTC)
    except ValueError:
        return None


def as_json(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def as_list(value: Any) -> list[Any]:
    parsed = as_json(value, None)
    if isinstance(parsed, list):
        return parsed
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def source_rows(db: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    return [dict(row) for row in db.execute(f'SELECT * FROM "{table}"').fetchall()]


def table_counts(db: sqlite3.Connection) -> dict[str, int]:
    names = [
        row[0]
        for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        if row[0] not in {"_cf_METADATA", "_schema_migrations"}
    ]
    return {name: db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in sorted(names)}


def set_doc(collection: Any, key: dict[str, Any], values: dict[str, Any]) -> None:
    collection.update_one(key, {"$set": values}, upsert=True)


def migrate(source: sqlite3.Connection, target: Any) -> dict[str, int]:
    written: dict[str, int] = defaultdict(int)

    users = source_rows(source, "users")
    user_ids: dict[str, ObjectId] = {}
    for row in users:
        existing = target.users.find_one({"email": row["email"].lower()}, {"_id": 1})
        oid = existing["_id"] if existing else stable_id("user", row["id"])
        user_ids[row["id"]] = oid
        user_values = {
            "legacyId": row["id"],
            "email": row["email"].lower(),
            "passwordHash": row["password_hash"],
            "name": row["name"],
            "role": row["role"],
            "status": row["status"],
            "emailVerifiedAt": as_datetime(row["email_verified_at"]),
            "phoneVerifiedAt": as_datetime(row["phone_verified_at"]),
            "lastLoginAt": as_datetime(row["last_login_at"]),
            "createdAt": as_datetime(row["created_at"]),
            "updatedAt": as_datetime(row["updated_at"]),
        }
        if row["phone"]:
            user_values["phone"] = row["phone"]
        else:
            target.users.update_one({"_id": oid}, {"$unset": {"phone": ""}})
        set_doc(target.users, {"_id": oid}, user_values)
        written["users"] += 1

    permissions = {row["id"]: row["description"] for row in source_rows(source, "permissions")}
    role_permissions: dict[str, list[str]] = defaultdict(list)
    for row in source_rows(source, "role_permissions"):
        role_permissions[row["role_id"]].append(row["permission_id"])
    for row in source_rows(source, "roles"):
        set_doc(
            target.roles,
            {"_id": row["id"]},
            {
                "label": row["label"],
                "description": row["description"],
                "permissions": sorted(role_permissions[row["id"]]),
                "permissionDescriptions": {
                    key: permissions.get(key, "") for key in sorted(role_permissions[row["id"]])
                },
            },
        )
        written["roles"] += 1

    offers_by_restaurant: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "restaurant_offers"):
        offers_by_restaurant[row["restaurant_id"]].append(
            {"title": row["title"], "description": row["description"]}
        )
    categories_by_restaurant: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "menu_categories"):
        categories_by_restaurant[row["restaurant_id"]].append(
            {"key": row["id"], "name": row["name"], "sortOrder": row["sort_order"]}
        )

    restaurant_ids: dict[str, ObjectId] = {}
    for row in source_rows(source, "restaurants"):
        existing = target.restaurants.find_one({"slug": row["id"]}, {"_id": 1})
        oid = existing["_id"] if existing else stable_id("restaurant", row["id"])
        restaurant_ids[row["id"]] = oid
        categories = sorted(categories_by_restaurant[row["id"]], key=lambda item: item["sortOrder"])
        set_doc(
            target.restaurants,
            {"_id": oid},
            {
                "legacyId": row["id"],
                "slug": row["id"],
                "name": row["name"],
                "imageUrl": row["image_url"],
                "ownerUserId": user_ids.get(row["owner_user_id"]),
                "rating": row["rating"],
                "ratingCount": row["rating_count"],
                "cuisines": as_list(row["cuisines"]),
                "deliveryTimeMin": row["delivery_time_min"],
                "deliveryTimeMax": row["delivery_time_max"],
                "distanceKm": row["distance_km"],
                "priceForOne": row["price_for_one"],
                "priceForTwo": row["price_for_two"],
                "vegOnly": bool(row["veg_only"]),
                "isOpen": bool(row["is_open"]),
                "area": row["area"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "offers": offers_by_restaurant[row["id"]],
                "categories": categories,
            },
        )
        written["restaurants"] += 1

    variants_by_item: dict[str, list[dict[str, Any]]] = defaultdict(list)
    variant_by_id: dict[str, dict[str, Any]] = {}
    for row in source_rows(source, "food_item_variants"):
        variant = {"key": row["id"], "name": row["name"], "price": row["price"], "sortOrder": row["sort_order"]}
        variants_by_item[row["food_item_id"]].append(variant)
        variant_by_id[row["id"]] = variant
    addons_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "food_item_addons"):
        addons_by_group[row["group_id"]].append({"key": row["id"], "name": row["name"], "price": row["price"]})
    groups_by_item: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "food_item_addon_groups"):
        groups_by_item[row["food_item_id"]].append(
            {
                "key": row["id"],
                "name": row["name"],
                "required": bool(row["required"]),
                "multiSelect": bool(row["multi_select"]),
                "maxSelect": row["max_select"],
                "options": addons_by_group[row["id"]],
            }
        )

    food_item_ids: dict[str, ObjectId] = {}
    for row in source_rows(source, "food_items"):
        existing = target.fooditems.find_one({"slug": row["id"]}, {"_id": 1})
        oid = existing["_id"] if existing else stable_id("food-item", row["id"])
        food_item_ids[row["id"]] = oid
        set_doc(
            target.fooditems,
            {"_id": oid},
            {
                "legacyId": row["id"],
                "slug": row["id"],
                "restaurantId": restaurant_ids[row["restaurant_id"]],
                "categoryKey": row["category_id"],
                "name": row["name"],
                "description": row["description"],
                "imageUrl": row["image_url"],
                "price": row["price"],
                "veg": bool(row["veg"]),
                "rating": row["rating"],
                "ratingCount": row["rating_count"],
                "bestseller": bool(row["bestseller"]),
                "available": bool(row["available"]),
                "variants": sorted(variants_by_item[row["id"]], key=lambda item: item["sortOrder"]),
                "addonGroups": groups_by_item[row["id"]],
            },
        )
        written["fooditems"] += 1

    for row in source_rows(source, "coupons"):
        set_doc(
            target.coupons,
            {"code": row["code"]},
            {
                "code": row["code"],
                "title": row["title"],
                "description": row["description"],
                "type": row["type"],
                "value": row["value"],
                "minOrder": row["min_order"],
                "maxDiscount": row["max_discount"],
                "active": bool(row["active"]),
            },
        )
        written["coupons"] += 1

    order_items: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "food_order_items"):
        variant = variant_by_id.get(row["variant_id"])
        order_items[row["order_id"]].append(
            {
                "_id": stable_id("order-item", row["id"]),
                "foodItemId": food_item_ids[row["food_item_id"]],
                "name": row["name"],
                "imageUrl": row["image_url"],
                "veg": bool(row["veg"]),
                "quantity": row["quantity"],
                "unitPrice": row["unit_price"],
                "lineTotal": row["line_total"],
                "variant": (
                    {"key": row["variant_id"], "name": row["variant_name"], "price": variant["price"] if variant else row["unit_price"]}
                    if row["variant_id"]
                    else None
                ),
                "addons": as_json(row["addons"], []),
            }
        )
    history_by_order: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source_rows(source, "food_order_status_history"):
        history_by_order[row["order_id"]].append(
            {
                "status": row["status"],
                "actorId": user_ids.get(row["actor_id"]),
                "actorRole": row["actor_role"],
                "at": as_datetime(row["created_at"]),
            }
        )
    for row in source_rows(source, "food_orders"):
        existing = target.orders.find_one({"orderNumber": row["order_number"]}, {"_id": 1})
        oid = existing["_id"] if existing else stable_id("food-order", row["id"])
        history = sorted(history_by_order[row["id"]], key=lambda item: item["at"] or datetime.min.replace(tzinfo=UTC))
        set_doc(
            target.orders,
            {"_id": oid},
            {
                "legacyId": row["id"],
                "orderNumber": row["order_number"],
                "customerId": user_ids[row["customer_id"]],
                "customerName": row["customer_name"],
                "restaurantId": restaurant_ids[row["restaurant_id"]],
                "restaurantName": row["restaurant_name"],
                "restaurantArea": row["restaurant_area"],
                "restaurantLatitude": row["restaurant_latitude"],
                "restaurantLongitude": row["restaurant_longitude"],
                "status": row["status"],
                "paymentMethod": row["payment_method"],
                "paymentStatus": row["payment_status"],
                "couponCode": row["coupon_code"],
                "instructions": as_json(row["instructions"], []),
                "bill": {
                    "itemTotal": row["item_total"],
                    "restaurantDiscount": row["restaurant_discount"],
                    "couponDiscount": row["coupon_discount"],
                    "deliveryFee": row["delivery_fee"],
                    "platformFee": row["platform_fee"],
                    "taxes": row["taxes"],
                    "tip": row["tip"],
                    "total": row["total"],
                },
                "deliveryAddress": as_json(row["delivery_address"], {}),
                "deliveryOtp": row["delivery_otp"],
                "estimatedDeliveryMinutes": row["estimated_delivery_minutes"],
                "partnerId": user_ids.get(row["partner_id"]),
                "partnerName": row["partner_name"],
                "items": order_items[row["id"]],
                "statusHistory": history,
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["updated_at"]),
            },
        )
        written["orders"] += 1

    for row in source_rows(source, "sessions"):
        set_doc(
            target.sessions,
            {"_id": stable_id("session", row["id"])},
            {
                "legacyId": row["id"],
                "userId": user_ids[row["user_id"]],
                "tokenHash": row["token_hash"],
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["created_at"]),
                "expiresAt": as_datetime(row["expires_at"]),
                "revokedAt": as_datetime(row["revoked_at"]),
                "ip": row["ip"],
                "userAgent": row["user_agent"],
            },
        )
        written["sessions"] += 1

    for row in source_rows(source, "otp_codes"):
        set_doc(
            target.otps,
            {"_id": stable_id("otp", row["id"])},
            {
                "legacyId": row["id"],
                "identifier": row["identifier"],
                "purpose": row["purpose"],
                "codeHash": row["code_hash"],
                "attempts": row["attempts"],
                "expiresAt": as_datetime(row["expires_at"]),
                "consumedAt": as_datetime(row["consumed_at"]),
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["created_at"]),
            },
        )
        written["otps"] += 1

    for row in source_rows(source, "app_settings"):
        set_doc(target.settings, {"_id": row["key"]}, {"value": as_json(row["value"], row["value"])})
        written["settings"] += 1
    for row in source_rows(source, "service_config"):
        set_doc(target.serviceconfigs, {"_id": row["service"]}, {"enabled": bool(row["enabled"])})
        written["serviceconfigs"] += 1
    for row in source_rows(source, "pricing_rules"):
        set_doc(
            target.pricingrules,
            {"_id": row["service"]},
            {"baseFare": row["base_fare"], "perKm": row["per_km"], "platformFee": row["platform_fee"]},
        )
        written["pricingrules"] += 1

    for row in source_rows(source, "audit_logs"):
        set_doc(
            target.auditlogs,
            {"_id": stable_id("audit", row["id"])},
            {
                "legacyId": row["id"],
                "actorId": user_ids.get(row["actor_id"]),
                "actorRole": row["actor_role"],
                "action": row["action"],
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "before": as_json(row["before_json"], row["before_json"]),
                "after": as_json(row["after_json"], row["after_json"]),
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["created_at"]),
            },
        )
        written["auditlogs"] += 1

    for row in source_rows(source, "products"):
        set_doc(
            target.products,
            {"_id": stable_id("product", row["id"])},
            {
                "legacyId": row["id"],
                "service": row["service"],
                "vendorId": user_ids.get(row["vendor_id"], stable_id("user", row["vendor_id"])),
                "vendorName": row["vendor"],
                "name": row["name"],
                "description": row["description"],
                "price": row["price"],
                "stock": row["stock"],
                "rating": row["rating"],
                "eta": row["eta"],
            },
        )
        written["products"] += 1

    for row in source_rows(source, "orders"):
        existing = target.serviceorders.find_one({"reference": row["reference"]}, {"_id": 1})
        oid = existing["_id"] if existing else stable_id("service-order", row["id"])
        set_doc(
            target.serviceorders,
            {"_id": oid},
            {
                "legacyId": row["id"],
                "reference": row["reference"],
                "service": row["service"],
                "vendorId": user_ids.get(row["vendor_id"]),
                "vendorName": row["vendor"],
                "customerId": user_ids.get(row["customer_id"], stable_id("user", row["customer_id"])),
                "customerName": row["customer"],
                "partnerId": user_ids.get(row["partner_id"]),
                "partnerName": row["partner"],
                "status": row["status"],
                "total": row["total"],
                "details": as_json(row["details"], {}),
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["updated_at"]),
            },
        )
        written["serviceorders"] += 1

    for row in source_rows(source, "vendor_offers"):
        set_doc(
            target.vendoroffers,
            {"_id": stable_id("vendor-offer", row["id"])},
            {
                "legacyId": row["id"],
                "vendorId": user_ids.get(row["vendor_id"], stable_id("user", row["vendor_id"])),
                "vendorName": row["vendor"],
                "title": row["title"],
                "code": row["code"],
                "discountPercent": row["discount_percent"],
                "minOrder": row["min_order"],
                "active": bool(row["active"]),
                "createdAt": as_datetime(row["created_at"]),
                "updatedAt": as_datetime(row["updated_at"]),
            },
        )
        written["vendoroffers"] += 1

    number_re = re.compile(r"(\d+)$")
    food_numbers = [int(match.group(1)) for row in source_rows(source, "food_orders") if (match := number_re.search(row["order_number"]))]
    legacy_orders = source_rows(source, "orders")
    service_numbers = [int(match.group(1)) for row in legacy_orders if (match := number_re.search(row["reference"]))]
    ride_numbers = [
        int(match.group(1))
        for row in legacy_orders
        if row["service"] == "Bike Taxi" and (match := number_re.search(row["reference"]))
    ]
    parcel_numbers = [
        int(match.group(1))
        for row in legacy_orders
        if row["service"] == "Parcel" and (match := number_re.search(row["reference"]))
    ]
    for key, values in {
        "orderNumber": food_numbers,
        "serviceOrderNumber": service_numbers,
        "rideNumber": ride_numbers,
        "parcelNumber": parcel_numbers,
    }.items():
        set_doc(target.counters, {"_id": key}, {"seq": max(values, default=0)})
        written["counters"] += 1

    target.migrationmanifests.replace_one(
        {"_id": "d1-live-schema"},
        {
            "_id": "d1-live-schema",
            "source": "Goocart D1",
            "migratedAt": datetime.now(UTC),
            "collections": dict(written),
            "totalDocuments": sum(written.values()),
        },
        upsert=True,
    )
    return dict(written)


def main() -> int:
    args = parse_args()
    sqlite_path = args.sqlite_path.resolve()
    if not sqlite_path.is_file():
        raise SystemExit(f"D1 database not found: {sqlite_path}")

    dotenv = read_dotenv(PROJECT_ROOT / "server" / ".env")
    uri = os.environ.get("MONGODB_URI") or dotenv.get("MONGODB_URI") or getpass.getpass("Atlas URI: ")
    database_name = args.database or os.environ.get("MONGODB_DB") or dotenv.get("MONGODB_DB") or "goocart"
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        raise SystemExit("A valid MongoDB connection URI is required")

    source = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    counts = table_counts(source)

    client = MongoClient(uri, server_api=ServerApi("1"), serverSelectionTimeoutMS=15_000)
    client.admin.command("ping")
    target = client[database_name]

    if args.dry_run:
        result = {"database": database_name, "sourceTables": counts, "sourceRecords": sum(counts.values())}
    else:
        written = migrate(source, target)
        result = {
            "database": database_name,
            "sourceRecords": sum(counts.values()),
            "writtenCollections": written,
            "writtenDocuments": sum(written.values()),
        }

    print(json.dumps(result, indent=2, default=str))
    client.close()
    source.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
