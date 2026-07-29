"""Install and verify Ticketry's pinned workflow skills for every provider."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Iterable, Mapping

from .catalog import CatalogValidationError, catalog_root, tree_digest, verify_catalog


MANIFEST_NAME = ".ticketry-managed-skills.json"
MANIFEST_SCHEMA_VERSION = 1
SUPPORTED_PROVIDERS = ("claude", "codex", "agy", "gemini")


class SkillInstallationError(RuntimeError):
    """Ticketry cannot safely provide its required, pinned workflow skills."""

    def __init__(
        self,
        *,
        provider: str,
        skill: str,
        reason: str,
        path: Path,
        message: str,
    ) -> None:
        self.provider = provider
        self.skill = skill
        self.reason = reason
        self.path = path
        self.message = message
        super().__init__(
            f"skill_installation_failed: provider={provider} skill={skill} "
            f"reason={reason} path={path}: {message} "
            "Run `muxed-backend skills install` to repair the installation."
        )


def provider_skill_root(
    provider: str,
    *,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Return the provider-native persistent skill root."""

    environment = os.environ if environ is None else environ
    user_home = Path.home() if home is None else Path(home)
    if provider == "claude":
        config_root = Path(environment.get("CLAUDE_CONFIG_DIR", user_home / ".claude"))
        return config_root / "skills"
    if provider == "codex":
        return Path(environment.get("CODEX_HOME", user_home / ".codex")) / "skills"
    if provider == "agy":
        return user_home / ".agy/skills"
    if provider == "gemini":
        gemini_home = Path(environment.get("GEMINI_CLI_HOME", user_home))
        return gemini_home / ".gemini/skills"
    raise ValueError(f"unsupported skill provider: {provider}")


def _load_manifest(root: Path) -> dict:
    path = root / MANIFEST_NAME
    if not path.exists():
        return {}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION
        or not isinstance(manifest.get("packages"), dict)
    ):
        return {}
    return manifest


def _write_manifest(root: Path, *, provider: str, lock: dict) -> None:
    payload = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "provider": provider,
        "upstream_commit": lock["upstream"]["commit"],
        "packages": {
            package["name"]: package["digest"] for package in lock["packages"]
        },
    }
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{MANIFEST_NAME}.",
        suffix=".tmp",
        dir=root,
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as manifest_file:
            descriptor = -1
            json.dump(payload, manifest_file, separators=(",", ":"), sort_keys=True)
            manifest_file.write("\n")
            manifest_file.flush()
            os.fsync(manifest_file.fileno())
        os.replace(temporary, root / MANIFEST_NAME)
    except BaseException:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)
        raise


def _canonical_name(skill_dir: Path) -> str | None:
    try:
        contents = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    except OSError:
        return None
    for line in contents.splitlines():
        if line.startswith("name:"):
            return line.partition(":")[2].strip()
    return None


def _assert_no_alias_collision(
    root: Path, *, provider: str, package_names: set[str]
) -> None:
    if not root.is_dir():
        return
    for candidate in root.iterdir():
        if not candidate.is_dir() or candidate.name in package_names:
            continue
        canonical = _canonical_name(candidate)
        if canonical in package_names:
            raise SkillInstallationError(
                provider=provider,
                skill=canonical,
                reason="collision",
                path=candidate,
                message="Another installed directory already advertises this skill name.",
            )


def _replace_managed_package(
    *,
    root: Path,
    provider: str,
    name: str,
    source: Path,
    destination: Path,
) -> None:
    staging = Path(tempfile.mkdtemp(prefix=f".ticketry-{name}.", dir=root))
    staging.rmdir()
    backup = root / f".ticketry-{name}.backup"
    if backup.exists():
        raise SkillInstallationError(
            provider=provider,
            skill=name,
            reason="stale_backup",
            path=backup,
            message="A previous repair left a backup that requires inspection.",
        )
    try:
        shutil.copytree(source, staging, copy_function=shutil.copy2)
        if destination.exists():
            os.replace(destination, backup)
        os.replace(staging, destination)
        if backup.exists():
            shutil.rmtree(backup)
    except BaseException:
        if not destination.exists() and backup.exists():
            os.replace(backup, destination)
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        raise


def install_packaged_skills(
    *,
    providers: Iterable[str] = SUPPORTED_PROVIDERS,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Path]:
    """Idempotently install or safely upgrade the complete pinned catalog."""

    lock = verify_catalog()
    package_names = {package["name"] for package in lock["packages"]}
    installed: dict[str, Path] = {}
    for provider in providers:
        root = provider_skill_root(provider, home=home, environ=environ)
        try:
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError as exc:
            raise SkillInstallationError(
                provider=provider,
                skill=lock["selected_packages"][0],
                reason="unwritable",
                path=root,
                message=f"The provider skill directory cannot be created: {exc}",
            ) from exc
        _assert_no_alias_collision(
            root, provider=provider, package_names=package_names
        )
        previous = _load_manifest(root).get("packages", {})
        for package in lock["packages"]:
            name = package["name"]
            source = (catalog_root() / package["path"]).resolve()
            destination = root / name
            try:
                actual = tree_digest(destination) if destination.is_dir() else None
            except (OSError, CatalogValidationError) as exc:
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="invalid",
                    path=destination,
                    message=f"The installed skill cannot be verified: {exc}",
                ) from exc
            if actual == package["digest"]:
                continue
            previously_managed = previous.get(name)
            if actual is not None and actual != previously_managed:
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="collision",
                    path=destination,
                    message="Refusing to overwrite a user-owned or modified skill.",
                )
            try:
                _replace_managed_package(
                    root=root,
                    provider=provider,
                    name=name,
                    source=source,
                    destination=destination,
                )
            except SkillInstallationError:
                raise
            except OSError as exc:
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="unwritable",
                    path=destination,
                    message=f"The pinned skill could not be installed: {exc}",
                ) from exc
        try:
            _write_manifest(root, provider=provider, lock=lock)
        except OSError as exc:
            raise SkillInstallationError(
                provider=provider,
                skill=lock["selected_packages"][0],
                reason="unwritable",
                path=root / MANIFEST_NAME,
                message=f"The installation manifest could not be written: {exc}",
            ) from exc
        installed[provider] = root
    return installed


def verify_provider_installation(
    provider: str,
    *,
    names: Iterable[str] | None = None,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Fail unless the provider can discover exact pinned package bytes."""

    lock = verify_catalog()
    packages = {package["name"]: package for package in lock["packages"]}
    required = tuple(packages) if names is None else tuple(names)
    root = provider_skill_root(provider, home=home, environ=environ)
    for name in required:
        if name not in packages:
            raise SkillInstallationError(
                provider=provider,
                skill=name,
                reason="unknown",
                path=root / name,
                message="The requested skill is absent from the packaged catalog.",
            )
        destination = root / name
        try:
            actual = tree_digest(destination) if destination.is_dir() else None
        except (OSError, CatalogValidationError) as exc:
            raise SkillInstallationError(
                provider=provider,
                skill=name,
                reason="invalid",
                path=destination,
                message=f"The installed skill cannot be verified: {exc}",
            ) from exc
        if actual != packages[name]["digest"]:
            raise SkillInstallationError(
                provider=provider,
                skill=name,
                reason="missing" if actual is None else "modified",
                path=destination,
                message="The pinned skill installation is missing or does not match.",
            )
    return root


def verify_all_installations(
    *,
    providers: Iterable[str] = SUPPORTED_PROVIDERS,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Path]:
    """Verify every provider's persistent installation."""

    return {
        provider: verify_provider_installation(
            provider, home=home, environ=environ
        )
        for provider in providers
    }
