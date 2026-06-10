"""add item_group position

Revision ID: 8f2d4b7c1a90
Revises: 14cd5701c9fb
Create Date: 2026-06-10 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8f2d4b7c1a90"
down_revision: Union[str, None] = "14cd5701c9fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("item_group", sa.Column("position", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("item_group", "position")
