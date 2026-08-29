export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Json: { input: unknown; output: unknown; }
};

export type AgentRunHolding = {
  __typename?: 'AgentRunHolding';
  agent?: Maybe<Scalars['String']['output']>;
  agent_run_id: Scalars['String']['output'];
  effective_state: Scalars['String']['output'];
  last_output_at?: Maybe<Scalars['String']['output']>;
  launch_model?: Maybe<Scalars['String']['output']>;
  launch_state?: Maybe<Scalars['String']['output']>;
  module_id: Scalars['String']['output'];
  output_sequence: Scalars['Int']['output'];
  project_id: Scalars['String']['output'];
  provider_session_id?: Maybe<Scalars['String']['output']>;
  scope: Scalars['String']['output'];
  started_at: Scalars['String']['output'];
  state: Scalars['String']['output'];
  task_id?: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
};

export type AgentRunViewerLeases = {
  __typename?: 'AgentRunViewerLeases';
  acquiredAt: Scalars['String']['output'];
  agentRun?: Maybe<AgentRuns>;
  agentRunId: Scalars['String']['output'];
  expiresAt: Scalars['String']['output'];
  generation: Scalars['String']['output'];
  transport: Scalars['String']['output'];
  viewerId: Scalars['String']['output'];
};

export type AgentRunViewerLeasesConnection = {
  __typename?: 'AgentRunViewerLeasesConnection';
  edges: Array<AgentRunViewerLeasesEdge>;
  nodes: Array<AgentRunViewerLeases>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type AgentRunViewerLeasesEdge = {
  __typename?: 'AgentRunViewerLeasesEdge';
  cursor: Scalars['String']['output'];
  node: AgentRunViewerLeases;
};

export type AgentRunViewerLeasesFilterInput = {
  acquiredAt?: InputMaybe<StringFilterInput>;
  agentRunId?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<AgentRunViewerLeasesFilterInput>>;
  expiresAt?: InputMaybe<StringFilterInput>;
  generation?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<AgentRunViewerLeasesFilterInput>;
  or?: InputMaybe<Array<AgentRunViewerLeasesFilterInput>>;
  transport?: InputMaybe<StringFilterInput>;
  viewerId?: InputMaybe<StringFilterInput>;
};

export type AgentRunViewerLeasesHavingInput = {
  agentRun?: InputMaybe<AgentRunsFilterInput>;
};

export type AgentRunViewerLeasesOrderInput = {
  acquiredAt?: InputMaybe<OrderByEnum>;
  agentRunId?: InputMaybe<OrderByEnum>;
  expiresAt?: InputMaybe<OrderByEnum>;
  generation?: InputMaybe<OrderByEnum>;
  transport?: InputMaybe<OrderByEnum>;
  viewerId?: InputMaybe<OrderByEnum>;
};

export type AgentRuns = {
  __typename?: 'AgentRuns';
  agent?: Maybe<Scalars['String']['output']>;
  endedAt?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  exitCode?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  issue?: Maybe<WorktrackerIssue>;
  issueId: Scalars['String']['output'];
  launchModel?: Maybe<Scalars['String']['output']>;
  launchState?: Maybe<Scalars['String']['output']>;
  lifecycleState?: Maybe<Scalars['String']['output']>;
  lifecycleUpdatedAt?: Maybe<Scalars['String']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  providerSessionId?: Maybe<Scalars['String']['output']>;
  reasoning?: Maybe<Scalars['String']['output']>;
  resumedFrom?: Maybe<Scalars['String']['output']>;
  scope: Scalars['String']['output'];
  startedAt: Scalars['String']['output'];
  status: Scalars['String']['output'];
  ticketSeq?: Maybe<Scalars['Int']['output']>;
};

export type AgentRunsConnection = {
  __typename?: 'AgentRunsConnection';
  edges: Array<AgentRunsEdge>;
  nodes: Array<AgentRuns>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type AgentRunsEdge = {
  __typename?: 'AgentRunsEdge';
  cursor: Scalars['String']['output'];
  node: AgentRuns;
};

export type AgentRunsFilterInput = {
  agent?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<AgentRunsFilterInput>>;
  endedAt?: InputMaybe<StringFilterInput>;
  error?: InputMaybe<StringFilterInput>;
  exitCode?: InputMaybe<IntegerFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  issueId?: InputMaybe<StringFilterInput>;
  launchModel?: InputMaybe<StringFilterInput>;
  launchState?: InputMaybe<StringFilterInput>;
  lifecycleState?: InputMaybe<StringFilterInput>;
  lifecycleUpdatedAt?: InputMaybe<StringFilterInput>;
  model?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<AgentRunsFilterInput>;
  or?: InputMaybe<Array<AgentRunsFilterInput>>;
  providerSessionId?: InputMaybe<StringFilterInput>;
  reasoning?: InputMaybe<StringFilterInput>;
  resumedFrom?: InputMaybe<StringFilterInput>;
  scope?: InputMaybe<StringFilterInput>;
  startedAt?: InputMaybe<StringFilterInput>;
  status?: InputMaybe<StringFilterInput>;
  ticketSeq?: InputMaybe<IntegerFilterInput>;
};

export type AgentRunsHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type AgentRunsOrderInput = {
  agent?: InputMaybe<OrderByEnum>;
  endedAt?: InputMaybe<OrderByEnum>;
  error?: InputMaybe<OrderByEnum>;
  exitCode?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  issueId?: InputMaybe<OrderByEnum>;
  launchModel?: InputMaybe<OrderByEnum>;
  launchState?: InputMaybe<OrderByEnum>;
  lifecycleState?: InputMaybe<OrderByEnum>;
  lifecycleUpdatedAt?: InputMaybe<OrderByEnum>;
  model?: InputMaybe<OrderByEnum>;
  providerSessionId?: InputMaybe<OrderByEnum>;
  reasoning?: InputMaybe<OrderByEnum>;
  resumedFrom?: InputMaybe<OrderByEnum>;
  scope?: InputMaybe<OrderByEnum>;
  startedAt?: InputMaybe<OrderByEnum>;
  status?: InputMaybe<OrderByEnum>;
  ticketSeq?: InputMaybe<OrderByEnum>;
};

export type AgentTerminalSessions = {
  __typename?: 'AgentTerminalSessions';
  agent?: Maybe<Scalars['String']['output']>;
  agentRun?: Maybe<AgentRuns>;
  agentRunId: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  docRelPath?: Maybe<Scalars['String']['output']>;
  moduleId: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  taskId: Scalars['String']['output'];
  terminatedAt?: Maybe<Scalars['String']['output']>;
};

export type AgentTerminalSessionsConnection = {
  __typename?: 'AgentTerminalSessionsConnection';
  edges: Array<AgentTerminalSessionsEdge>;
  nodes: Array<AgentTerminalSessions>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type AgentTerminalSessionsEdge = {
  __typename?: 'AgentTerminalSessionsEdge';
  cursor: Scalars['String']['output'];
  node: AgentTerminalSessions;
};

export type AgentTerminalSessionsFilterInput = {
  agent?: InputMaybe<StringFilterInput>;
  agentRunId?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<AgentTerminalSessionsFilterInput>>;
  createdAt?: InputMaybe<StringFilterInput>;
  docRelPath?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<AgentTerminalSessionsFilterInput>;
  or?: InputMaybe<Array<AgentTerminalSessionsFilterInput>>;
  projectId?: InputMaybe<StringFilterInput>;
  scope?: InputMaybe<StringFilterInput>;
  taskId?: InputMaybe<StringFilterInput>;
  terminatedAt?: InputMaybe<StringFilterInput>;
};

export type AgentTerminalSessionsHavingInput = {
  agentRun?: InputMaybe<AgentRunsFilterInput>;
};

export type AgentTerminalSessionsOrderInput = {
  agent?: InputMaybe<OrderByEnum>;
  agentRunId?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  docRelPath?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  scope?: InputMaybe<OrderByEnum>;
  taskId?: InputMaybe<OrderByEnum>;
  terminatedAt?: InputMaybe<OrderByEnum>;
};

export type AutomationAttemptProjection = {
  __typename?: 'AutomationAttemptProjection';
  agent_run_id?: Maybe<Scalars['String']['output']>;
  attempt_id: Scalars['String']['output'];
  error?: Maybe<Scalars['String']['output']>;
  failure?: Maybe<Scalars['Json']['output']>;
  retry_of_attempt_id?: Maybe<Scalars['String']['output']>;
  retryable: Scalars['Boolean']['output'];
  root_attempt_id: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updated_at: Scalars['String']['output'];
  work_item_id: Scalars['String']['output'];
};

export type BooleanFilterInput = {
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  is_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  ne?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CursorInput = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit: Scalars['Int']['input'];
};

export type DesignDocuments = {
  __typename?: 'DesignDocuments';
  contentDigest?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  moduleId: Scalars['String']['output'];
  relPath: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  taskId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type DesignDocumentsConnection = {
  __typename?: 'DesignDocumentsConnection';
  edges: Array<DesignDocumentsEdge>;
  nodes: Array<DesignDocuments>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type DesignDocumentsEdge = {
  __typename?: 'DesignDocumentsEdge';
  cursor: Scalars['String']['output'];
  node: DesignDocuments;
};

export type DesignDocumentsFilterInput = {
  and?: InputMaybe<Array<DesignDocumentsFilterInput>>;
  contentDigest?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<DesignDocumentsFilterInput>;
  or?: InputMaybe<Array<DesignDocumentsFilterInput>>;
  relPath?: InputMaybe<StringFilterInput>;
  scope?: InputMaybe<StringFilterInput>;
  taskId?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<StringFilterInput>;
};

export type DesignDocumentsHavingInput = {
  _?: InputMaybe<Scalars['Boolean']['input']>;
};

export type DesignDocumentsOrderInput = {
  contentDigest?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  relPath?: InputMaybe<OrderByEnum>;
  scope?: InputMaybe<OrderByEnum>;
  taskId?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type DocumentSaveOutcome = {
  __typename?: 'DocumentSaveOutcome';
  digest: Scalars['String']['output'];
  document_id: Scalars['String']['output'];
  saved: Scalars['Boolean']['output'];
  stale: Scalars['Boolean']['output'];
};

export type FloatFilterInput = {
  between?: InputMaybe<Array<Scalars['Float']['input']>>;
  eq?: InputMaybe<Scalars['Float']['input']>;
  gt?: InputMaybe<Scalars['Float']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  is_in?: InputMaybe<Array<Scalars['Float']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['Float']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['Float']['input']>;
  lte?: InputMaybe<Scalars['Float']['input']>;
  ne?: InputMaybe<Scalars['Float']['input']>;
  not_between?: InputMaybe<Array<Scalars['Float']['input']>>;
};

export type GlobalLaunchDefault = {
  __typename?: 'GlobalLaunchDefault';
  model?: Maybe<Scalars['String']['output']>;
  provider: Scalars['String']['output'];
  reasoning?: Maybe<Scalars['String']['output']>;
};

export type GraphRunDeletePayload = {
  __typename?: 'GraphRunDeletePayload';
  cleared_child_ids: Array<Scalars['String']['output']>;
  graph_run: GraphRuns;
};

export type GraphRunMutationPayload = {
  __typename?: 'GraphRunMutationPayload';
  graph_run: GraphRuns;
  prepared_child_ids: Array<Scalars['String']['output']>;
};

export type GraphRuns = {
  __typename?: 'GraphRuns';
  agent?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  executionMode: Scalars['String']['output'];
  module?: Maybe<WorktrackerIssue>;
  moduleId?: Maybe<Scalars['String']['output']>;
  project?: Maybe<WorktrackerProject>;
  projectId: Scalars['String']['output'];
  root?: Maybe<WorktrackerIssue>;
  rootId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type GraphRunsConnection = {
  __typename?: 'GraphRunsConnection';
  edges: Array<GraphRunsEdge>;
  nodes: Array<GraphRuns>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type GraphRunsEdge = {
  __typename?: 'GraphRunsEdge';
  cursor: Scalars['String']['output'];
  node: GraphRuns;
};

export type GraphRunsFilterInput = {
  agent?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<GraphRunsFilterInput>>;
  createdAt?: InputMaybe<TextFilterInput>;
  executionMode?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<GraphRunsFilterInput>;
  or?: InputMaybe<Array<GraphRunsFilterInput>>;
  projectId?: InputMaybe<StringFilterInput>;
  rootId?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
};

export type GraphRunsHavingInput = {
  module?: InputMaybe<WorktrackerIssueFilterInput>;
  project?: InputMaybe<WorktrackerProjectFilterInput>;
  root?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type GraphRunsOrderInput = {
  agent?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  executionMode?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  rootId?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type IdentityFilterInput = {
  between?: InputMaybe<Array<Scalars['String']['input']>>;
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  is_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  not_between?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type IntegerFilterInput = {
  between?: InputMaybe<Array<Scalars['Int']['input']>>;
  eq?: InputMaybe<Scalars['Int']['input']>;
  gt?: InputMaybe<Scalars['Int']['input']>;
  gte?: InputMaybe<Scalars['Int']['input']>;
  is_in?: InputMaybe<Array<Scalars['Int']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['Int']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['Int']['input']>;
  lte?: InputMaybe<Scalars['Int']['input']>;
  ne?: InputMaybe<Scalars['Int']['input']>;
  not_between?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type JsonFilterInput = {
  eq?: InputMaybe<Scalars['Json']['input']>;
  ne?: InputMaybe<Scalars['Json']['input']>;
};

export type KeybindingSetting = {
  __typename?: 'KeybindingSetting';
  key: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  updated_at: Scalars['String']['output'];
  value: Scalars['Json']['output'];
};

export type LifecycleAccepted = {
  __typename?: 'LifecycleAccepted';
  accepted: Scalars['Boolean']['output'];
  applied: Scalars['Boolean']['output'];
  event_cursor?: Maybe<Scalars['Int']['output']>;
  known_run: Scalars['Boolean']['output'];
  occurred_at: Scalars['String']['output'];
  state?: Maybe<Scalars['String']['output']>;
};

export type MigrationProbes = {
  __typename?: 'MigrationProbes';
  id: Scalars['Int']['output'];
  value: Scalars['String']['output'];
};

export type MigrationProbesBasic = {
  __typename?: 'MigrationProbesBasic';
  id: Scalars['Int']['output'];
  value: Scalars['String']['output'];
};

export type MigrationProbesConnection = {
  __typename?: 'MigrationProbesConnection';
  edges: Array<MigrationProbesEdge>;
  nodes: Array<MigrationProbes>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type MigrationProbesEdge = {
  __typename?: 'MigrationProbesEdge';
  cursor: Scalars['String']['output'];
  node: MigrationProbes;
};

export type MigrationProbesFilterInput = {
  and?: InputMaybe<Array<MigrationProbesFilterInput>>;
  id?: InputMaybe<IntegerFilterInput>;
  not?: InputMaybe<MigrationProbesFilterInput>;
  or?: InputMaybe<Array<MigrationProbesFilterInput>>;
  value?: InputMaybe<StringFilterInput>;
};

export type MigrationProbesHavingInput = {
  _?: InputMaybe<Scalars['Boolean']['input']>;
};

export type MigrationProbesInsertInput = {
  id: Scalars['Int']['input'];
  value: Scalars['String']['input'];
};

export type MigrationProbesOrderInput = {
  id?: InputMaybe<OrderByEnum>;
  value?: InputMaybe<OrderByEnum>;
};

export type ModuleLinkPathInput = {
  path: Scalars['String']['input'];
};

export type ModuleLinks = {
  __typename?: 'ModuleLinks';
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  issue?: Maybe<WorktrackerIssue>;
  moduleId: Scalars['String']['output'];
  path: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type ModuleLinksConnection = {
  __typename?: 'ModuleLinksConnection';
  edges: Array<ModuleLinksEdge>;
  nodes: Array<ModuleLinks>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type ModuleLinksEdge = {
  __typename?: 'ModuleLinksEdge';
  cursor: Scalars['String']['output'];
  node: ModuleLinks;
};

export type ModuleLinksFilterInput = {
  and?: InputMaybe<Array<ModuleLinksFilterInput>>;
  createdAt?: InputMaybe<TextFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ModuleLinksFilterInput>;
  or?: InputMaybe<Array<ModuleLinksFilterInput>>;
  path?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
};

export type ModuleLinksHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type ModuleLinksOrderInput = {
  createdAt?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  path?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type Mutation = {
  __typename?: 'Mutation';
  acknowledge_onboarding: WorktrackerProject;
  clear_module_link: Scalars['Boolean']['output'];
  create_issue_type_transition: WorktrackerIssuetypetransition;
  create_project: WorktrackerProject;
  create_state: WorktrackerState;
  create_viewer_lease: AgentRunViewerLeases;
  create_work_item: WorktrackerIssue;
  delete_issue_type: Scalars['Boolean']['output'];
  delete_issue_type_transition: Scalars['Boolean']['output'];
  delete_project: Scalars['Boolean']['output'];
  delete_state: Scalars['Boolean']['output'];
  delete_viewer_lease?: Maybe<AgentRunViewerLeases>;
  delete_work_item: Scalars['Boolean']['output'];
  dismiss_automation_attempt: AutomationAttemptProjection;
  graph_run_create: GraphRunMutationPayload;
  graph_run_delete: GraphRunDeletePayload;
  graph_run_update: GraphRunMutationPayload;
  ingest_agent_lifecycle: LifecycleAccepted;
  migrationProbesCreateOne: MigrationProbesBasic;
  refresh_scratch_document_registry: Array<DesignDocuments>;
  refresh_task_document_registry: Array<DesignDocuments>;
  remove_state_from_issue_type_workflow: Scalars['Boolean']['output'];
  reorder_issue_types: Array<WorktrackerIssuetype>;
  reorder_module_presentation: WorktrackerModulepresentation;
  reorder_states: Array<WorktrackerState>;
  reorder_work_item: WorktrackerIssue;
  retry_automation_attempt: AutomationAttemptProjection;
  run_now: RunNowPayload;
  save_design_document: DocumentSaveOutcome;
  set_module_link: ModuleLinks;
  terminal_output_observe: TerminalOutputObservation;
  terminal_session_create: AgentTerminalSessions;
  terminal_session_update: AgentTerminalSessions;
  update_issue_type: WorktrackerIssuetype;
  update_issue_type_transition: WorktrackerIssuetypetransition;
  update_keybinding_setting: KeybindingSetting;
  update_module_presentation: WorktrackerModulepresentation;
  update_project: WorktrackerProject;
  update_provider_catalog: ProviderCatalog;
  update_state: WorktrackerState;
  update_viewer_lease: AgentRunViewerLeases;
  update_work_item: WorktrackerIssue;
  upsert_issue_type_launch_binding: WorktrackerLaunchbinding;
  worktrackerIssuetypeCreateOne: WorktrackerIssuetypeBasic;
  worktree_create: WorktreeStatusView;
  worktree_discard: WorktreeDiscardResult;
};


export type MutationAcknowledge_OnboardingArgs = {
  project_id: Scalars['String']['input'];
};


export type MutationClear_Module_LinkArgs = {
  module_id: Scalars['String']['input'];
};


export type MutationCreate_Issue_Type_TransitionArgs = {
  agent_allowed: Scalars['Boolean']['input'];
  from_state_id: Scalars['String']['input'];
  issue_type_id: Scalars['String']['input'];
  to_state_id: Scalars['String']['input'];
  workflow_revision: Scalars['Int']['input'];
};


export type MutationCreate_ProjectArgs = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  slug: Scalars['String']['input'];
};


export type MutationCreate_StateArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  group: Scalars['String']['input'];
  name: Scalars['String']['input'];
  project_id: Scalars['String']['input'];
};


export type MutationCreate_Viewer_LeaseArgs = {
  agent_run_id: Scalars['String']['input'];
  transport: Scalars['String']['input'];
  viewer_id: Scalars['String']['input'];
};


export type MutationCreate_Work_ItemArgs = {
  description?: InputMaybe<Scalars['String']['input']>;
  issue_type_id: Scalars['String']['input'];
  name: Scalars['String']['input'];
  parent_id?: InputMaybe<Scalars['String']['input']>;
  project_id: Scalars['String']['input'];
  state_id?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDelete_Issue_TypeArgs = {
  id: Scalars['String']['input'];
  reassign_to?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDelete_Issue_Type_TransitionArgs = {
  from_state_id: Scalars['String']['input'];
  issue_type_id: Scalars['String']['input'];
  to_state_id: Scalars['String']['input'];
  workflow_revision: Scalars['Int']['input'];
};


export type MutationDelete_ProjectArgs = {
  id: Scalars['String']['input'];
};


export type MutationDelete_StateArgs = {
  state_id: Scalars['String']['input'];
};


export type MutationDelete_Viewer_LeaseArgs = {
  agent_run_id: Scalars['String']['input'];
  generation: Scalars['String']['input'];
  viewer_id: Scalars['String']['input'];
};


export type MutationDelete_Work_ItemArgs = {
  id: Scalars['String']['input'];
};


export type MutationDismiss_Automation_AttemptArgs = {
  attempt_id: Scalars['String']['input'];
};


export type MutationGraph_Run_CreateArgs = {
  execution_mode?: InputMaybe<Scalars['String']['input']>;
  root_id: Scalars['String']['input'];
};


export type MutationGraph_Run_DeleteArgs = {
  root_id: Scalars['String']['input'];
};


export type MutationGraph_Run_UpdateArgs = {
  execution_mode?: InputMaybe<Scalars['String']['input']>;
  root_id: Scalars['String']['input'];
};


export type MutationIngest_Agent_LifecycleArgs = {
  agent_run_id: Scalars['String']['input'];
  kind: Scalars['String']['input'];
  occurred_at: Scalars['String']['input'];
  provider_session_id?: InputMaybe<Scalars['String']['input']>;
};


export type MutationMigrationProbesCreateOneArgs = {
  data: MigrationProbesInsertInput;
};


export type MutationRefresh_Scratch_Document_RegistryArgs = {
  module_id: Scalars['String']['input'];
};


export type MutationRefresh_Task_Document_RegistryArgs = {
  module_id?: InputMaybe<Scalars['String']['input']>;
  project_id?: InputMaybe<Scalars['String']['input']>;
  task_id: Scalars['String']['input'];
};


export type MutationRemove_State_From_Issue_Type_WorkflowArgs = {
  issue_type_id: Scalars['String']['input'];
  state_id: Scalars['String']['input'];
  workflow_revision: Scalars['Int']['input'];
};


export type MutationReorder_Issue_TypesArgs = {
  ordered_ids: Array<Scalars['String']['input']>;
  project_id: Scalars['String']['input'];
};


export type MutationReorder_Module_PresentationArgs = {
  after_id?: InputMaybe<Scalars['String']['input']>;
  before_id?: InputMaybe<Scalars['String']['input']>;
  initial_order_ids?: InputMaybe<Array<Scalars['String']['input']>>;
  module_id: Scalars['String']['input'];
};


export type MutationReorder_StatesArgs = {
  ordered_ids: Array<Scalars['String']['input']>;
  project_id: Scalars['String']['input'];
};


export type MutationReorder_Work_ItemArgs = {
  after_id?: InputMaybe<Scalars['String']['input']>;
  before_id?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  initial_order_ids?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type MutationRetry_Automation_AttemptArgs = {
  attempt_id: Scalars['String']['input'];
};


export type MutationRun_NowArgs = {
  id_or_key: Scalars['String']['input'];
  request_identity: Scalars['String']['input'];
};


export type MutationSave_Design_DocumentArgs = {
  content: Scalars['String']['input'];
  document_id: Scalars['String']['input'];
  expected_digest: Scalars['String']['input'];
  operation_id: Scalars['String']['input'];
};


export type MutationSet_Module_LinkArgs = {
  link: ModuleLinkPathInput;
  module_id: Scalars['String']['input'];
};


export type MutationTerminal_Output_ObserveArgs = {
  agent_run_id: Scalars['String']['input'];
};


export type MutationTerminal_Session_CreateArgs = {
  automation_attempt_id?: InputMaybe<Scalars['String']['input']>;
  client_request_id: Scalars['String']['input'];
  columns: Scalars['Int']['input'];
  design_directory_identity?: InputMaybe<Scalars['String']['input']>;
  document_relative_path?: InputMaybe<Scalars['String']['input']>;
  issue_id?: InputMaybe<Scalars['String']['input']>;
  kind: Scalars['String']['input'];
  model?: InputMaybe<Scalars['String']['input']>;
  module_id: Scalars['String']['input'];
  policy_reference?: InputMaybe<Scalars['String']['input']>;
  project_id?: InputMaybe<Scalars['String']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  provider?: InputMaybe<Scalars['String']['input']>;
  reasoning?: InputMaybe<Scalars['String']['input']>;
  required_skills?: InputMaybe<Array<Scalars['String']['input']>>;
  resume_from_agent_run_id?: InputMaybe<Scalars['String']['input']>;
  rows: Scalars['Int']['input'];
  target_id?: InputMaybe<Scalars['String']['input']>;
  working_directory_identity?: InputMaybe<Scalars['String']['input']>;
};


export type MutationTerminal_Session_UpdateArgs = {
  agent_run_id: Scalars['String']['input'];
  termination_request_id?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdate_Issue_TypeArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  sort_order?: InputMaybe<Scalars['Int']['input']>;
  start_state_id?: InputMaybe<Scalars['String']['input']>;
  workflow_revision?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationUpdate_Issue_Type_TransitionArgs = {
  agent_allowed: Scalars['Boolean']['input'];
  from_state_id: Scalars['String']['input'];
  issue_type_id: Scalars['String']['input'];
  to_state_id: Scalars['String']['input'];
  workflow_revision: Scalars['Int']['input'];
};


export type MutationUpdate_Keybinding_SettingArgs = {
  value: Scalars['Json']['input'];
};


export type MutationUpdate_Module_PresentationArgs = {
  module_id: Scalars['String']['input'];
  tab_hidden: Scalars['Boolean']['input'];
};


export type MutationUpdate_ProjectArgs = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdate_Provider_CatalogArgs = {
  activated_providers: Array<Scalars['String']['input']>;
  default_model?: InputMaybe<Scalars['String']['input']>;
  default_provider?: InputMaybe<Scalars['String']['input']>;
  default_reasoning?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdate_StateArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  group?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  sort_order?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationUpdate_Viewer_LeaseArgs = {
  agent_run_id: Scalars['String']['input'];
  generation: Scalars['String']['input'];
  viewer_id: Scalars['String']['input'];
};


export type MutationUpdate_Work_ItemArgs = {
  blocked_by_ids?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  issue_type_id?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  parent_id?: InputMaybe<Scalars['String']['input']>;
  state_id?: InputMaybe<Scalars['String']['input']>;
  workspace_tab_order?: InputMaybe<Scalars['Json']['input']>;
};


export type MutationUpsert_Issue_Type_Launch_BindingArgs = {
  auto_start?: InputMaybe<Scalars['Boolean']['input']>;
  issue_type_id: Scalars['String']['input'];
  model_id?: InputMaybe<Scalars['String']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  reasoning_id?: InputMaybe<Scalars['String']['input']>;
  required_skills?: InputMaybe<Array<Scalars['String']['input']>>;
  state_id: Scalars['String']['input'];
  subtree_run_enabled?: InputMaybe<Scalars['Boolean']['input']>;
  workflow_revision: Scalars['Int']['input'];
};


export type MutationWorktrackerIssuetypeCreateOneArgs = {
  data: WorktrackerIssuetypeInsertInput;
};


export type MutationWorktree_CreateArgs = {
  operation_id: Scalars['String']['input'];
  task_id: Scalars['String']['input'];
};


export type MutationWorktree_DiscardArgs = {
  operation_id: Scalars['String']['input'];
  task_id: Scalars['String']['input'];
};

export type OffsetInput = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};

export type OrderByEnum =
  | 'ASC'
  | 'DESC';

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PageInput = {
  limit: Scalars['Int']['input'];
  page: Scalars['Int']['input'];
};

export type PaginationInfo = {
  __typename?: 'PaginationInfo';
  current: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  pages: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type PaginationInput =
  { cursor: CursorInput; offset?: never; page?: never; }
  |  { cursor?: never; offset: OffsetInput; page?: never; }
  |  { cursor?: never; offset?: never; page: PageInput; };

export type ProviderCatalog = {
  __typename?: 'ProviderCatalog';
  agent_models: Array<WorktrackerAgentmodel>;
  configurable_providers: Array<WorktrackerProvider>;
  global_default?: Maybe<GlobalLaunchDefault>;
  providers: Array<WorktrackerProvider>;
  reasoning_levels: Array<WorktrackerReasoninglevel>;
};

export type Query = {
  __typename?: 'Query';
  agentRunViewerLeases: AgentRunViewerLeasesConnection;
  agentRuns: AgentRunsConnection;
  agentTerminalSessions: AgentTerminalSessionsConnection;
  agent_run_holdings: Array<AgentRunHolding>;
  automation_attempts: Array<AutomationAttemptProjection>;
  designDocuments: DesignDocumentsConnection;
  directory_completions: Array<Scalars['String']['output']>;
  graphRuns: GraphRunsConnection;
  keybinding_setting?: Maybe<KeybindingSetting>;
  migrationProbes: MigrationProbesConnection;
  moduleLinks: ModuleLinksConnection;
  provider_catalog: ProviderCatalog;
  resumable_terminal_sessions: Array<AgentRuns>;
  worktrackerAgentmodel: WorktrackerAgentmodelConnection;
  worktrackerAgentmodelreasoninglevel: WorktrackerAgentmodelreasoninglevelConnection;
  worktrackerAttachment: WorktrackerAttachmentConnection;
  worktrackerIssue: WorktrackerIssueConnection;
  worktrackerIssueBlockedBy: WorktrackerIssueBlockedByConnection;
  worktrackerIssuetype: WorktrackerIssuetypeConnection;
  worktrackerIssuetypetransition: WorktrackerIssuetypetransitionConnection;
  worktrackerLaunchbinding: WorktrackerLaunchbindingConnection;
  worktrackerModulepresentation: WorktrackerModulepresentationConnection;
  worktrackerProject: WorktrackerProjectConnection;
  worktrackerProvider: WorktrackerProviderConnection;
  worktrackerReasoninglevel: WorktrackerReasoninglevelConnection;
  worktrackerState: WorktrackerStateConnection;
  worktree_status: WorktreeStatusView;
  worktrees: WorktreesConnection;
};


export type QueryAgentRunViewerLeasesArgs = {
  filters?: InputMaybe<AgentRunViewerLeasesFilterInput>;
  having?: InputMaybe<AgentRunViewerLeasesHavingInput>;
  orderBy?: InputMaybe<AgentRunViewerLeasesOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryAgentRunsArgs = {
  filters?: InputMaybe<AgentRunsFilterInput>;
  having?: InputMaybe<AgentRunsHavingInput>;
  orderBy?: InputMaybe<AgentRunsOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryAgentTerminalSessionsArgs = {
  filters?: InputMaybe<AgentTerminalSessionsFilterInput>;
  having?: InputMaybe<AgentTerminalSessionsHavingInput>;
  orderBy?: InputMaybe<AgentTerminalSessionsOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryAgent_Run_HoldingsArgs = {
  project_id: Scalars['String']['input'];
  task_id?: InputMaybe<Scalars['String']['input']>;
};


export type QueryAutomation_AttemptsArgs = {
  project_id: Scalars['String']['input'];
  task_id?: InputMaybe<Scalars['String']['input']>;
};


export type QueryDesignDocumentsArgs = {
  filters?: InputMaybe<DesignDocumentsFilterInput>;
  having?: InputMaybe<DesignDocumentsHavingInput>;
  orderBy?: InputMaybe<DesignDocumentsOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryDirectory_CompletionsArgs = {
  path: Scalars['String']['input'];
};


export type QueryGraphRunsArgs = {
  filters?: InputMaybe<GraphRunsFilterInput>;
  having?: InputMaybe<GraphRunsHavingInput>;
  orderBy?: InputMaybe<GraphRunsOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryMigrationProbesArgs = {
  filters?: InputMaybe<MigrationProbesFilterInput>;
  having?: InputMaybe<MigrationProbesHavingInput>;
  orderBy?: InputMaybe<MigrationProbesOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryModuleLinksArgs = {
  filters?: InputMaybe<ModuleLinksFilterInput>;
  having?: InputMaybe<ModuleLinksHavingInput>;
  orderBy?: InputMaybe<ModuleLinksOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryResumable_Terminal_SessionsArgs = {
  module_id?: InputMaybe<Scalars['String']['input']>;
  project_id?: InputMaybe<Scalars['String']['input']>;
  task_id?: InputMaybe<Scalars['String']['input']>;
};


export type QueryWorktrackerAgentmodelArgs = {
  filters?: InputMaybe<WorktrackerAgentmodelFilterInput>;
  having?: InputMaybe<WorktrackerAgentmodelHavingInput>;
  orderBy?: InputMaybe<WorktrackerAgentmodelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerAgentmodelreasoninglevelArgs = {
  filters?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  having?: InputMaybe<WorktrackerAgentmodelreasoninglevelHavingInput>;
  orderBy?: InputMaybe<WorktrackerAgentmodelreasoninglevelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerAttachmentArgs = {
  filters?: InputMaybe<WorktrackerAttachmentFilterInput>;
  having?: InputMaybe<WorktrackerAttachmentHavingInput>;
  orderBy?: InputMaybe<WorktrackerAttachmentOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerIssueArgs = {
  filters?: InputMaybe<WorktrackerIssueFilterInput>;
  having?: InputMaybe<WorktrackerIssueHavingInput>;
  orderBy?: InputMaybe<WorktrackerIssueOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerIssueBlockedByArgs = {
  filters?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  having?: InputMaybe<WorktrackerIssueBlockedByHavingInput>;
  orderBy?: InputMaybe<WorktrackerIssueBlockedByOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerIssuetypeArgs = {
  filters?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  having?: InputMaybe<WorktrackerIssuetypeHavingInput>;
  orderBy?: InputMaybe<WorktrackerIssuetypeOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerIssuetypetransitionArgs = {
  filters?: InputMaybe<WorktrackerIssuetypetransitionFilterInput>;
  having?: InputMaybe<WorktrackerIssuetypetransitionHavingInput>;
  orderBy?: InputMaybe<WorktrackerIssuetypetransitionOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerLaunchbindingArgs = {
  filters?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  having?: InputMaybe<WorktrackerLaunchbindingHavingInput>;
  orderBy?: InputMaybe<WorktrackerLaunchbindingOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerModulepresentationArgs = {
  filters?: InputMaybe<WorktrackerModulepresentationFilterInput>;
  having?: InputMaybe<WorktrackerModulepresentationHavingInput>;
  orderBy?: InputMaybe<WorktrackerModulepresentationOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerProjectArgs = {
  filters?: InputMaybe<WorktrackerProjectFilterInput>;
  having?: InputMaybe<WorktrackerProjectHavingInput>;
  orderBy?: InputMaybe<WorktrackerProjectOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerProviderArgs = {
  filters?: InputMaybe<WorktrackerProviderFilterInput>;
  having?: InputMaybe<WorktrackerProviderHavingInput>;
  orderBy?: InputMaybe<WorktrackerProviderOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerReasoninglevelArgs = {
  filters?: InputMaybe<WorktrackerReasoninglevelFilterInput>;
  having?: InputMaybe<WorktrackerReasoninglevelHavingInput>;
  orderBy?: InputMaybe<WorktrackerReasoninglevelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktrackerStateArgs = {
  filters?: InputMaybe<WorktrackerStateFilterInput>;
  having?: InputMaybe<WorktrackerStateHavingInput>;
  orderBy?: InputMaybe<WorktrackerStateOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type QueryWorktree_StatusArgs = {
  task_id: Scalars['String']['input'];
};


export type QueryWorktreesArgs = {
  filters?: InputMaybe<WorktreesFilterInput>;
  having?: InputMaybe<WorktreesHavingInput>;
  orderBy?: InputMaybe<WorktreesOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type RunNowPayload = {
  __typename?: 'RunNowPayload';
  code: Scalars['String']['output'];
  committed_state?: Maybe<RunNowStatePayload>;
  detail: Scalars['String']['output'];
  remedy?: Maybe<Scalars['String']['output']>;
  run?: Maybe<RunNowRunPayload>;
  target_id: Scalars['String']['output'];
};

export type RunNowRunPayload = {
  __typename?: 'RunNowRunPayload';
  agent: Scalars['String']['output'];
  agent_run_id: Scalars['String']['output'];
  target_id: Scalars['String']['output'];
};

export type RunNowStatePayload = {
  __typename?: 'RunNowStatePayload';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type RunStatusCaughtUp = {
  __typename?: 'RunStatusCaughtUp';
  cursor: Scalars['Int']['output'];
  project_id: Scalars['String']['output'];
};

export type RunStatusEvent = {
  __typename?: 'RunStatusEvent';
  agent_run_id?: Maybe<Scalars['String']['output']>;
  automation_attempt_id?: Maybe<Scalars['String']['output']>;
  committed_at: Scalars['String']['output'];
  cursor: Scalars['Int']['output'];
  event_id: Scalars['String']['output'];
  event_kind: Scalars['String']['output'];
  payload: Scalars['Json']['output'];
  payload_version: Scalars['Int']['output'];
  project_id: Scalars['String']['output'];
  subject_id: Scalars['String']['output'];
  subject_kind: Scalars['String']['output'];
  work_item_id?: Maybe<Scalars['String']['output']>;
};

export type RunStatusFailed = {
  __typename?: 'RunStatusFailed';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type RunStatusFrame = RunStatusCaughtUp | RunStatusEvent | RunStatusFailed | RunStatusResetRequired | RunStatusSnapshot;

export type RunStatusResetRequired = {
  __typename?: 'RunStatusResetRequired';
  cursor: Scalars['Int']['output'];
  project_id: Scalars['String']['output'];
  reason: Scalars['String']['output'];
};

export type RunStatusSnapshot = {
  __typename?: 'RunStatusSnapshot';
  at: Scalars['String']['output'];
  automation_attempts: Array<AutomationAttemptProjection>;
  cursor: Scalars['Int']['output'];
  project_id: Scalars['String']['output'];
  runs: Array<AgentRunHolding>;
};

export type StringFilterInput = {
  between?: InputMaybe<Array<Scalars['String']['input']>>;
  ci_eq?: InputMaybe<Scalars['String']['input']>;
  contains?: InputMaybe<Scalars['String']['input']>;
  ends_with?: InputMaybe<Scalars['String']['input']>;
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  is_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  not_between?: InputMaybe<Array<Scalars['String']['input']>>;
  not_like?: InputMaybe<Scalars['String']['input']>;
  starts_with?: InputMaybe<Scalars['String']['input']>;
};

export type Subscription = {
  __typename?: 'Subscription';
  run_status_stream: RunStatusFrame;
};


export type SubscriptionRun_Status_StreamArgs = {
  after_cursor?: InputMaybe<Scalars['Int']['input']>;
  project_id: Scalars['String']['input'];
};

export type TerminalOutputObservation = {
  __typename?: 'TerminalOutputObservation';
  advanced: Scalars['Boolean']['output'];
  last_output_at?: Maybe<Scalars['String']['output']>;
  output_sequence: Scalars['Int']['output'];
};

export type TextFilterInput = {
  between?: InputMaybe<Array<Scalars['String']['input']>>;
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  is_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  is_null?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  not_between?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type WorktrackerAgentmodel = {
  __typename?: 'WorktrackerAgentmodel';
  agentModelReasoningLevel: WorktrackerAgentmodelreasoninglevelConnection;
  id: Scalars['String']['output'];
  launchBinding: WorktrackerLaunchbindingConnection;
  name: Scalars['String']['output'];
  provider?: Maybe<WorktrackerProvider>;
  providerId: Scalars['String']['output'];
};


export type WorktrackerAgentmodelAgentModelReasoningLevelArgs = {
  filters?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  orderBy?: InputMaybe<WorktrackerAgentmodelreasoninglevelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerAgentmodelLaunchBindingArgs = {
  filters?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  orderBy?: InputMaybe<WorktrackerLaunchbindingOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerAgentmodelConnection = {
  __typename?: 'WorktrackerAgentmodelConnection';
  edges: Array<WorktrackerAgentmodelEdge>;
  nodes: Array<WorktrackerAgentmodel>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerAgentmodelEdge = {
  __typename?: 'WorktrackerAgentmodelEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerAgentmodel;
};

export type WorktrackerAgentmodelFilterInput = {
  and?: InputMaybe<Array<WorktrackerAgentmodelFilterInput>>;
  id?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerAgentmodelFilterInput>;
  or?: InputMaybe<Array<WorktrackerAgentmodelFilterInput>>;
  providerId?: InputMaybe<StringFilterInput>;
};

export type WorktrackerAgentmodelHavingInput = {
  agentModelReasoningLevel?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  launchBinding?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  provider?: InputMaybe<WorktrackerProviderFilterInput>;
};

export type WorktrackerAgentmodelOrderInput = {
  id?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
  providerId?: InputMaybe<OrderByEnum>;
};

export type WorktrackerAgentmodelreasoninglevel = {
  __typename?: 'WorktrackerAgentmodelreasoninglevel';
  agentModel?: Maybe<WorktrackerAgentmodel>;
  agentModelId: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  reasoningLevel?: Maybe<WorktrackerReasoninglevel>;
  reasoningLevelId: Scalars['String']['output'];
};

export type WorktrackerAgentmodelreasoninglevelConnection = {
  __typename?: 'WorktrackerAgentmodelreasoninglevelConnection';
  edges: Array<WorktrackerAgentmodelreasoninglevelEdge>;
  nodes: Array<WorktrackerAgentmodelreasoninglevel>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerAgentmodelreasoninglevelEdge = {
  __typename?: 'WorktrackerAgentmodelreasoninglevelEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerAgentmodelreasoninglevel;
};

export type WorktrackerAgentmodelreasoninglevelFilterInput = {
  agentModelId?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<WorktrackerAgentmodelreasoninglevelFilterInput>>;
  id?: InputMaybe<IntegerFilterInput>;
  not?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  or?: InputMaybe<Array<WorktrackerAgentmodelreasoninglevelFilterInput>>;
  reasoningLevelId?: InputMaybe<StringFilterInput>;
};

export type WorktrackerAgentmodelreasoninglevelHavingInput = {
  agentModel?: InputMaybe<WorktrackerAgentmodelFilterInput>;
  reasoningLevel?: InputMaybe<WorktrackerReasoninglevelFilterInput>;
};

export type WorktrackerAgentmodelreasoninglevelOrderInput = {
  agentModelId?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  reasoningLevelId?: InputMaybe<OrderByEnum>;
};

export type WorktrackerAttachment = {
  __typename?: 'WorktrackerAttachment';
  createdAt: Scalars['String']['output'];
  file: Scalars['String']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['String']['output'];
  issue?: Maybe<WorktrackerIssue>;
  issueId: Scalars['String']['output'];
  mimeType: Scalars['String']['output'];
  size?: Maybe<Scalars['Int']['output']>;
};

export type WorktrackerAttachmentConnection = {
  __typename?: 'WorktrackerAttachmentConnection';
  edges: Array<WorktrackerAttachmentEdge>;
  nodes: Array<WorktrackerAttachment>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerAttachmentEdge = {
  __typename?: 'WorktrackerAttachmentEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerAttachment;
};

export type WorktrackerAttachmentFilterInput = {
  and?: InputMaybe<Array<WorktrackerAttachmentFilterInput>>;
  createdAt?: InputMaybe<TextFilterInput>;
  file?: InputMaybe<StringFilterInput>;
  filename?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  issueId?: InputMaybe<StringFilterInput>;
  mimeType?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerAttachmentFilterInput>;
  or?: InputMaybe<Array<WorktrackerAttachmentFilterInput>>;
  size?: InputMaybe<IntegerFilterInput>;
};

export type WorktrackerAttachmentHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type WorktrackerAttachmentOrderInput = {
  createdAt?: InputMaybe<OrderByEnum>;
  file?: InputMaybe<OrderByEnum>;
  filename?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  issueId?: InputMaybe<OrderByEnum>;
  mimeType?: InputMaybe<OrderByEnum>;
  size?: InputMaybe<OrderByEnum>;
};

export type WorktrackerIssue = {
  __typename?: 'WorktrackerIssue';
  agentRuns: AgentRunsConnection;
  attachment: WorktrackerAttachmentConnection;
  blockedByEdges: WorktrackerIssueBlockedByConnection;
  blocksEdges: WorktrackerIssueBlockedByConnection;
  children: WorktrackerIssueConnection;
  createdAt: Scalars['String']['output'];
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isArchived: Scalars['Boolean']['output'];
  issueType?: Maybe<WorktrackerIssuetype>;
  issueTypeId: Scalars['String']['output'];
  module?: Maybe<WorktrackerIssue>;
  moduleId?: Maybe<Scalars['String']['output']>;
  moduleMembers: WorktrackerIssueConnection;
  name: Scalars['String']['output'];
  parent?: Maybe<WorktrackerIssue>;
  parentId?: Maybe<Scalars['String']['output']>;
  presentation: WorktrackerModulepresentationConnection;
  project?: Maybe<WorktrackerProject>;
  projectId: Scalars['String']['output'];
  rank: Scalars['String']['output'];
  sequenceId: Scalars['Int']['output'];
  state?: Maybe<WorktrackerState>;
  stateId?: Maybe<Scalars['String']['output']>;
  stateRevision: Scalars['Int']['output'];
  type: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  workspaceTabOrder: Scalars['Json']['output'];
};


export type WorktrackerIssueAgentRunsArgs = {
  filters?: InputMaybe<AgentRunsFilterInput>;
  orderBy?: InputMaybe<AgentRunsOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssueAttachmentArgs = {
  filters?: InputMaybe<WorktrackerAttachmentFilterInput>;
  orderBy?: InputMaybe<WorktrackerAttachmentOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssueBlockedByEdgesArgs = {
  filters?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueBlockedByOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssueBlocksEdgesArgs = {
  filters?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueBlockedByOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssueChildrenArgs = {
  filters?: InputMaybe<WorktrackerIssueFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssueModuleMembersArgs = {
  filters?: InputMaybe<WorktrackerIssueFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssuePresentationArgs = {
  filters?: InputMaybe<WorktrackerModulepresentationFilterInput>;
  orderBy?: InputMaybe<WorktrackerModulepresentationOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerIssueBlockedBy = {
  __typename?: 'WorktrackerIssueBlockedBy';
  blockedIssue?: Maybe<WorktrackerIssue>;
  blockingIssue?: Maybe<WorktrackerIssue>;
  fromIssueId: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  toIssueId: Scalars['String']['output'];
};

export type WorktrackerIssueBlockedByConnection = {
  __typename?: 'WorktrackerIssueBlockedByConnection';
  edges: Array<WorktrackerIssueBlockedByEdge>;
  nodes: Array<WorktrackerIssueBlockedBy>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerIssueBlockedByEdge = {
  __typename?: 'WorktrackerIssueBlockedByEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerIssueBlockedBy;
};

export type WorktrackerIssueBlockedByFilterInput = {
  and?: InputMaybe<Array<WorktrackerIssueBlockedByFilterInput>>;
  fromIssueId?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IntegerFilterInput>;
  not?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  or?: InputMaybe<Array<WorktrackerIssueBlockedByFilterInput>>;
  toIssueId?: InputMaybe<StringFilterInput>;
};

export type WorktrackerIssueBlockedByHavingInput = {
  blockedIssue?: InputMaybe<WorktrackerIssueFilterInput>;
  blockingIssue?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type WorktrackerIssueBlockedByOrderInput = {
  fromIssueId?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  toIssueId?: InputMaybe<OrderByEnum>;
};

export type WorktrackerIssueConnection = {
  __typename?: 'WorktrackerIssueConnection';
  edges: Array<WorktrackerIssueEdge>;
  nodes: Array<WorktrackerIssue>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerIssueEdge = {
  __typename?: 'WorktrackerIssueEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerIssue;
};

export type WorktrackerIssueFilterInput = {
  and?: InputMaybe<Array<WorktrackerIssueFilterInput>>;
  createdAt?: InputMaybe<TextFilterInput>;
  description?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  isArchived?: InputMaybe<BooleanFilterInput>;
  issueTypeId?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerIssueFilterInput>;
  or?: InputMaybe<Array<WorktrackerIssueFilterInput>>;
  parentId?: InputMaybe<StringFilterInput>;
  projectId?: InputMaybe<StringFilterInput>;
  rank?: InputMaybe<StringFilterInput>;
  sequenceId?: InputMaybe<IntegerFilterInput>;
  stateId?: InputMaybe<StringFilterInput>;
  stateRevision?: InputMaybe<IntegerFilterInput>;
  type?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
  workspaceTabOrder?: InputMaybe<JsonFilterInput>;
};

export type WorktrackerIssueHavingInput = {
  agentRuns?: InputMaybe<AgentRunsFilterInput>;
  attachment?: InputMaybe<WorktrackerAttachmentFilterInput>;
  blockedByEdges?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  blocksEdges?: InputMaybe<WorktrackerIssueBlockedByFilterInput>;
  children?: InputMaybe<WorktrackerIssueFilterInput>;
  issueType?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  module?: InputMaybe<WorktrackerIssueFilterInput>;
  moduleMembers?: InputMaybe<WorktrackerIssueFilterInput>;
  parent?: InputMaybe<WorktrackerIssueFilterInput>;
  presentation?: InputMaybe<WorktrackerModulepresentationFilterInput>;
  project?: InputMaybe<WorktrackerProjectFilterInput>;
  state?: InputMaybe<WorktrackerStateFilterInput>;
};

export type WorktrackerIssueOrderInput = {
  createdAt?: InputMaybe<OrderByEnum>;
  description?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  isArchived?: InputMaybe<OrderByEnum>;
  issueTypeId?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
  parentId?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  rank?: InputMaybe<OrderByEnum>;
  sequenceId?: InputMaybe<OrderByEnum>;
  stateId?: InputMaybe<OrderByEnum>;
  stateRevision?: InputMaybe<OrderByEnum>;
  type?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
  workspaceTabOrder?: InputMaybe<OrderByEnum>;
};

export type WorktrackerIssuetype = {
  __typename?: 'WorktrackerIssuetype';
  color: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isPathfind: Scalars['Boolean']['output'];
  issue: WorktrackerIssueConnection;
  issueTypeTransition: WorktrackerIssuetypetransitionConnection;
  launchBinding: WorktrackerLaunchbindingConnection;
  level: Scalars['String']['output'];
  name: Scalars['String']['output'];
  project?: Maybe<WorktrackerProject>;
  projectId: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
  startStateId?: Maybe<Scalars['String']['output']>;
  state?: Maybe<WorktrackerState>;
  updatedAt: Scalars['String']['output'];
  workflowRevision: Scalars['Int']['output'];
};


export type WorktrackerIssuetypeIssueArgs = {
  filters?: InputMaybe<WorktrackerIssueFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssuetypeIssueTypeTransitionArgs = {
  filters?: InputMaybe<WorktrackerIssuetypetransitionFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssuetypetransitionOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerIssuetypeLaunchBindingArgs = {
  filters?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  orderBy?: InputMaybe<WorktrackerLaunchbindingOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerIssuetypeBasic = {
  __typename?: 'WorktrackerIssuetypeBasic';
  color: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isPathfind: Scalars['Boolean']['output'];
  level: Scalars['String']['output'];
  name: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
  startStateId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  workflowRevision: Scalars['Int']['output'];
};

export type WorktrackerIssuetypeConnection = {
  __typename?: 'WorktrackerIssuetypeConnection';
  edges: Array<WorktrackerIssuetypeEdge>;
  nodes: Array<WorktrackerIssuetype>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerIssuetypeEdge = {
  __typename?: 'WorktrackerIssuetypeEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerIssuetype;
};

export type WorktrackerIssuetypeFilterInput = {
  and?: InputMaybe<Array<WorktrackerIssuetypeFilterInput>>;
  color?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<TextFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  isPathfind?: InputMaybe<BooleanFilterInput>;
  level?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  or?: InputMaybe<Array<WorktrackerIssuetypeFilterInput>>;
  projectId?: InputMaybe<StringFilterInput>;
  sortOrder?: InputMaybe<IntegerFilterInput>;
  startStateId?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
  workflowRevision?: InputMaybe<IntegerFilterInput>;
};

export type WorktrackerIssuetypeHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
  issueTypeTransition?: InputMaybe<WorktrackerIssuetypetransitionFilterInput>;
  launchBinding?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  project?: InputMaybe<WorktrackerProjectFilterInput>;
  state?: InputMaybe<WorktrackerStateFilterInput>;
};

export type WorktrackerIssuetypeInsertInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  level: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type WorktrackerIssuetypeOrderInput = {
  color?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  isPathfind?: InputMaybe<OrderByEnum>;
  level?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  sortOrder?: InputMaybe<OrderByEnum>;
  startStateId?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
  workflowRevision?: InputMaybe<OrderByEnum>;
};

export type WorktrackerIssuetypetransition = {
  __typename?: 'WorktrackerIssuetypetransition';
  agentAllowed: Scalars['Boolean']['output'];
  fromState?: Maybe<WorktrackerState>;
  fromStateId: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  issueType?: Maybe<WorktrackerIssuetype>;
  issueTypeId: Scalars['String']['output'];
  toState?: Maybe<WorktrackerState>;
  toStateId: Scalars['String']['output'];
};

export type WorktrackerIssuetypetransitionConnection = {
  __typename?: 'WorktrackerIssuetypetransitionConnection';
  edges: Array<WorktrackerIssuetypetransitionEdge>;
  nodes: Array<WorktrackerIssuetypetransition>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerIssuetypetransitionEdge = {
  __typename?: 'WorktrackerIssuetypetransitionEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerIssuetypetransition;
};

export type WorktrackerIssuetypetransitionFilterInput = {
  agentAllowed?: InputMaybe<BooleanFilterInput>;
  and?: InputMaybe<Array<WorktrackerIssuetypetransitionFilterInput>>;
  fromStateId?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IntegerFilterInput>;
  issueTypeId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerIssuetypetransitionFilterInput>;
  or?: InputMaybe<Array<WorktrackerIssuetypetransitionFilterInput>>;
  toStateId?: InputMaybe<StringFilterInput>;
};

export type WorktrackerIssuetypetransitionHavingInput = {
  fromState?: InputMaybe<WorktrackerStateFilterInput>;
  issueType?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  toState?: InputMaybe<WorktrackerStateFilterInput>;
};

export type WorktrackerIssuetypetransitionOrderInput = {
  agentAllowed?: InputMaybe<OrderByEnum>;
  fromStateId?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  issueTypeId?: InputMaybe<OrderByEnum>;
  toStateId?: InputMaybe<OrderByEnum>;
};

export type WorktrackerLaunchbinding = {
  __typename?: 'WorktrackerLaunchbinding';
  agentModel?: Maybe<WorktrackerAgentmodel>;
  autoStart: Scalars['Boolean']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  issueType?: Maybe<WorktrackerIssuetype>;
  issueTypeId: Scalars['String']['output'];
  modelId?: Maybe<Scalars['String']['output']>;
  prompt: Scalars['String']['output'];
  reasoningId?: Maybe<Scalars['String']['output']>;
  reasoningLevel?: Maybe<WorktrackerReasoninglevel>;
  requiredSkills: Scalars['Json']['output'];
  state?: Maybe<WorktrackerState>;
  stateId: Scalars['String']['output'];
  subtreeRunEnabled: Scalars['Boolean']['output'];
  updatedAt: Scalars['String']['output'];
};

export type WorktrackerLaunchbindingConnection = {
  __typename?: 'WorktrackerLaunchbindingConnection';
  edges: Array<WorktrackerLaunchbindingEdge>;
  nodes: Array<WorktrackerLaunchbinding>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerLaunchbindingEdge = {
  __typename?: 'WorktrackerLaunchbindingEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerLaunchbinding;
};

export type WorktrackerLaunchbindingFilterInput = {
  and?: InputMaybe<Array<WorktrackerLaunchbindingFilterInput>>;
  autoStart?: InputMaybe<BooleanFilterInput>;
  createdAt?: InputMaybe<TextFilterInput>;
  id?: InputMaybe<IntegerFilterInput>;
  issueTypeId?: InputMaybe<StringFilterInput>;
  modelId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  or?: InputMaybe<Array<WorktrackerLaunchbindingFilterInput>>;
  prompt?: InputMaybe<StringFilterInput>;
  reasoningId?: InputMaybe<StringFilterInput>;
  requiredSkills?: InputMaybe<JsonFilterInput>;
  stateId?: InputMaybe<StringFilterInput>;
  subtreeRunEnabled?: InputMaybe<BooleanFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
};

export type WorktrackerLaunchbindingHavingInput = {
  agentModel?: InputMaybe<WorktrackerAgentmodelFilterInput>;
  issueType?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  reasoningLevel?: InputMaybe<WorktrackerReasoninglevelFilterInput>;
  state?: InputMaybe<WorktrackerStateFilterInput>;
};

export type WorktrackerLaunchbindingOrderInput = {
  autoStart?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  issueTypeId?: InputMaybe<OrderByEnum>;
  modelId?: InputMaybe<OrderByEnum>;
  prompt?: InputMaybe<OrderByEnum>;
  reasoningId?: InputMaybe<OrderByEnum>;
  requiredSkills?: InputMaybe<OrderByEnum>;
  stateId?: InputMaybe<OrderByEnum>;
  subtreeRunEnabled?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type WorktrackerModulepresentation = {
  __typename?: 'WorktrackerModulepresentation';
  module?: Maybe<WorktrackerIssue>;
  moduleId: Scalars['String']['output'];
  rank: Scalars['String']['output'];
  tabHidden: Scalars['Boolean']['output'];
};

export type WorktrackerModulepresentationConnection = {
  __typename?: 'WorktrackerModulepresentationConnection';
  edges: Array<WorktrackerModulepresentationEdge>;
  nodes: Array<WorktrackerModulepresentation>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerModulepresentationEdge = {
  __typename?: 'WorktrackerModulepresentationEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerModulepresentation;
};

export type WorktrackerModulepresentationFilterInput = {
  and?: InputMaybe<Array<WorktrackerModulepresentationFilterInput>>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerModulepresentationFilterInput>;
  or?: InputMaybe<Array<WorktrackerModulepresentationFilterInput>>;
  rank?: InputMaybe<StringFilterInput>;
  tabHidden?: InputMaybe<BooleanFilterInput>;
};

export type WorktrackerModulepresentationHavingInput = {
  module?: InputMaybe<WorktrackerIssueFilterInput>;
};

export type WorktrackerModulepresentationOrderInput = {
  moduleId?: InputMaybe<OrderByEnum>;
  rank?: InputMaybe<OrderByEnum>;
  tabHidden?: InputMaybe<OrderByEnum>;
};

export type WorktrackerProject = {
  __typename?: 'WorktrackerProject';
  createdAt: Scalars['String']['output'];
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  issue: WorktrackerIssueConnection;
  issueType: WorktrackerIssuetypeConnection;
  name: Scalars['String']['output'];
  onboardingRequired: Scalars['Boolean']['output'];
  seqCounter: Scalars['Int']['output'];
  slug: Scalars['String']['output'];
  state: WorktrackerStateConnection;
  stateRevision: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};


export type WorktrackerProjectIssueArgs = {
  filters?: InputMaybe<WorktrackerIssueFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssueOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerProjectIssueTypeArgs = {
  filters?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  orderBy?: InputMaybe<WorktrackerIssuetypeOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerProjectStateArgs = {
  filters?: InputMaybe<WorktrackerStateFilterInput>;
  orderBy?: InputMaybe<WorktrackerStateOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerProjectConnection = {
  __typename?: 'WorktrackerProjectConnection';
  edges: Array<WorktrackerProjectEdge>;
  nodes: Array<WorktrackerProject>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerProjectEdge = {
  __typename?: 'WorktrackerProjectEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerProject;
};

export type WorktrackerProjectFilterInput = {
  and?: InputMaybe<Array<WorktrackerProjectFilterInput>>;
  createdAt?: InputMaybe<TextFilterInput>;
  description?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerProjectFilterInput>;
  onboardingRequired?: InputMaybe<BooleanFilterInput>;
  or?: InputMaybe<Array<WorktrackerProjectFilterInput>>;
  seqCounter?: InputMaybe<IntegerFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  stateRevision?: InputMaybe<IntegerFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
};

export type WorktrackerProjectHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
  issueType?: InputMaybe<WorktrackerIssuetypeFilterInput>;
  state?: InputMaybe<WorktrackerStateFilterInput>;
};

export type WorktrackerProjectOrderInput = {
  createdAt?: InputMaybe<OrderByEnum>;
  description?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
  onboardingRequired?: InputMaybe<OrderByEnum>;
  seqCounter?: InputMaybe<OrderByEnum>;
  slug?: InputMaybe<OrderByEnum>;
  stateRevision?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type WorktrackerProvider = {
  __typename?: 'WorktrackerProvider';
  activated: Scalars['Boolean']['output'];
  agentModel: WorktrackerAgentmodelConnection;
  id: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  supportsUnattended: Scalars['Boolean']['output'];
};


export type WorktrackerProviderAgentModelArgs = {
  filters?: InputMaybe<WorktrackerAgentmodelFilterInput>;
  orderBy?: InputMaybe<WorktrackerAgentmodelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerProviderConnection = {
  __typename?: 'WorktrackerProviderConnection';
  edges: Array<WorktrackerProviderEdge>;
  nodes: Array<WorktrackerProvider>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerProviderEdge = {
  __typename?: 'WorktrackerProviderEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerProvider;
};

export type WorktrackerProviderFilterInput = {
  activated?: InputMaybe<BooleanFilterInput>;
  and?: InputMaybe<Array<WorktrackerProviderFilterInput>>;
  id?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerProviderFilterInput>;
  or?: InputMaybe<Array<WorktrackerProviderFilterInput>>;
  slug?: InputMaybe<StringFilterInput>;
  supportsUnattended?: InputMaybe<BooleanFilterInput>;
};

export type WorktrackerProviderHavingInput = {
  agentModel?: InputMaybe<WorktrackerAgentmodelFilterInput>;
};

export type WorktrackerProviderOrderInput = {
  activated?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  slug?: InputMaybe<OrderByEnum>;
  supportsUnattended?: InputMaybe<OrderByEnum>;
};

export type WorktrackerReasoninglevel = {
  __typename?: 'WorktrackerReasoninglevel';
  agentModelReasoningLevel: WorktrackerAgentmodelreasoninglevelConnection;
  id: Scalars['String']['output'];
  launchBinding: WorktrackerLaunchbindingConnection;
  name: Scalars['String']['output'];
};


export type WorktrackerReasoninglevelAgentModelReasoningLevelArgs = {
  filters?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  orderBy?: InputMaybe<WorktrackerAgentmodelreasoninglevelOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};


export type WorktrackerReasoninglevelLaunchBindingArgs = {
  filters?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
  orderBy?: InputMaybe<WorktrackerLaunchbindingOrderInput>;
  pagination?: InputMaybe<PaginationInput>;
};

export type WorktrackerReasoninglevelConnection = {
  __typename?: 'WorktrackerReasoninglevelConnection';
  edges: Array<WorktrackerReasoninglevelEdge>;
  nodes: Array<WorktrackerReasoninglevel>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerReasoninglevelEdge = {
  __typename?: 'WorktrackerReasoninglevelEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerReasoninglevel;
};

export type WorktrackerReasoninglevelFilterInput = {
  and?: InputMaybe<Array<WorktrackerReasoninglevelFilterInput>>;
  id?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerReasoninglevelFilterInput>;
  or?: InputMaybe<Array<WorktrackerReasoninglevelFilterInput>>;
};

export type WorktrackerReasoninglevelHavingInput = {
  agentModelReasoningLevel?: InputMaybe<WorktrackerAgentmodelreasoninglevelFilterInput>;
  launchBinding?: InputMaybe<WorktrackerLaunchbindingFilterInput>;
};

export type WorktrackerReasoninglevelOrderInput = {
  id?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
};

export type WorktrackerState = {
  __typename?: 'WorktrackerState';
  color: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  group: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isProtected: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  project?: Maybe<WorktrackerProject>;
  projectId: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type WorktrackerStateConnection = {
  __typename?: 'WorktrackerStateConnection';
  edges: Array<WorktrackerStateEdge>;
  nodes: Array<WorktrackerState>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktrackerStateEdge = {
  __typename?: 'WorktrackerStateEdge';
  cursor: Scalars['String']['output'];
  node: WorktrackerState;
};

export type WorktrackerStateFilterInput = {
  and?: InputMaybe<Array<WorktrackerStateFilterInput>>;
  color?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<TextFilterInput>;
  group?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  isProtected?: InputMaybe<BooleanFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktrackerStateFilterInput>;
  or?: InputMaybe<Array<WorktrackerStateFilterInput>>;
  projectId?: InputMaybe<StringFilterInput>;
  sortOrder?: InputMaybe<IntegerFilterInput>;
  updatedAt?: InputMaybe<TextFilterInput>;
};

export type WorktrackerStateHavingInput = {
  project?: InputMaybe<WorktrackerProjectFilterInput>;
};

export type WorktrackerStateOrderInput = {
  color?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  group?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  isProtected?: InputMaybe<OrderByEnum>;
  name?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  sortOrder?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
};

export type WorktreeDiscardResult = {
  __typename?: 'WorktreeDiscardResult';
  branch?: Maybe<Scalars['String']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  removed: Scalars['Boolean']['output'];
  status: WorktreeStatusView;
  task_id: Scalars['String']['output'];
  top_level_task_id: Scalars['String']['output'];
};

export type WorktreeStatusView = {
  __typename?: 'WorktreeStatusView';
  ahead?: Maybe<Scalars['Int']['output']>;
  base_branch?: Maybe<Scalars['String']['output']>;
  behind?: Maybe<Scalars['Int']['output']>;
  branch?: Maybe<Scalars['String']['output']>;
  checkout_present?: Maybe<Scalars['Boolean']['output']>;
  clean?: Maybe<Scalars['Boolean']['output']>;
  conflict?: Maybe<Scalars['Boolean']['output']>;
  dirty?: Maybe<Scalars['Boolean']['output']>;
  ephemeral: Scalars['Boolean']['output'];
  is_shared: Scalars['Boolean']['output'];
  kind: Scalars['String']['output'];
  path?: Maybe<Scalars['String']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  state?: Maybe<Scalars['String']['output']>;
  task_id: Scalars['String']['output'];
  top_level_task_id: Scalars['String']['output'];
};

export type Worktrees = {
  __typename?: 'Worktrees';
  baseBranch: Scalars['String']['output'];
  baseCommit: Scalars['String']['output'];
  branch: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  ephemeral: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  issue?: Maybe<WorktrackerIssue>;
  moduleId?: Maybe<Scalars['String']['output']>;
  path: Scalars['String']['output'];
  project?: Maybe<WorktrackerProject>;
  projectId?: Maybe<Scalars['String']['output']>;
  repoRoot: Scalars['String']['output'];
  status: Scalars['String']['output'];
  taskId: Scalars['String']['output'];
  ticketSeq?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['String']['output'];
  workspaceSlug?: Maybe<Scalars['String']['output']>;
};

export type WorktreesConnection = {
  __typename?: 'WorktreesConnection';
  edges: Array<WorktreesEdge>;
  nodes: Array<Worktrees>;
  pageInfo: PageInfo;
  paginationInfo?: Maybe<PaginationInfo>;
};

export type WorktreesEdge = {
  __typename?: 'WorktreesEdge';
  cursor: Scalars['String']['output'];
  node: Worktrees;
};

export type WorktreesFilterInput = {
  and?: InputMaybe<Array<WorktreesFilterInput>>;
  baseBranch?: InputMaybe<StringFilterInput>;
  baseCommit?: InputMaybe<StringFilterInput>;
  branch?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<StringFilterInput>;
  ephemeral?: InputMaybe<BooleanFilterInput>;
  id?: InputMaybe<StringFilterInput>;
  moduleId?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<WorktreesFilterInput>;
  or?: InputMaybe<Array<WorktreesFilterInput>>;
  path?: InputMaybe<StringFilterInput>;
  projectId?: InputMaybe<StringFilterInput>;
  repoRoot?: InputMaybe<StringFilterInput>;
  status?: InputMaybe<StringFilterInput>;
  taskId?: InputMaybe<StringFilterInput>;
  ticketSeq?: InputMaybe<IntegerFilterInput>;
  updatedAt?: InputMaybe<StringFilterInput>;
  workspaceSlug?: InputMaybe<StringFilterInput>;
};

export type WorktreesHavingInput = {
  issue?: InputMaybe<WorktrackerIssueFilterInput>;
  project?: InputMaybe<WorktrackerProjectFilterInput>;
};

export type WorktreesOrderInput = {
  baseBranch?: InputMaybe<OrderByEnum>;
  baseCommit?: InputMaybe<OrderByEnum>;
  branch?: InputMaybe<OrderByEnum>;
  createdAt?: InputMaybe<OrderByEnum>;
  ephemeral?: InputMaybe<OrderByEnum>;
  id?: InputMaybe<OrderByEnum>;
  moduleId?: InputMaybe<OrderByEnum>;
  path?: InputMaybe<OrderByEnum>;
  projectId?: InputMaybe<OrderByEnum>;
  repoRoot?: InputMaybe<OrderByEnum>;
  status?: InputMaybe<OrderByEnum>;
  taskId?: InputMaybe<OrderByEnum>;
  ticketSeq?: InputMaybe<OrderByEnum>;
  updatedAt?: InputMaybe<OrderByEnum>;
  workspaceSlug?: InputMaybe<OrderByEnum>;
};
