from __future__ import annotations

from apps.terminals.dao.constants import (
    SCRATCH_TASK_ID as SCRATCH_TASK_ID,
    DOCCHAT_SCOPE as DOCCHAT_SCOPE,
)
from apps.terminals.dao.sessions import (
    insert_terminal_session as insert_terminal_session,
    list_terminal_sessions_for_task as list_terminal_sessions_for_task,
    list_scratch_terminal_sessions as list_scratch_terminal_sessions,
    list_active_terminal_sessions as list_active_terminal_sessions,
    soft_delete_terminal_session as soft_delete_terminal_session,
)
