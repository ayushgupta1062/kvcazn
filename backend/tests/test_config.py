import pytest

from app import config


@pytest.mark.parametrize(
    "raw, expected",
    [("1", True), ("1\n", True), (" true\r\n", True), ("YES", True), ("0", False), ("", False), ("no", False)],
)
def test_env_flag_ignores_whitespace_and_case(monkeypatch, raw, expected):
    monkeypatch.setenv("WIND_TEST_FLAG", raw)
    assert config.env_flag("WIND_TEST_FLAG") is expected


def test_env_flag_is_false_when_unset(monkeypatch):
    monkeypatch.delenv("WIND_TEST_FLAG", raising=False)
    assert config.env_flag("WIND_TEST_FLAG") is False
