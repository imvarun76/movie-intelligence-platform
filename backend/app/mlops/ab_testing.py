"""
A/B Testing & Online Experimentation Engine (Phase 6 MLOps).

Features:
  - Deterministic bucketing via SHA-256 hashing on (experiment_name + user_id).
  - Multi-variant traffic allocation.
  - Conversion & Telemetry logging into `ab_experiment_logs`.
  - Real-time conversion rate and lift analytics.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.ab_experiment import ABExperimentLog

logger = logging.getLogger(__name__)


@dataclass
class VariantConfig:
    name: str
    weight: float
    description: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExperimentDefinition:
    name: str
    description: str
    variants: list[VariantConfig]
    salt: str = "mi-salt-v1"


# Registered platform experiments
EXPERIMENTS: dict[str, ExperimentDefinition] = {
    "recommender_hybrid_v1": ExperimentDefinition(
        name="recommender_hybrid_v1",
        description="A/B test comparing baseline hybrid recommender against high-exploration multi-objective model",
        variants=[
            VariantConfig(
                name="control",
                weight=0.50,
                description="Production baseline hybrid ranker (15% exploration)",
                params={"exploration_rate": 0.15, "max_genre_ratio": 0.35, "novelty_boost": 0.0},
            ),
            VariantConfig(
                name="treatment_exploration",
                weight=0.50,
                description="High-novelty exploratory ranker (30% exploration with indie & foreign boost)",
                params={"exploration_rate": 0.30, "max_genre_ratio": 0.25, "novelty_boost": 0.2},
            ),
        ],
    ),
}


class ABExperimentEngine:
    def __init__(self, experiments: dict[str, ExperimentDefinition] | None = None):
        self.experiments = experiments or EXPERIMENTS

    def assign_variant(self, experiment_name: str, user_id: UUID) -> VariantConfig:
        """
        Deterministically assign a user to a variant in an experiment using SHA-256 hash.
        """
        exp = self.experiments.get(experiment_name)
        if not exp:
            return VariantConfig(name="control", weight=1.0, description="Default fallback", params={})

        # Hash experiment + user + salt
        key = f"{exp.name}:{user_id}:{exp.salt}"
        hash_digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        hash_val = int(hash_digest[:8], 16) / 0xFFFFFFFF  # float [0.0, 1.0)

        cumulative = 0.0
        for variant in exp.variants:
            cumulative += variant.weight
            if hash_val < cumulative:
                return variant

        return exp.variants[-1]

    async def log_event(
        self,
        session: AsyncSession,
        experiment_name: str,
        user_id: UUID,
        variant: str,
        conversion_event: str | None = None,
        value: float | None = None,
    ) -> ABExperimentLog:
        """
        Record an impression or conversion event to ab_experiment_logs.
        """
        entry = ABExperimentLog(
            id=uuid4(),
            experiment_name=experiment_name,
            user_id=user_id,
            variant=variant,
            conversion_event=conversion_event,
            value=value,
            logged_at=datetime.now(timezone.utc),
        )
        session.add(entry)
        await session.commit()
        return entry

    async def get_metrics(
        self, session: AsyncSession, experiment_name: str
    ) -> dict[str, Any]:
        """
        Aggregate conversion metrics for an experiment.
        """
        # Fetch impressions and conversions per variant
        stmt = (
            select(
                ABExperimentLog.variant,
                ABExperimentLog.conversion_event,
                func.count(ABExperimentLog.id).label("count"),
            )
            .where(ABExperimentLog.experiment_name == experiment_name)
            .group_by(ABExperimentLog.variant, ABExperimentLog.conversion_event)
        )
        res = await session.execute(stmt)
        rows = res.all()

        variant_stats: dict[str, dict[str, Any]] = {}
        for variant, event, count in rows:
            if variant not in variant_stats:
                variant_stats[variant] = {
                    "impressions": 0,
                    "conversions": 0,
                    "conversion_rate": 0.0,
                    "events_breakdown": {},
                }
            if event is None or event == "impression":
                variant_stats[variant]["impressions"] += count
            else:
                variant_stats[variant]["conversions"] += count
                variant_stats[variant]["events_breakdown"][event] = count

        # Compute conversion rates & relative lift
        control_cr = 0.0
        for vname, vdata in variant_stats.items():
            impr = max(1, vdata["impressions"])
            vdata["conversion_rate"] = round(vdata["conversions"] / impr, 4)
            if vname == "control":
                control_cr = vdata["conversion_rate"]

        for vname, vdata in variant_stats.items():
            if vname != "control" and control_cr > 0:
                lift = round(((vdata["conversion_rate"] - control_cr) / control_cr) * 100, 2)
                vdata["relative_lift_pct"] = lift
            else:
                vdata["relative_lift_pct"] = 0.0

        return {
            "experiment_name": experiment_name,
            "variants": variant_stats,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }


_engine_instance: ABExperimentEngine | None = None


def get_experiment_engine() -> ABExperimentEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = ABExperimentEngine()
    return _engine_instance
