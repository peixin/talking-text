"""add learner content scope

Revision ID: 390d23f60e64
Revises: b46a6684d7e9
Create Date: 2026-05-27 12:00:00.000000

Implements: docs/learner-content-scope.md §4 + §10

Changes:
  item_group       — 4 new columns:
                       created_by_learner_id   UUID NULL → learner.id  ON DELETE SET NULL
                       last_edited_by_learner_id UUID NULL → learner.id ON DELETE SET NULL
                       locked                  BOOLEAN NOT NULL DEFAULT false
                       cloned_from_group_id    UUID NULL → item_group.id ON DELETE SET NULL

  item_group_learner (NEW) — many-to-many assignment of root groups to learners
  item_group_subscription (NEW) — cross-account reference (subscribe without clone)

Backfill:
  For every existing root item_group, insert one item_group_learner row per learner
  in the owning account, preserving the current "everyone sees everything" behaviour.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "390d23f60e64"
down_revision: Union[str, None] = "bc9ff182e2f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add four columns to item_group ────────────────────────────────────

    op.add_column(
        "item_group",
        sa.Column("created_by_learner_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "item_group",
        sa.Column("last_edited_by_learner_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "item_group",
        sa.Column(
            "locked",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "item_group",
        sa.Column("cloned_from_group_id", sa.Uuid(), nullable=True),
    )

    op.create_foreign_key(
        "fk_item_group_created_by_learner",
        "item_group",
        "learner",
        ["created_by_learner_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_item_group_last_edited_by_learner",
        "item_group",
        "learner",
        ["last_edited_by_learner_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_item_group_cloned_from",
        "item_group",
        "item_group",
        ["cloned_from_group_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Index for parent activity-feed queries
    op.create_index(
        "ix_item_group_last_edited_by_learner_id",
        "item_group",
        ["last_edited_by_learner_id"],
        unique=False,
    )

    # ── 2. Create item_group_learner ──────────────────────────────────────────
    # Many-to-many: root item_group ↔ learner (within same account)
    # Assignment is only valid at root level (enforced in application layer).

    op.create_table(
        "item_group_learner",
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("learner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Timestamp columns per project TimestampMixin convention
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["group_id"], ["item_group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["learner_id"], ["learner.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "learner_id"),
    )
    # Reverse-lookup index: "all groups assigned to this learner"
    op.create_index(
        "ix_item_group_learner_learner_id",
        "item_group_learner",
        ["learner_id"],
        unique=False,
    )

    # ── 3. Create item_group_subscription ────────────────────────────────────
    # Cross-account reference — no content is copied.
    # source_group_id is SET NULL (tombstone) when the source group is deleted.

    op.create_table(
        "item_group_subscription",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("subscriber_account_id", sa.Uuid(), nullable=False),
        sa.Column("source_group_id", sa.Uuid(), nullable=True),  # NULL = tombstone
        sa.Column(
            "subscribed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["subscriber_account_id"], ["account.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_group_id"], ["item_group.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "subscriber_account_id", "source_group_id", name="uq_subscriber_source_group"
        ),
    )
    op.create_index(
        "ix_item_group_subscription_subscriber_account_id",
        "item_group_subscription",
        ["subscriber_account_id"],
        unique=False,
    )

    # ── 4. Backfill item_group_learner ────────────────────────────────────────
    # Preserve the current "everyone in the account can see everything" behaviour.
    # For each existing root group, insert one row per learner in the owning account.

    op.execute(
        """
        INSERT INTO item_group_learner (group_id, learner_id, assigned_at, created_at, updated_at)
        SELECT
            g.id        AS group_id,
            l.id        AS learner_id,
            now()       AS assigned_at,
            now()       AS created_at,
            now()       AS updated_at
        FROM item_group g
        JOIN learner l ON l.account_id = g.owner_account_id
        WHERE g.parent_id IS NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    # Remove backfilled rows (the whole table is dropped anyway, but be explicit)
    op.drop_table("item_group_subscription")
    op.drop_table("item_group_learner")

    op.drop_index("ix_item_group_last_edited_by_learner_id", table_name="item_group")

    op.drop_constraint("fk_item_group_cloned_from", "item_group", type_="foreignkey")
    op.drop_constraint(
        "fk_item_group_last_edited_by_learner", "item_group", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_item_group_created_by_learner", "item_group", type_="foreignkey"
    )

    op.drop_column("item_group", "cloned_from_group_id")
    op.drop_column("item_group", "locked")
    op.drop_column("item_group", "last_edited_by_learner_id")
    op.drop_column("item_group", "created_by_learner_id")
