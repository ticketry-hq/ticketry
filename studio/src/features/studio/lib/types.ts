interface ModuleLink {
  module_id: string;
  path: string;
}

export interface Profile {
  name: string;
  workspace_slug: string;
  agent_prompt: string | null;
  agent_prompts: Record<string, string>;
  module_links: ModuleLink[];
  recent_project_id?: string | null;
  recent_module_ids?: Record<string, string>;
}

export interface ConfigPayload {
  recent_profile_index: number | null;
  profiles: Profile[];
  features: {
    sidebar: boolean;
    projects: boolean;
  };
}

export type TaskId = string;
