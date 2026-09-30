import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx


BASE_URL = "https://api.themoviedb.org/3/discover/movie"
CUTOFF_DATE = "2026-01-01"


def main() -> int:
    api_key = os.getenv("TMDB_API_KEY")

    if not api_key:
        print("ERROR: TMDB_API_KEY is not set.")
        return 1

    output_dir = Path("data/raw/tmdb")
    output_dir.mkdir(parents=True, exist_ok=True)

    params = {
        "api_key": api_key,
        "language": "en-US",
        "include_adult": "false",
        "include_video": "false",
        "page": 1,
        "sort_by": "popularity.desc",
        "primary_release_date.lte": CUTOFF_DATE,
    }

    try:
        response = httpx.get(
            BASE_URL,
            params=params,
            timeout=30.0,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"ERROR: TMDB request failed: {exc}")
        return 1

    payload = response.json()

    retrieved_at = datetime.now(timezone.utc).isoformat()

    output = {
        "source": "tmdb",
        "endpoint": BASE_URL,
        "retrieved_at": retrieved_at,
        "cutoff_date": CUTOFF_DATE,
        "request": {
            "language": "en-US",
            "include_adult": False,
            "include_video": False,
            "page": 1,
            "sort_by": "popularity.desc",
            "primary_release_date.lte": CUTOFF_DATE,
        },
        "response": payload,
    }

    output_file = output_dir / "discover_page_1.json"
    output_file.write_text(
        json.dumps(output, indent=2),
        encoding="utf-8",
    )

    print(f"TMDB ingestion successful")
    print(f"Movies returned: {len(payload.get('results', []))}")
    print(f"Total TMDB results: {payload.get('total_results')}")
    print(f"Saved: {output_file}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
