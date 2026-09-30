"""add_username_to_users

Revision ID: a8b2c3d4e5f6
Revises: f7ea55e48a8f
Create Date: 2026-09-30 21:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f7ea55e48a8f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('username', sa.String(length=64), nullable=True))
    op.create_index('ix_users_username', 'users', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_username', table_name='users')
    op.drop_column('users', 'username')
