import asyncio

from sqlalchemy import select

from backend.app.db import async_session_factory
from backend.app.models import Interaction, Movie, User


async def main() -> None:
    async with async_session_factory() as session:
        await session.begin()

        try:
            user = User()
            movie = Movie(
                id=999999999,
                title="Smoke Test Movie",
                release_year=2026,
                runtime_minutes=120,
                original_language="en",
                genres=["Test"],
                overview="Temporary database smoke test record.",
            )

            session.add_all([user, movie])
            await session.flush()

            interaction = Interaction(
                user_id=user.id,
                movie_id=movie.id,
                event_type="clicked",
                source="smoke_test",
                event_metadata={"test": True},
            )

            session.add(interaction)
            await session.flush()

            user_result = await session.scalar(
                select(User).where(User.id == user.id)
            )

            movie_result = await session.scalar(
                select(Movie).where(Movie.id == movie.id)
            )

            interaction_result = await session.scalar(
                select(Interaction).where(Interaction.id == interaction.id)
            )

            assert user_result is not None
            assert movie_result is not None
            assert interaction_result is not None

            print("user:", user_result.id)
            print("movie:", movie_result.title)
            print("interaction:", interaction_result.event_type)
            print("ORM round-trip: OK")

            # Keep the database clean.
            await session.rollback()

        except Exception:
            await session.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(main())
