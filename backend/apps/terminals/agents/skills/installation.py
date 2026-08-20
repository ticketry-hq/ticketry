"""Install bundled workflow skills only when a provider-visible name is absent."""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Iterable, Mapping

from studio_server.atomic_files import atomic_write_json

from .catalog import CatalogValidationError, catalog_root, tree_digest, verify_catalog


MANIFEST_NAME = ".ticketry-managed-skills.json"
MANIFEST_SCHEMA_VERSION = 1
SUPPORTED_PROVIDERS = ("claude", "codex", "agy", "gemini")

logger = logging.getLogger(__name__)


class SkillInstallationError(RuntimeError):
    """Ticketry cannot safely provide a missing required workflow skill."""

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


def _write_manifest(
    root: Path, *, provider: str, lock: dict, managed_packages: Mapping[str, str]
) -> None:
    payload = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "provider": provider,
        "upstream_commit": lock["upstream"]["commit"],
        "packages": dict(managed_packages),
    }
    atomic_write_json(
        root / MANIFEST_NAME,
        payload,
        separators=(",", ":"),
        sort_keys=True,
        trailing_newline=True,
        mode=0o600,
        fsync=True,
    )


def _canonical_name(skill_dir: Path) -> str | None:
    try:
        contents = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    except OSError:
        return None
    for line in contents.splitlines():
        if line.startswith("name:"):
            return line.partition(":")[2].strip()
    return None


