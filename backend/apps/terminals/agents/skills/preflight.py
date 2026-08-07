"""Fail-closed resolution of persistently installed workflow skills."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .catalog import CatalogValidationError, catalog_root, tree_digest, verify_catalog
from .installation import SkillInstallationError, verify_provider_installation


WORKTRACKER_TOOLS = frozenset(
    {
        "get_task_details",
        "update_task",
        "attach_file",
        "create_sub_task",
        "set_task_blockers",
    }
)
_APPROVED_PROVIDER_PATH_ENV = {
    "claude": "MUXED_APPROVED_CLAUDE_PATH",
    "codex": "MUXED_APPROVED_CODEX_PATH",
    "agy": "MUXED_APPROVED_AGY_PATH",
    "gemini": "MUXED_APPROVED_GEMINI_PATH",
}


class RequiredSkillUnavailable(RuntimeError):
    """A stable, structured required-skill launch rejection."""

    def __init__(
        self,
        *,
        provider: str,
        skill: str,
        reason: str,
        message: str,
        conflicting_path: Path | None = None,
    ) -> None:
        self.provider = provider
        self.skill = skill
        self.reason = reason
        self.message = message
        self.conflicting_path = conflicting_path
        self.remediation = self._remediation()
        super().__init__(
            f"required_skill_unavailable: provider={provider} skill={skill} "
            f"reason={reason}: {message} Next action: {self.remediation}"
        )

    def _remediation(self) -> str:
        if self.reason in {"collision", "installation_collision"}:
            location = (
                f" at {self.conflicting_path}"
                if self.conflicting_path is not None
                else ""
            )
            return (
                f"Rename the provider-visible skill{location} or change its declared "
                "name, then retry. Ticketry will not modify user-installed skills."
            )
        if self.reason == "unknown":
            return "Choose a skill from Ticketry's packaged catalog, then retry."
        if self.reason == "tool_unavailable":
            return "Restore the required WorkTracker MCP tools, then retry."
        if self.reason.startswith("installation_"):
            return "Repair Ticketry's packaged provider-skill installation, then retry."
        if self.reason == "provider_unsupported":
            return "Select a supported, up-to-date provider, then retry."
        if self.reason == "catalog_invalid":
            return "Repair or reinstall the Ticketry application, then retry."
        return "Repair the required-skill launch configuration, then retry."

    def as_payload(self) -> dict[str, object]:
        """Return the stable transport contract for an expected rejection."""

        return {
            "code": "required_skill_unavailable",
            "provider": self.provider,
            "skill": self.skill,
            "reason": self.reason,
            "detail": self.message,
            "remediation": self.remediation,
            "retryable": False,
        }


@dataclass(frozen=True)
class ResolvedSkills:
    """Verified catalog packages and facts frozen for one launch."""

    requested: tuple[str, ...]
    packages: tuple[tuple[str, Path], ...]
    required_tools: frozenset[str]
    upstream_revision: str

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(name for name, _ in self.packages)


def _provider_skill_roots(provider: str, cwd: Path) -> tuple[Path, ...]:
    home = Path.home()
    if provider == "claude":
        claude_home = Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
        plugin_root = home / ".claude/plugins"
        plugin_skills = (
            tuple(plugin_root.rglob("skills")) if plugin_root.is_dir() else ()
        )
        return (
            claude_home / "skills",
            cwd / ".claude/skills",
            *plugin_skills,
        )
    if provider == "codex":
        codex_home = Path(os.environ.get("CODEX_HOME", home / ".codex"))
        return (
            codex_home / "skills",
            home / ".agents/skills",
            cwd / ".agents/skills",
            cwd / ".codex/skills",
        )
    if provider == "agy":
        extension_root = home / ".gemini/extensions"
        extension_skills = (
            tuple(extension_root.glob("*/skills")) if extension_root.is_dir() else ()
        )
        return (
            home / ".agents/skills",
            home / ".agy/skills",
            cwd / ".agents/skills",
            cwd / ".agy/skills",
            *extension_skills,
        )
    if provider == "gemini":
        gemini_home = Path(os.environ.get("GEMINI_CLI_HOME", home))
        extension_root = gemini_home / ".gemini/extensions"
        extension_skills = (
            tuple(extension_root.glob("*/skills")) if extension_root.is_dir() else ()
        )
        return (
            gemini_home / ".gemini/skills",
            cwd / ".gemini/skills",
            *extension_skills,
        )
    return ()


def _dependency_closure(
    requested: Iterable[str], packages_by_name: dict[str, dict]
) -> set[str]:
    closure: set[str] = set()
    frontier = list(requested)
    while frontier:
        name = frontier.pop()
        if name in closure:
            continue
        closure.add(name)
        frontier.extend(packages_by_name[name]["dependencies"])
    return closure


def _visible_candidates(root: Path, reserved: set[str]):
    """Yield canonical reserved names advertised below one provider skill root."""

    if not root.is_dir():
        return
    for candidate in root.iterdir():
        if not candidate.is_dir():
            continue
        names = {candidate.name} & reserved
        try:
            contents = (candidate / "SKILL.md").read_text(encoding="utf-8")
            match = re.search(r"(?m)^name:\s*([a-z0-9-]+)\s*$", contents)
            if match and match.group(1) in reserved:
                names.add(match.group(1))
        except OSError:
            pass
        for name in names:
            yield name, candidate


def _version_tuple(value: str) -> tuple[int, int, int] | None:
    match = re.search(r"(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)", value)
    return tuple(map(int, match.groups())) if match else None


def _verify_approved_provider_version(
    provider: str, providers: list[dict], skill: str
) -> None:
    """Verify the desktop-approved executable when discovery supplied one."""

    configured = os.environ.get(_APPROVED_PROVIDER_PATH_ENV[provider])
    if not configured:
        return
    executable = Path(configured)
    minimum = next(
        entry["minimum_tested_version"]
        for entry in providers
        if entry["name"] == provider
    )
    try:
        completed = subprocess.run(
            [str(executable), "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        actual = _version_tuple(f"{completed.stdout}\n{completed.stderr}")
    except (OSError, subprocess.SubprocessError):
        actual = None
    minimum_version = _version_tuple(minimum)
    if minimum_version is None or actual is None or actual < minimum_version:
        raise RequiredSkillUnavailable(
            provider=provider,
            skill=skill,
            reason="provider_unsupported",
            message=f"The approved provider does not satisfy tested minimum {minimum}.",
        )


def resolve_required_skills(
    *,
    provider: str,
    required_skills: Iterable[str],
    cwd: str,
    supports_required_skills: bool,
    available_tools: frozenset[str],
) -> ResolvedSkills:
    """Verify catalog, dependencies, tools, and provider-visible collisions."""

    requested = tuple(required_skills)
    if not requested:
        return ResolvedSkills((), (), frozenset(), "")

    try:
        lock = verify_catalog()
        packages_by_name = {
            package["name"]: package for package in lock["packages"]
        }
        unknown = next((name for name in requested if name not in packages_by_name), None)
        if unknown is not None:
            raise RequiredSkillUnavailable(
                provider=provider,
                skill=unknown,
                reason="unknown",
                message="The launch binding names a skill absent from the packaged catalog.",
            )
        providers = lock["providers"]
        if not supports_required_skills or provider not in {
            entry["name"] for entry in providers
        }:
            raise RequiredSkillUnavailable(
                provider=provider,
                skill=requested[0],
                reason="provider_unsupported",
                message="This provider cannot use Ticketry's installed workflow skills.",
            )
        _verify_approved_provider_version(provider, providers, requested[0])

        closure = _dependency_closure(requested, packages_by_name)
        ordered = tuple(
            (
                package["name"],
                (catalog_root() / package["path"]).resolve(),
            )
            for package in lock["packages"]
            if package["name"] in closure
        )
        required_tools = frozenset(
            tool
            for name in closure
            for tool in packages_by_name[name]["required_mcp_tools"]
        )
        missing_tools = required_tools - available_tools
        if missing_tools:
            raise RequiredSkillUnavailable(
                provider=provider,
                skill=next(
                    name
                    for name in requested
                    if set(packages_by_name[name]["required_mcp_tools"]) & missing_tools
                ),
                reason="tool_unavailable",
                message=f"Required WorkTracker tools are unavailable: {sorted(missing_tools)}.",
            )

        locked_digests = {
            name: packages_by_name[name]["digest"] for name in closure
        }
        for root in _provider_skill_roots(provider, Path(cwd).resolve()):
            for name, candidate in _visible_candidates(root, closure):
                try:
                    identical = candidate.is_dir() and tree_digest(candidate) == locked_digests[name]
                except (OSError, CatalogValidationError):
                    identical = False
                if not identical:
                    raise RequiredSkillUnavailable(
                        provider=provider,
                        skill=name,
                        reason="collision",
                        message=f"A different provider-visible skill already reserves {name!r}.",
                        conflicting_path=candidate,
                    )

        try:
            verify_provider_installation(provider, names=closure)
        except SkillInstallationError as exc:
            raise RequiredSkillUnavailable(
                provider=provider,
                skill=exc.skill,
                reason=f"installation_{exc.reason}",
                message=exc.message,
                conflicting_path=exc.path if exc.reason == "collision" else None,
            ) from exc

        return ResolvedSkills(
            requested=requested,
            packages=ordered,
            required_tools=required_tools,
            upstream_revision=lock["upstream"]["commit"],
        )
    except RequiredSkillUnavailable:
        raise
    except (OSError, KeyError, TypeError, CatalogValidationError) as exc:
        raise RequiredSkillUnavailable(
            provider=provider,
            skill=requested[0],
            reason="catalog_invalid",
            message="The packaged skill catalog failed integrity validation.",
        ) from exc


def skill_prompt_envelope(resolved: ResolvedSkills) -> str:
    """Return the factual application-owned prompt block for a resolved launch."""

    if not resolved.requested:
        return ""
    names = ", ".join(resolved.requested)
    return (
        "Ticketry invocation resources:\n"
        f"- Required skills supplied for this invocation: {names}\n"
        f"- Pinned upstream mattpocock/skills revision: {resolved.upstream_revision}"
    )
