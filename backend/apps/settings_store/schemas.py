"""Published request and response models for the local configuration API."""

from typing import Optional

from pydantic import BaseModel, ConfigDict


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    workspace_slug: str
    agent_prompt: Optional[str] = None
    agent_prompts: dict = {}
    module_folders: dict = {}
    recent_project_id: Optional[str] = None
    recent_module_ids: dict = {}


class FeaturesBody(BaseModel):
    sidebar: bool
    projects: bool


class ConfigBody(BaseModel):
    recent_profile_index: Optional[int]
    profiles: list[ProfileBody]
    features: FeaturesBody
