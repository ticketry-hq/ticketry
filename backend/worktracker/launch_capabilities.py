"""Provider option contract shared by binding validation and agent runtimes.

Capabilities live at the persistence boundary so WorkTracker can reject invalid
policy before storing it. The Studio runtime separately maps the same slugs to
executable adapters; its startup guard detects drift without reversing the
WorkTracker-to-host dependency direction.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderCapabilities:
    slug: str
    supports_unattended: bool = False
    model_prefixes: tuple[str, ...] = ()
    model_aliases: tuple[str, ...] = ()
    accepts_any_model: bool = False
    reasoning_levels: tuple[str, ...] = ()

    @property
    def accepts_model(self) -> bool:
        return self.accepts_any_model or bool(self.model_prefixes or self.model_aliases)

    def accepts(self, model: str) -> bool:
        return (
            self.accepts_any_model
            or model in self.model_aliases
            or model.startswith(self.model_prefixes)
        )


PROVIDER_CAPABILITIES = {
    capability.slug: capability
    for capability in (
        ProviderCapabilities(
            "claude",
            supports_unattended=True,
            model_prefixes=("claude-",),
            model_aliases=("sonnet", "opus", "haiku", "fable"),
            reasoning_levels=("low", "medium", "high", "xhigh", "max"),
        ),
        ProviderCapabilities("agy", supports_unattended=True, accepts_any_model=True),
        ProviderCapabilities(
            "codex",
            supports_unattended=True,
            model_prefixes=("gpt-", "codex-", "chatgpt-", "o1", "o3", "o4"),
            reasoning_levels=("minimal", "low", "medium", "high", "xhigh"),
        ),
        ProviderCapabilities(
            "gemini", supports_unattended=True, model_prefixes=("gemini-",)
        ),
    )
}
