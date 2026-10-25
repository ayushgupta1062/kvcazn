import pytest

from app import demo_data
from app.store import Dataset


@pytest.fixture(scope="session")
def demo_ds() -> Dataset:
    """Synthetic data with the same shape as the real feeds (8 forecast versions/day, hourly points)."""
    actuals, forecasts = demo_data.generate()
    return Dataset(actuals, forecasts, {"dataSource": "synthetic"})