def _global_skill_roots(
    provider: str,
    *,
    home: Path,
    environ: Mapping[str, str],
) -> tuple[Path, ...]:
    """Return user-visible roots checked before installing a fallback copy."""

    if provider == "claude":
        claude_home = Path(environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
        plugin_root = home / ".claude/plugins"
        plugin_skills = (
            tuple(plugin_root.rglob("skills")) if plugin_root.is_dir() else ()
        )
        return (claude_home / "skills", *plugin_skills)
    if provider == "codex":
        codex_home = Path(environ.get("CODEX_HOME", home / ".codex"))
        return (home / ".agents/skills", codex_home / "skills")
    if provider == "agy":
        extension_root = home / ".gemini/extensions"
        extension_skills = (
            tuple(extension_root.glob("*/skills")) if extension_root.is_dir() else ()
        )
        return (home / ".agents/skills", home / ".agy/skills", *extension_skills)
    if provider == "gemini":
        gemini_home = Path(environ.get("GEMINI_CLI_HOME", home))
        extension_root = gemini_home / ".gemini/extensions"
        extension_skills = (
            tuple(extension_root.glob("*/skills")) if extension_root.is_dir() else ()
        )
        return (gemini_home / ".gemini/skills", *extension_skills)
    return ()


def visible_skill_candidates(
    provider: str,
    *,
    names: Iterable[str],
    cwd: Path | None = None,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, list[Path]]:
    """Return valid provider-visible skills grouped by canonical name."""

    environment = os.environ if environ is None else environ
    user_home = Path.home() if home is None else Path(home)
    roots: list[Path] = []
    if cwd is not None:
        resolved_cwd = cwd.resolve()
        if provider == "claude":
            roots.append(resolved_cwd / ".claude/skills")
        elif provider in {"codex", "agy"}:
            roots.append(resolved_cwd / ".agents/skills")
            roots.append(resolved_cwd / f".{provider}/skills")
        elif provider == "gemini":
            roots.append(resolved_cwd / ".gemini/skills")
    roots.extend(_global_skill_roots(provider, home=user_home, environ=environment))

    requested = set(names)
    found: dict[str, list[Path]] = {name: [] for name in requested}
    seen: set[Path] = set()
    for root in roots:
        if not root.is_dir():
            continue
        for candidate in root.iterdir():
            if not candidate.is_dir():
                continue
            canonical = _canonical_name(candidate)
            if canonical not in requested or candidate in seen:
                continue
            found[canonical].append(candidate)
            seen.add(candidate)
    return found


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


def _managed_package_is_unedited(
    *, provider: str, name: str, destination: Path, recorded_digest: object
) -> bool:
    """Return whether Ticketry can replace its recorded copy without data loss."""

    try:
        current_digest = tree_digest(destination)
    except (CatalogValidationError, OSError) as exc:
        logger.warning(
            "Ticketry-managed skill %s for %s at %s could not be verified and "
            "will be preserved because it may contain user edits: %s",
            name,
            provider,
            destination,
            exc,
        )
        return False
    if current_digest == recorded_digest:
        return True
    logger.warning(
        "Ticketry-managed skill %s for %s at %s was edited by the user and will "
        "be preserved; its current digest does not match the Ticketry manifest",
        name,
        provider,
        destination,
    )
    return False


def install_packaged_skills(
    *,
    providers: Iterable[str] = SUPPORTED_PROVIDERS,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Path]:
    """Install missing skills and update unedited Ticketry-managed copies."""

    lock = verify_catalog()
    package_names = {package["name"] for package in lock["packages"]}
    providers = tuple(providers)
    environment = os.environ if environ is None else environ
    user_home = Path.home() if home is None else Path(home)

    # A valid existing skill satisfies the requirement regardless of its bytes.
    # Preflight only rejects paths that prevent installation while failing to
    # provide a readable skill with the expected canonical name.
    for provider in providers:
        root = provider_skill_root(provider, home=home, environ=environ)
        available = visible_skill_candidates(
            provider,
            names=package_names,
            home=user_home,
            environ=environment,
        )
        for package in lock["packages"]:
            name = package["name"]
            if available[name]:
                continue
            destination = root / name
            if destination.is_symlink() or (
                destination.exists() and not destination.is_dir()
            ):
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="collision",
                    path=destination,
                    message="Refusing to overwrite a user-owned skill path.",
                )
            if destination.is_dir():
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="invalid",
                    path=destination,
                    message="The existing path does not contain the expected skill.",
                )

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
        available = visible_skill_candidates(
            provider,
            names=package_names,
            home=user_home,
            environ=environment,
        )
        previous = _load_manifest(root).get("packages", {})
        managed = {
            name: digest
            for name, digest in previous.items()
            if (root / name).is_dir() and not (root / name).is_symlink()
        }
        for package in lock["packages"]:
            name = package["name"]
            destination = root / name
            recorded_digest = managed.get(name)
            if recorded_digest is not None and destination in available[name]:
                if not _managed_package_is_unedited(
                    provider=provider,
                    name=name,
                    destination=destination,
                    recorded_digest=recorded_digest,
                ):
                    continue
                if recorded_digest != package["digest"]:
                    source = (catalog_root() / package["path"]).resolve()
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
                            message=f"The managed skill could not be updated: {exc}",
                        ) from exc
                    managed[name] = package["digest"]
                continue
            if available[name]:
                continue
            source = (catalog_root() / package["path"]).resolve()
            if destination.is_symlink() or (
                destination.exists() and not destination.is_dir()
            ):
                raise SkillInstallationError(
                    provider=provider,
                    skill=name,
                    reason="collision",
                    path=destination,
                    message="Refusing to overwrite a user-owned skill path.",
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
                    message=f"The fallback skill could not be installed: {exc}",
                ) from exc
            managed[name] = package["digest"]
        try:
            _write_manifest(
                root,
                provider=provider,
                lock=lock,
                managed_packages=managed,
            )
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
    """Fail unless the provider can discover every requested skill name."""

    lock = verify_catalog()
    packages = {package["name"]: package for package in lock["packages"]}
    required = tuple(packages) if names is None else tuple(names)
    root = provider_skill_root(provider, home=home, environ=environ)
    available = visible_skill_candidates(
        provider,
        names=required,
        home=home,
        environ=environ,
    )
    for name in required:
        if name not in packages:
            raise SkillInstallationError(
                provider=provider,
                skill=name,
                reason="unknown",
                path=root / name,
                message="The requested skill is absent from the packaged catalog.",
            )
        if not available[name]:
            raise SkillInstallationError(
                provider=provider,
                skill=name,
                reason="missing",
                path=root / name,
                message="The required skill is not installed.",
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
        provider: verify_provider_installation(provider, home=home, environ=environ)
        for provider in providers
    }
