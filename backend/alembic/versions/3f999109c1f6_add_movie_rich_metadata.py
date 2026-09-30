"""add_movie_rich_metadata

Revision ID: 3f999109c1f6
Revises: 1fb8e79af2ca
Create Date: 2026-09-30 15:22:52.114554

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f999109c1f6'
down_revision: Union[str, Sequence[str], None] = '1fb8e79af2ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from sqlalchemy.dialects import postgresql


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('movies', sa.Column('poster_path', sa.String(length=256), nullable=True))
    op.add_column('movies', sa.Column('backdrop_path', sa.String(length=256), nullable=True))
    op.add_column('movies', sa.Column('tmdb_rating', sa.Float(), nullable=True))
    op.add_column('movies', sa.Column('tmdb_votes', sa.Integer(), nullable=True))
    op.add_column('movies', sa.Column('popularity', sa.Float(), nullable=True))
    op.add_column('movies', sa.Column('cast', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('movies', sa.Column('directors', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('movies', sa.Column('keywords', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('movies', 'keywords')
    op.drop_column('movies', 'directors')
    op.drop_column('movies', 'cast')
    op.drop_column('movies', 'popularity')
    op.drop_column('movies', 'tmdb_votes')
    op.drop_column('movies', 'tmdb_rating')
    op.drop_column('movies', 'backdrop_path')
    op.drop_column('movies', 'poster_path')
