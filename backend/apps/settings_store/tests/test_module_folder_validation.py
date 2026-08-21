import pytest


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/config"),
        ("patch", "/api/config"),
        ("post", "/api/config/profiles"),
        ("put", "/api/config/profiles/0"),
        ("delete", "/api/config/profiles/0"),
    ],
)
def test_retired_file_backed_configuration_operations_return_404(client, method, path):
    response = getattr(client, method)(path, content_type="application/json")

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("relative/repo", "module_folder_not_absolute"),
        ("{missing}", "module_folder_missing"),
        ("{file}", "module_folder_not_a_directory"),
    ],
)
def test_folder_validation_rejects_unusable_paths(client, tmp_path, path, reason):
    file_path = tmp_path / "README.md"
    file_path.write_text("not a directory")
    resolved_path = path.format(missing=tmp_path / "gone", file=file_path)

    response = client.post(
        "/api/config/folders/validate",
        data={"path": resolved_path},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"valid": False, "reason": reason}


def test_folder_validation_accepts_an_existing_directory(client, tmp_path):
    response = client.post(
        "/api/config/folders/validate",
        data={"path": f"  {tmp_path}  "},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"valid": True, "reason": None}
