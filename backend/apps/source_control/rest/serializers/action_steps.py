"""The wire shape of one stacked-action step.

One serializer, shared by every action on this surface, for the same reason
:mod:`apps.source_control.actions.action_steps` is one module: a client renders the
step list without knowing which action produced it, and two near-identical
step models would let the two endpoints drift into disagreeing about what a
step is.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.source_control.actions.action_steps import STATUSES, STEP_NAMES


class ActionStepSerializer(serializers.Serializer):
    """One step's typed outcome, in the order the steps ran.

    The enums are the whole vocabulary rather than the subset a particular
    action can emit: which steps a given action runs is that action's contract,
    documented on its own response, and narrowing this per endpoint would mean
    a step could not be moved between actions without a schema break.
    """

    name = serializers.ChoiceField(choices=STEP_NAMES)
    status = serializers.ChoiceField(choices=STATUSES)
    detail = serializers.CharField()
