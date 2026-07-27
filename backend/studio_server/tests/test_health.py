from django.conf import settings
from django.test import Client


def test_healthz(tmp_path, monkeypatch):
    """Return healthy without using the real state database."""
    db_path = tmp_path / "state.db"
    monkeypatch.setenv("MUXED_STATE_DB", str(db_path))
    settings.DATABASES["default"]["NAME"] = db_path

    response = Client().get("/api/healthz")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert not db_path.exists()
