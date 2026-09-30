"""add_feature_store_tables

Revision ID: f7ea55e48a8f
Revises: 3f999109c1f6
Create Date: 2026-09-30 17:10:28.614325

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7ea55e48a8f'
down_revision: Union[str, Sequence[str], None] = '3f999109c1f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from sqlalchemy.dialects import postgresql


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_features',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('interaction_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cold_start_tier', sa.String(length=16), nullable=False, server_default='new'),
        sa.Column('preferred_genres', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('rolling_7d_velocity', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('feature_timestamp', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('feature_version', sa.String(length=16), nullable=False, server_default='v1.0'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'movie_features',
        sa.Column('movie_id', sa.Integer(), nullable=False),
        sa.Column('bayesian_quality_score', sa.Float(), nullable=True),
        sa.Column('popularity_decayed', sa.Float(), nullable=True),
        sa.Column('interaction_velocity', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('primary_genre', sa.String(length=32), nullable=True),
        sa.Column('feature_timestamp', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('feature_version', sa.String(length=16), nullable=False, server_default='v1.0'),
        sa.ForeignKeyConstraint(['movie_id'], ['movies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('movie_id'),
    )

    op.create_table(
        'ab_experiment_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('experiment_name', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('variant', sa.String(length=32), nullable=False),
        sa.Column('conversion_event', sa.String(length=32), nullable=True),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ab_exp_user_name', 'ab_experiment_logs', ['experiment_name', 'user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_ab_exp_user_name', table_name='ab_experiment_logs')
    op.drop_table('ab_experiment_logs')
    op.drop_table('movie_features')
    op.drop_table('user_features')
