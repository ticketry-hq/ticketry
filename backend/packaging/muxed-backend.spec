# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the target-suffixed Muxed backend sidecar."""

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata


datas = []
hiddenimports = []
binaries = []


def include_source_package(source_root, package_name):
    """Bundle local editable packages that PyInstaller cannot discover."""
    for source_path in source_root.rglob("*.py"):
        relative_parent = source_path.relative_to(source_root).parent
        destination = Path(package_name) / relative_parent
        datas.append((str(source_path), str(destination)))


repository_root = Path(SPECPATH).parents[1]
skill_catalog_root = (
    repository_root / "backend" / "apps" / "terminals" / "agents" / "skills"
)
datas.append(
    (
        str(skill_catalog_root),
        "apps/terminals/agents/skills",
    )
)
worktracker_agent_root = repository_root / "surfaces" / "worktracker-agent"
datas.append(
    (
        str(worktracker_agent_root / "__init__.py"),
        "worktracker_agent",
    )
)
include_source_package(
    worktracker_agent_root / "api",
    "worktracker_agent/api",
)
include_source_package(
    worktracker_agent_root / "mcp",
    "worktracker_agent/mcp",
)
include_source_package(
    repository_root / "surfaces" / "worktracker-sdk" / "worktracker_sdk",
    "worktracker_sdk",
)

for package in (
    "apps",
    "studio_server",
    "worktracker",
    "fastmcp",
    "mcp",
    "packaging",
    "dateutil",
    "urllib3",
    "burner_redis",
    "django",
    "channels",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

datas += copy_metadata("Django")
datas += copy_metadata("channels")
datas += copy_metadata("django-ninja")
datas += copy_metadata("uvicorn")
datas += copy_metadata("fastmcp")
datas += copy_metadata("mcp")

a = Analysis(
    ["sidecar.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=os.environ["MUXED_SIDECAR_NAME"],
    console=True,
)
