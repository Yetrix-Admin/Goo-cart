"""Upsert a lossless copy of local Goocart D1 rows into MongoDB Atlas.

The Atlas URI is read from MONGODB_URI or from a hidden terminal prompt. It is
never written to disk or printed. Collections are prefixed with ``goocart_`` so
the sync cannot overwrite unrelated data in an existing Atlas database. Source
rows that later disappear are retained unless ``--prune`` is explicitly used.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = PROJECT_ROOT / ".atlas-tools" / "deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))

from pymongo import ASCENDING, MongoClient, ReplaceOne  # type: ignore[import-not-found]  # noqa: E402
from pymongo.server_api import ServerApi  # type: ignore[import-not-found]  # noqa: E402


INTERNAL_TABLES = {"_cf_METADATA", "_schema_migrations"}
JSON_COLUMNS = {"details", "before_json", "after_json"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mirror Goocart D1 records into MongoDB Atlas")
    parser.add_argument("sqlite_path", type=Path, help="Path to the local D1 SQLite database")
    parser.add_argument("--database", help="Atlas database name; defaults to the URI database")
    parser.add_argument("--prune", action="store_true", help="Delete mirrored rows no longer present in D1")
    return parser.parse_args()


def decode_value(column: str, value: Any) -> Any:
    if value is None or column not in JSON_COLUMNS or not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def table_primary_keys(connection: sqlite3.Connection, table: str) -> list[str]:
    escaped = table.replace('"', '""')
    rows = connection.execute(f'PRAGMA table_info("{escaped}")').fetchall()
    return [row[1] for row in sorted(rows, key=lambda row: row[5]) if row[5]]


def source_identity(table: str, row: dict[str, Any], primary_keys: list[str], row_index: int) -> str:
    if primary_keys:
        return "|".join(str(row[key]) for key in primary_keys)
    return f"row-{row_index}"


def main() -> int:
    args = parse_args()
    sqlite_path = args.sqlite_path.resolve()
    if not sqlite_path.is_file():
        raise SystemExit(f"D1 database not found: {sqlite_path}")

    uri = os.environ.get("MONGODB_URI") or getpass.getpass("Atlas URI: ")
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        raise SystemExit("A valid MongoDB connection URI is required")

    source = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    client = MongoClient(uri, server_api=ServerApi("1"), serverSelectionTimeoutMS=15_000)
    client.admin.command("ping")
    database = client[args.database] if args.database else client.get_default_database()
    if database is None:
        raise SystemExit("The Atlas URI must include a database name or --database must be supplied")

    tables = [
        row[0]
        for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        if row[0] not in INTERNAL_TABLES
    ]
    counts: dict[str, int] = {}
    synced_at = datetime.now(UTC)

    for table in tables:
        escaped = table.replace('"', '""')
        rows = source.execute(f'SELECT * FROM "{escaped}"').fetchall()
        primary_keys = table_primary_keys(source, table)
        collection = database[f"goocart_{table}"]
        collection.create_index([("_source_id", ASCENDING)], unique=True, name="source_id_unique")
        operations = []
        active_source_ids: list[str] = []
        for index, sqlite_row in enumerate(rows):
            document = {key: decode_value(key, sqlite_row[key]) for key in sqlite_row.keys()}
            source_id = source_identity(table, document, primary_keys, index)
            document.update({"_source_id": source_id, "_source_table": table, "_synced_at": synced_at})
            active_source_ids.append(source_id)
            operations.append(ReplaceOne({"_source_id": source_id}, document, upsert=True))
        if operations:
            collection.bulk_write(operations, ordered=False)
        if args.prune:
            collection.delete_many({"_source_id": {"$nin": active_source_ids}}) if active_source_ids else collection.delete_many({})
        counts[table] = len(rows)

    database["goocart_sync_manifest"].replace_one(
        {"_id": "d1-mirror"},
        {
            "_id": "d1-mirror",
            "source": "Goocart D1",
            "synced_at": synced_at,
            "tables": counts,
            "total_records": sum(counts.values()),
        },
        upsert=True,
    )
    print(json.dumps({"database": database.name, "tables": counts, "total_records": sum(counts.values())}, indent=2))
    client.close()
    source.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
