"""add_auth_fields_to_users

Revision ID: b9c3d4e5f6a7
Revises: a8b2c3d4e5f6
Create Date: 2026-09-30 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a8b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('name', sa.String(length=120), nullable=True))
    op.add_column('users', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('hashed_password', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('reset_token', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('reset_token_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_users_email', 'users', ['email'], unique=True)
    op.create_index('ix_users_reset_token', 'users', ['reset_token'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_reset_token', table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_column('users', 'reset_token_expires_at')
    op.drop_column('users', 'reset_token')
    op.drop_column('users', 'hashed_password')
    op.drop_column('users', 'email')
    op.drop_column('users', 'name')
