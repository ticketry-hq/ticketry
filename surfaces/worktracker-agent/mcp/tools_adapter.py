import logging
from typing import Any, Callable, Iterable, Tuple
import functools
import inspect
from uuid import UUID
from pydantic import BaseModel
from worktracker_agent.api.tools import WorktrackerToolset
from worktracker_agent.api.service import get_worktracker_service


logger = logging.getLogger(__name__)


class _LazyWorktrackerService:
    def __getattr__(self, name: str) -> Any:
        return getattr(get_worktracker_service(), name)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return _normalize_value(value.model_dump(mode="json"))
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_normalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_value(item) for key, item in value.items()}
    return value


def _wrap_worktracker_tool(tool_fn: Callable[..., Any]) -> Callable[..., Any]:
    signature = inspect.signature(tool_fn)

    # Strip the leading ctx parameter from the exposed signature.

    parameters = list(signature.parameters.values())
    if not parameters:
        passthrough_signature = signature
    else:
        passthrough_signature = inspect.Signature(
            parameters=parameters[1:],
            return_annotation=signature.return_annotation,
        )

    @functools.wraps(tool_fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # Pass None as the unused Context.
        result = tool_fn(None, *args, **kwargs)
        return _normalize_value(result)

    wrapper.__signature__ = passthrough_signature  # type: ignore[attr-defined]
    return wrapper


def generate_worktracker_tools() -> Iterable[Tuple[str, Callable[..., Any]]]:
    # Lazy service resolves WORKTRACKER_* env only when a tool is called.
    toolset = WorktrackerToolset(service=_LazyWorktrackerService())

    for name, method in inspect.getmembers(toolset, predicate=inspect.ismethod):
        if name.endswith("_tool"):
            tool_name = name[:-5]
            yield tool_name, _wrap_worktracker_tool(method)
