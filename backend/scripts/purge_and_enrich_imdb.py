"""
Purge junk/unrated movies and enrich catalog with official IMDb ratings.
"""

import asyncio
import gzip
import os
import sys

# Ensure root directory is on PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from sqlalchemy import text
from backend.app.db import async_session_factory


async def run():
    print("1. Loading official IMDb ratings dataset...")
    imdb_path = "backend/data/imdb_ratings.tsv.gz"
    imdb_map = {}
    with gzip.open(imdb_path, "rt", encoding="utf-8") as f:
        next(f)  # skip header
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 3:
                imdb_map[parts[0]] = (float(parts[1]), int(parts[2]))
    print(f"Loaded {len(imdb_map):,} IMDb ratings from official dataset.")

    async with async_session_factory() as session:
        # 1. Purge low quality, obscure unrated shorts, and user-reported junk
        print("\n2. Purging low-quality junk, unrated shorts, and user-reported movies...")

        purge_condition = """
            id NOT IN (SELECT movie_id FROM interactions)
            AND (
                tmdb_rating IS NULL
                OR tmdb_rating < 5.8
                OR (tmdb_rating < 6.5 AND (tmdb_votes < 300 OR tmdb_votes IS NULL))
                OR (tmdb_votes < 30 OR tmdb_votes IS NULL)
                OR title IN ('The Novices', 'Ice Cream Man', 'It Ends', 'Sex Rider: Wet Highway', 'Meesaya Murukku 2')
                OR title ILIKE '%sex rider%'
                OR title ILIKE '%meesaya%'
            )
        """

        # Delete from dependent tables first
        del_ext = await session.execute(text(f"""
            DELETE FROM movie_external_ids 
            WHERE movie_id IN (SELECT id FROM movies WHERE {purge_condition});
        """))
        print(f"Deleted {del_ext.rowcount} dependent rows from movie_external_ids")

        del_feat = await session.execute(text(f"""
            DELETE FROM movie_features 
            WHERE movie_id IN (SELECT id FROM movies WHERE {purge_condition});
        """))
        print(f"Deleted {del_feat.rowcount} dependent rows from movie_features")

        # Delete movies
        del_movies = await session.execute(text(f"""
            DELETE FROM movies WHERE {purge_condition};
        """))
        print(f"Deleted {del_movies.rowcount} junk/low-rated movies from movies table!")
        await session.commit()

        # 2. Enrich remaining movies with official IMDb ratings
        print("\n3. Enriching remaining movies with official IMDb ratings and vote counts...")
        res = await session.execute(text("""
            SELECT m.id, m.title, e.external_id
            FROM movies m
            LEFT JOIN movie_external_ids e ON e.movie_id = m.id AND e.source = 'imdb'
        """))
        movies = res.fetchall()
        print(f"Total remaining movies to enrich: {len(movies)}")

        enriched_count = 0
        for mid, title, imdb_id in movies:
            rating_data = None
            if imdb_id and imdb_id in imdb_map:
                rating_data = imdb_map[imdb_id]
            elif title == "Michael Jackson's Thriller" and "tt0088263" in imdb_map:
                rating_data = imdb_map["tt0088263"]

            if rating_data:
                avg_rating, num_votes = rating_data
                await session.execute(
                    text("""
                        UPDATE movies 
                        SET tmdb_rating = :rating, tmdb_votes = :votes
                        WHERE id = :id
                    """),
                    {"rating": avg_rating, "votes": num_votes, "id": mid}
                )
                enriched_count += 1

        await session.commit()
        print(f"Successfully enriched {enriched_count} movies with official IMDb ratings!")

        # 3. Check sample top movies and verify zero NULL ratings
        res_sample = await session.execute(text("""
            SELECT id, title, release_year, tmdb_rating, tmdb_votes
            FROM movies
            ORDER BY tmdb_rating DESC, tmdb_votes DESC
            LIMIT 15;
        """))
        print("\nTop 15 Acclaimed Movies in Platform (Ranked by IMDb Rating):")
        for row in res_sample.fetchall():
            print(f"  ★ {row[3]:.1f} | {row[1]} ({row[2]}) — {row[4]:,} IMDb votes")

        res_null = await session.execute(text("""
            SELECT count(*) FROM movies WHERE tmdb_rating IS NULL;
        """))
        print(f"\nRemaining movies with NULL rating: {res_null.scalar()}")

        res_total = await session.execute(text("""
            SELECT count(*) FROM movies;
        """))
        print(f"Total clean curated movies in database: {res_total.scalar()}")


if __name__ == "__main__":
    asyncio.run(run())
