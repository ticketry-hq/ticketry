#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskPromptFacts {
    pub name: String,
    pub work_item_id: String,
    pub sequence_id: Option<i64>,
    pub project_id: String,
    pub module_id: String,
    pub local_module_folder: String,
    pub state: String,
    pub issue_type: String,
    pub description_html: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskPromptInput {
    pub facts: TaskPromptFacts,
    pub workflow_prompt: String,
    pub additional_user_input: Option<String>,
    pub design_directory: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskSummary {
    pub name: String,
    pub sequence_id: Option<i64>,
    pub state: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModulePromptFacts {
    pub name: String,
    pub module_id: String,
    pub project_slug: String,
    pub project_id: String,
    pub local_codebase: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanningPrompt {
    pub module: ModulePromptFacts,
    pub tasks: Vec<TaskSummary>,
    pub design_directory: Option<String>,
    pub module_directory_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstantPrompt {
    pub module: ModulePromptFacts,
    pub user_input: Option<String>,
    pub initial_prompt: Option<String>,
    pub design_directory: Option<String>,
    pub allow_self_termination: bool,
    pub auto_close: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentChatPrompt {
    pub document_relative_path: String,
    pub local_module_folder: String,
    pub user_input: Option<String>,
}

const DESIGN_DOC_VISUAL_CONTRACT: &str = "Use a calm light surface, shared token palette, and system font. Keep a sticky header with an uppercase crumb, title, one-line summary, and status chips; add scroll-spy navigation and lead each section with a heading and short lede. Include a clickable SVG diagram whose side panel explains each node's responsibilities and non-responsibilities, with non-responsibilities in red and dashed strokes reserved for deferred seams; use the same convention for numbered sequence steps. Keep a requirement-trace table that highlights its matching diagram nodes, a color-coded file change-map tree, and a closing green acceptance-signal callout.";
const WATCHED_DOCUMENT_CONTRACT: &str = "Ticketry watches this exact design directory recursively for .md and .html files.\nCreate every design or spec document inside this directory; files written elsewhere will not appear in Ticketry.";

fn watched_design_directory(directory: &str) -> String {
    format!("Design directory: {directory}\n{WATCHED_DOCUMENT_CONTRACT}\n")
}

pub fn build_task_prompt(input: &TaskPromptInput) -> String {
    let facts = &input.facts;
    let ticket = facts
        .sequence_id
        .map(|sequence| format!(" (ticket #{sequence})"))
        .unwrap_or_default();
    let description = if facts.description_html.is_empty() {
        "No description provided.".to_owned()
    } else {
        strip_html(&facts.description_html)
    };
    let mut prompt = String::new();
    if !input.workflow_prompt.is_empty() {
        prompt.push_str("Selected workflow prompt:\n");
        prompt.push_str(&input.workflow_prompt);
        prompt.push_str("\n\n");
    }
    prompt.push_str(&format!(
        "Work item context (factual):\nSource: WorkTracker{ticket}\nTask: {}\nWork Item ID: {}\nProject ID: {}\nModule ID: {}\nLocal Module Folder: {}\nState: {}\nType: {}\n\nDescription:\n{}\n\n",
        or_default(&facts.name, "Untitled"),
        facts.work_item_id,
        facts.project_id,
        facts.module_id,
        facts.local_module_folder,
        or_default(&facts.state, "Unknown"),
        or_default(&facts.issue_type, "Unknown"),
        description,
    ));
    if let Some(additional) = input
        .additional_user_input
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        prompt.push_str("Additional user instructions:\n");
        prompt.push_str(additional);
        prompt.push_str("\n\n");
    }
    if !facts.state.eq_ignore_ascii_case("ideas") {
        if let Some(directory) = input.design_directory.as_deref() {
            prompt.push_str(&watched_design_directory(directory));
        }
    }
    prompt.push_str("Available tools: WorkTracker MCP server; coding agent status tool.");
    prompt
}

pub fn build_planning_prompt(input: &PlanningPrompt) -> String {
    let tasks = if input.tasks.is_empty() {
        "  (no tasks yet)".to_owned()
    } else {
        input
            .tasks
            .iter()
            .map(|task| {
                let sequence = task
                    .sequence_id
                    .map(|value| format!("#{value} "))
                    .unwrap_or_default();
                format!("  - {sequence}{} [{}]", task.name, task.state)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let module = &input.module;
    let mut prompt = format!(
        "You are a planning assistant helping design new features for the '{}' module.\n\nContext:\n  Project: {}\n  Project ID: {}\n  Module ID: {}\n  Local Codebase: {}\n\nExisting tasks in this module:\n{}\n\nYour job:\n  1. Start by asking the user what they want to build.\n  2. Use the WorkTracker MCP server to look up related tasks in the module or project to understand what already exists and avoid duplication.\n  3. If a local codebase folder is set, explore it to understand how the relevant parts of the system currently work.\n  4. Through conversation, help the user refine the idea — clarify scope, surface edge cases, and break it into concrete pieces.\n  5. Once the feature is fully fleshed out, create one or more well-described tasks in WorkTracker via the WorkTracker MCP server. Each task should have a clear description and acceptance criteria and be assigned to module {}.",
        module.name, module.project_slug, module.project_id, module.module_id,
        module.local_codebase.as_deref().unwrap_or("(not set)"), tasks, module.module_id,
    );
    if let (Some(directory), Some(module_name)) = (
        input.design_directory.as_deref(),
        input.module_directory_name.as_deref(),
    ) {
        prompt.push_str(&format!(
            "\n\n{}After you create a WorkTracker task for the planned feature, move this directory's contents to the task's canonical design directory spec/{module_name}/T<sequence>--<short-task-slug>/ (sequence = the new task's ticket number, slug = lowercase dashed words from its name) so the documents follow the task.",
            watched_design_directory(directory),
        ));
    }
    prompt.push_str("\n\nDo not start implementing. This is a planning session only.");
    prompt
}

pub fn build_instant_prompt(input: &InstantPrompt) -> String {
    let module = &input.module;
    let user_input = input
        .user_input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut steps: Vec<Vec<&str>> = Vec::new();
    if user_input.is_none() {
        steps.push(vec![
            "Wait for the user to type their first request in this terminal.",
            "Do not inspect files, make changes, or ask questions before that request arrives.",
        ]);
    }
    if input.allow_self_termination && !input.auto_close {
        steps.push(if user_input.is_some() {
            vec![
                "Before beginning any work, ask the user exactly once: 'May I terminate this run",
                "after I successfully complete this requested change?' Wait for their response.",
                "Only an explicit affirmative response authorizes self-termination. Refusal,",
                "an ambiguous response, or no response means the run must stay open. Remember",
                "that decision for this run and this request; do not ask again.",
            ]
        } else {
            vec![
                "After the user sends a request and before beginning work, ask exactly once:",
                "'May I terminate this run after I successfully complete this requested change?'",
                "Wait for their response. Only an explicit affirmative response authorizes",
                "self-termination. Refusal, ambiguity, or no response means the run stays open.",
            ]
        });
    }
    steps.extend([
        vec![
            "Make the change the user described directly. This is intentionally",
            "lightweight — no WorkTracker task is being tracked for it.",
        ],
        vec![
            "If a local codebase folder is set, explore only what you need to",
            "make the change safely.",
        ],
        vec![
            "Keep the scope tight to exactly what was asked. Do not refactor,",
            "expand scope, or create WorkTracker tasks.",
        ],
        vec![
            "If the change turns out to be larger than expected or ambiguous,",
            "stop and tell the user it should be planned properly via the",
            "'n' (Plan Feature) flow instead of done instantly.",
        ],
    ]);
    if input.allow_self_termination && input.auto_close {
        steps.extend([
            vec!["After the work completes successfully and is validated, briefly report what changed,", "then invoke terminate_current_run with no arguments."],
            vec!["Never invoke self-termination when the work is blocked, failed, ambiguous, or", "larger than expected. Do not update any WorkTracker task state."],
        ]);
    } else if input.allow_self_termination {
        steps.extend([
            vec!["After the work completes successfully and is validated, briefly report what changed.", "Only after that report, and only if the user explicitly authorized it, invoke", "terminate_current_run with no arguments."],
            vec!["Never invoke self-termination when the work is blocked, failed, ambiguous, or", "larger than expected. Without explicit authorization, leave the run open.", "Do not update any WorkTracker task state."],
        ]);
    } else {
        steps.push(vec![
            "When done, briefly confirm what you changed. Do not update any",
            "WorkTracker task state.",
        ]);
    }
    let jobs = steps
        .iter()
        .enumerate()
        .map(|(index, lines)| {
            format!(
                "  {}. {}\n{}",
                index + 1,
                lines[0],
                lines[1..]
                    .iter()
                    .map(|line| format!("     {line}\n"))
                    .collect::<String>()
            )
        })
        .collect::<String>();
    let design = input
        .design_directory
        .as_deref()
        .map(watched_design_directory)
        .unwrap_or_default();
    let configured = input
        .initial_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("Configured Instant instructions:\n{value}\n\n"))
        .unwrap_or_default();
    let request = user_input
        .map(|value| format!("User's request:\n  {value}\n\n"))
        .unwrap_or_default();
    format!(
        "You are an agent making a small, instant change in the '{}' module.\n\nContext:\n  Project: {}\n  Project ID:  {}\n  Module ID:   {}\n  Local Codebase: {}\n\n{}{}Your job:\n{}\n{}Do not create or update WorkTracker tasks for this work.",
        module.name, module.project_slug, module.project_id, module.module_id,
        module.local_codebase.as_deref().unwrap_or("(not set)"), configured, request, jobs, design,
    )
}

pub fn build_document_chat_prompt(input: &DocumentChatPrompt) -> String {
    let mut prompt = format!(
        "You are editing one generated design document in place.\n\nTarget document (in your working directory): {}\nLocal Module Folder: {}\n\nYour working directory is this document's design directory, so the target file and its sibling generated docs are right here.\n\nYour job:\n  1. Edit the target document above directly, in place. Do not create a new file, a copy, or a document under any other location.\n  2. Preserve the document's visual design language: its token palette, system font, interactive diagrams, low-text / high-structure layout, existing structure, and vocabulary. For an HLD or LLD, retain this contract: {}\n  3. You may read the other generated docs in this directory for reference. Do not modify anything beyond the target document unless the user explicitly asks you to.\n  4. When you save the file, the viewer reloads it automatically — you need do nothing extra to refresh it.\n\n",
        input.document_relative_path, input.local_module_folder, DESIGN_DOC_VISUAL_CONTRACT,
    );
    match input
        .user_input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(request) => prompt.push_str(&format!("The user's requested change:\n{request}\n")),
        None => prompt
            .push_str("Start by asking the user what they want to change about this document.\n"),
    }
    prompt
}

fn or_default<'a>(value: &'a str, default: &'a str) -> &'a str {
    if value.is_empty() {
        default
    } else {
        value
    }
}

fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut tag = String::new();
    let mut inside = false;
    for character in input.chars() {
        match character {
            '<' if !inside => {
                inside = true;
                tag.clear();
            }
            '>' if inside => {
                inside = false;
                let normalized = tag.trim().trim_end_matches('/').trim().to_ascii_lowercase();
                if normalized == "br" {
                    output.push('\n');
                }
                if normalized == "/p" {
                    output.push_str("\n\n");
                }
                if normalized == "/li" {
                    output.push('\n');
                }
            }
            _ if inside => tag.push(character),
            _ => output.push(character),
        }
    }
    output.trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module() -> ModulePromptFacts {
        ModulePromptFacts {
            name: "Terminal π".into(),
            module_id: "module-1".into(),
            project_slug: "ticketry".into(),
            project_id: "project-1".into(),
            local_codebase: Some("/authorized/repo".into()),
        }
    }

    #[test]
    fn task_prompt_keeps_workflow_authority_facts_user_input_and_design_identity() {
        let prompt = build_task_prompt(&TaskPromptInput {
            facts: TaskPromptFacts {
                name: "Quote-heavy 'task' 東京".into(),
                work_item_id: "task-1".into(),
                sequence_id: Some(867),
                project_id: "project-1".into(),
                module_id: "module-1".into(),
                local_module_folder: "/authorized/repo".into(),
                state: "Implement".into(),
                issue_type: "Implementation".into(),
                description_html: "<p>First</p><ul><li>Second</li></ul>".into(),
            },
            workflow_prompt: "This text is opaque; keep \"all\" of it.".into(),
            additional_user_input: Some("Also preserve 🦀.".into()),
            design_directory: Some("spec/module/T867--launch".into()),
        });

        assert!(prompt.starts_with("Selected workflow prompt:\nThis text is opaque; keep \"all\" of it.\n\nWork item context (factual):"));
        for expected in [
            "Source: WorkTracker (ticket #867)",
            "Task: Quote-heavy 'task' 東京",
            "Description:\nFirst\n\nSecond",
            "Additional user instructions:\nAlso preserve 🦀.",
            "Design directory: spec/module/T867--launch",
        ] {
            assert!(prompt.contains(expected), "missing {expected:?}");
        }
    }

    #[test]
    fn scratch_and_document_prompts_keep_their_associations() {
        let planning = build_planning_prompt(&PlanningPrompt {
            module: module(),
            tasks: vec![TaskSummary {
                name: "Existing".into(),
                sequence_id: Some(9),
                state: "Review".into(),
            }],
            design_directory: Some("spec/module/Scratch/run-1".into()),
            module_directory_name: Some("module--abc".into()),
        });
        assert!(planning.contains("#9 Existing [Review]"));
        assert!(planning.contains("Design directory: spec/module/Scratch/run-1"));

        let instant = build_instant_prompt(&InstantPrompt {
            module: module(),
            user_input: Some("Change only 'x' → \"λ\".".into()),
            initial_prompt: Some("Keep generated files untouched.".into()),
            design_directory: Some("spec/module/Scratch/run-2".into()),
            allow_self_termination: true,
            auto_close: false,
        });
        assert!(instant.contains("Change only 'x' → \"λ\"."));
        assert!(
            instant.contains("Configured Instant instructions:\nKeep generated files untouched.")
        );
        assert!(instant.contains("May I terminate this run"));
        assert!(instant.contains("terminate_current_run"));

        let auto_closing = build_instant_prompt(&InstantPrompt {
            module: module(),
            user_input: Some("Change x.".into()),
            initial_prompt: None,
            design_directory: None,
            allow_self_termination: true,
            auto_close: true,
        });
        assert!(!auto_closing.contains("May I terminate this run"));
        assert!(auto_closing.contains("then invoke terminate_current_run"));

        let document = build_document_chat_prompt(&DocumentChatPrompt {
            document_relative_path: "HLD 'final'.html".into(),
            local_module_folder: "/authorized/repo".into(),
            user_input: Some("Keep 日本語 labels".into()),
        });
        assert!(document.contains("Target document (in your working directory): HLD 'final'.html"));
        assert!(document.contains("The user's requested change:\nKeep 日本語 labels"));
    }
}
