import json

import pytest

from worktracker.tests.conftest import BASE


@pytest.mark.django_db
def test_legacy_project_workflow_routes_return_404(client, project, auth):
    settings_url = f"{BASE}/projects/{project.id}/workflow-settings"

    assert client.get(settings_url, headers=auth).status_code == 404
    assert (
        client.put(
            settings_url,
            data=json.dumps({"expected_revision": 0}),
            content_type="application/json",
            headers=auth,
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{settings_url}/publish",
            data=json.dumps({"expected_revision": 0}),
            content_type="application/json",
            headers=auth,
        ).status_code
        == 404
    )
