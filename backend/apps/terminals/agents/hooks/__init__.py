"""Per-agent lifecycle hook scripts (ticket #499 onward).

Each ``<agent>_hook.py`` module here is a thin, stdlib-only entrypoint a coding
agent invokes on its own lifecycle events. The shared stdin -> map -> stamp ->
POST machinery lives in ``_reporter``; each shim only declares a ``HookSpec``
(its event table, identity source, and provider-session key) and hands it to
``_reporter.run``. The reporter normalizes the agent's event to the shared #498
``LifecycleEvent`` shape and posts it to the local ingress.
"""
