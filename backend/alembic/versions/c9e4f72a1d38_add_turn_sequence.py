"""add turn sequence

Revision ID: c9e4f72a1d38
Revises: e30514cd95f2
Create Date: 2026-04-30 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9e4f72a1d38"
down_revision: str | None = "e30514cd95f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("turn", sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("turn", "sequence", server_default=None)


def downgrade() -> None:
    op.drop_column("turn", "sequence")
