import pytest
from django.test import Client


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture
def client():
    return Client()
