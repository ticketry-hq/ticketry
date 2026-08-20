"""Fixtures for the worktracker package tests.

Covers both the standalone model/sequence tests and the relocated DRF/SDK
integration suite through the package's own minimal Django host
(``worktracker.tests.urls``). No host application is required.
"""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid

import pytest
from django.test import Client
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from worktracker.models import IssueType, Project, State


TOKEN = "test-token"
BASE = "/api/work-tracker"


def openapi_path(schema, mounted_path):
    """Return the document-relative path for an absolute mounted API path."""

    server_base = schema["servers"][0]["url"].rstrip("/")
    if not mounted_path.startswith(f"{server_base}/"):
        raise AssertionError(
            f"{mounted_path!r} is outside the OpenAPI server base {server_base!r}"
        )
    return mounted_path[len(server_base) :]


@pytest.fixture(autouse=True)
def wt_token(settings):
    """Configure a known API token for the auth check (C7)."""
    settings.WORKTRACKER_API_TOKEN = TOKEN
    settings.WORKTRACKER_DISABLE_AUTH = False


@pytest.fixture
def auth():
    """The valid API-key header."""
    return {"x-api-key": TOKEN}


@pytest.fixture
def client():
    return Client()


@pytest.fixture(scope="module")
def mcp_url(live_server):
    """Run the MCP sidecar process against Django's isolated live test server."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    listener.close()

    environment = os.environ.copy()
    environment.update(
        {
            "WORKTRACKER_BASE_URL": f"{live_server.url}/api",
            "WORKTRACKER_API_KEY": TOKEN,
            "MCP_HOST": "127.0.0.1",
            "MCP_PORT": str(port),
            "MCP_TRANSPORT": "http",
        }
    )
    agent_root = Path(__file__).resolve().parents[3] / "surfaces/worktracker-agent"
    process = subprocess.Popen(
        [sys.executable, "-m", "worktracker_agent.mcp.main"],
        cwd=agent_root,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    deadline = time.monotonic() + 5
    while process.poll() is None and time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                break
        time.sleep(0.02)
    else:
        process.terminate()
        output, _ = process.communicate(timeout=2)
        raise RuntimeError(f"MCP test server did not start:\n{output}")

    try:
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


@pytest.fixture
def mcp_client(mcp_url):
    class IntegrationMCPClient:
        def __init__(self, url):
            self.url = url
            self.output_schemas = {}

        async def list_tools(self):
            async with streamable_http_client(self.url) as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    tools = (await session.list_tools()).tools
            self.output_schemas = {
                tool.name: tool.outputSchema for tool in tools if tool.outputSchema
            }
            return tools

        async def call_tool(self, name, arguments):
            async with streamable_http_client(self.url) as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    listed_tools = (await session.list_tools()).tools
                    result = await session.call_tool(name, arguments)
            self.output_schemas = {
                tool.name: tool.outputSchema
                for tool in listed_tools
                if tool.outputSchema
            }
            structured_content = result.structuredContent
            data = structured_content
            output_schema = self.output_schemas.get(name)
            if output_schema and output_schema.get("x-fastmcp-wrap-result"):
                data = structured_content.get("result")
            return SimpleNamespace(
                content=result.content,
                structured_content=structured_content,
                data=data,
                is_error=result.isError,
            )

    return IntegrationMCPClient(mcp_url)


@pytest.fixture
def project(db):
    """Create a project (slug MEML) for issue tests."""

    return Project.objects.create(id=uuid.uuid4(), name="meml", slug="MEML")


@pytest.fixture
def state(project):
    """A 'Todo' state in the project's unstarted group."""

    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )


@pytest.fixture
def task_type(project):
    """An explicitly selectable task-level type for generic create tests."""

    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )


@pytest.fixture
def module_type(project):
    """The explicit module-level type used by module create tests."""

    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )


def post_json(client, url, body, auth):
    """POST a JSON body with the API-key header."""

    return client.post(
        url, data=json.dumps(body), content_type="application/json", headers=auth
    )


def patch_json(client, url, body, auth):
    """PATCH a JSON body with the API-key header."""

    return client.patch(
        url, data=json.dumps(body), content_type="application/json", headers=auth
    )
