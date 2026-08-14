"""Published request and response models for the local configuration API."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ModuleLinkBody(BaseModel):
    module_id: str
    path: str


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    workspace_slug: str
    agent_prompt: Optional[str] = None
    agent_prompts: dict = Field(default_factory=dict)
    module_links: list[ModuleLinkBody] = Field(default_factory=list)
    recent_project_id: Optional[str] = None
    recent_module_ids: dict = Field(default_factory=dict)


class FeaturesBody(BaseModel):
    sidebar: bool
    projects: bool


class ConfigBody(BaseModel):
    recent_profile_index: Optional[int]
    profiles: list[ProfileBody]
    features: FeaturesBody
