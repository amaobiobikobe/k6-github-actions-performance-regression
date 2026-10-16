"""Fill the database with background data before a performance test.

Why: an empty database makes every query fast. Bugs like a missing index only
show up when tables have production-like volume, so CI seeds data first.

Run it from the folder that contains app/ (it seeds THAT app's database):
      python scripts/seed.py                 (defaults: 1000 users x 50 items)
      python scripts/seed.py --users 200 --items 20
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.getcwd())  # import app/ from the current folder (main or the PR)

from sqlalchemy import insert  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Item, User  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--users", type=int, default=1000)
    parser.add_argument("--items", type=int, default=50, help="items per user")
    args = parser.parse_args()

    started = time.perf_counter()
    Base.metadata.create_all(bind=engine)
    if args.users == 0 or args.items == 0:
        print("Seeding skipped (empty database)")
        return
    hashed = hash_password("SeedPassword123!")  # hash once, bcrypt is slow on purpose

    with SessionLocal() as db:
        db.execute(
            insert(User),
            [
                {"email": f"seed_{u}@example.com", "full_name": f"Seed user {u}", "hashed_password": hashed}
                for u in range(args.users)
            ],
        )
        user_ids = [row[0] for row in db.execute(User.__table__.select().with_only_columns(User.id))]
        # Interleave items across users (user 1, user 2, ... then again), like real traffic.
        rows = [
            {"name": f"Item {i}", "price": 9.99, "quantity": i, "owner_id": uid}
            for i in range(args.items)
            for uid in user_ids
        ]
        db.execute(insert(Item), rows)
        db.commit()

    took = time.perf_counter() - started
    print(f"Seeded {args.users} users and {len(rows)} items in {took:.1f}s")


if __name__ == "__main__":
    main()
