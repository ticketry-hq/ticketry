import os


def test_completion_requires_authentication(client, settings):
    settings.WORKTRACKER_API_TOKEN = "secret"
    settings.WORKTRACKER_DISABLE_AUTH = False

    response = client.get("/api/fs/complete", {"path": ""})

    assert response.status_code == 401


def test_trailing_slash_lists_dirs(client, tmp_path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "beta").mkdir()
    (tmp_path / "afile.txt").write_text("x")

    r = client.get("/api/fs/complete", {"path": f"{tmp_path}/"})
    assert r.status_code == 200
    entries = r.json()["entries"]
    names = [os.path.basename(e) for e in entries]
    assert "alpha" in names
    assert "beta" in names
    assert "afile.txt" not in names


def test_prefix_filter(client, tmp_path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "apricot").mkdir()
    (tmp_path / "beta").mkdir()

    r = client.get("/api/fs/complete", {"path": f"{tmp_path}/ap"})
    assert r.status_code == 200
    names = [os.path.basename(e) for e in r.json()["entries"]]
    assert "alpha" not in names
    assert "apricot" in names
    assert "beta" not in names


def test_hidden_excluded_by_default(client, tmp_path):
    (tmp_path / ".secret").mkdir()
    (tmp_path / "visible").mkdir()
    r = client.get("/api/fs/complete", {"path": f"{tmp_path}/"})
    names = [os.path.basename(e) for e in r.json()["entries"]]
    assert ".secret" not in names
    assert "visible" in names


def test_hidden_shown_when_prefix_starts_with_dot(client, tmp_path):
    (tmp_path / ".config").mkdir()
    (tmp_path / ".cache").mkdir()
    (tmp_path / "other").mkdir()
    r = client.get("/api/fs/complete", {"path": f"{tmp_path}/.c"})
    names = [os.path.basename(e) for e in r.json()["entries"]]
    assert ".config" in names
    assert ".cache" in names
    assert "other" not in names


def test_nonexistent_returns_empty(client, tmp_path):
    r = client.get("/api/fs/complete", {"path": f"{tmp_path}/does/not/exist/foo"})
    assert r.status_code == 200
    assert r.json() == {"entries": []}


def test_tilde_expansion(client, monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "coding").mkdir()
    (tmp_path / "config").mkdir()
    (tmp_path / "downloads").mkdir()
    r = client.get("/api/fs/complete", {"path": "~/co"})
    names = [os.path.basename(e) for e in r.json()["entries"]]
    assert "coding" in names
    assert "config" in names
    assert "downloads" not in names
