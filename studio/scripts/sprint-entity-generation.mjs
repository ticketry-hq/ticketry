import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function replace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Sprint entity generation cannot find ${label}`);
  return source.replace(before, after);
}

export async function generateSprintEntity({ rawDirectory, outputRoot }) {
  let source = await readFile(join(rawDirectory, "worktracker_sprint.rs"), "utf8");
  for (const field of ["created_at", "updated_at"]) {
    source = replace(source,
      `    #[sea_orm(ignore, column_type = "custom(\\"datetime\\")", select_as = "text")]\n    pub ${field}: String,`,
      `    pub ${field}: DateTime,`, `${field} datetime mapping`);
  }
  source = replace(source,
    '    #[sea_orm(\n        ignore,\n        column_type = "custom(\\\"datetime\\\")",\n        select_as = "text",\n        nullable\n    )]\n    pub goals_revised_at: Option<String>,',
    '    pub goals_revised_at: Option<DateTime>,', 'nullable goals revision mapping');
  // The CLI sees the partial one-active-per-project index as unconditional.
  source = replace(source, "    #[sea_orm(unique)]\n    pub project_id: String,", "    pub project_id: String,", "partial project uniqueness");
  // rc.9 applies compound ordering in Column::iter order, not input order.
  // Keep the persisted sequence primary and ID as the deterministic tie-break.
  source = replace(source, "    pub rank: String,\n", "", "rank column");
  source = replace(source, "pub struct Model {\n", "pub struct Model {\n    // Seaography applies compound ordering in column declaration order.\n    pub rank: String,\n", "rank-first ordering");
  source = replace(source, "}\n\nimpl ActiveModelBehavior for ActiveModel {}\n", `    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(has_many, relation_enum = "Issues")]
    pub issues: HasMany<super::issue::Entity>,
    #[sea_orm(belongs_to, relation_enum = "SuggestionRun", from = "suggestion_run_id", to = "id")]
    pub suggestion_run: BelongsTo<Option<crate::runs::agent_run::Entity>>,
    #[sea_orm(has_many, relation_enum = "Goals")]
    pub goals: HasMany<super::sprint_goal::Entity>,
    #[sea_orm(has_many, relation_enum = "Suggestions")]
    pub suggestions: HasMany<super::sprint_suggestion::Entity>,
}
`, "authored relations and separated lifecycle behavior");
  const target = join(outputRoot, "sprint-entities");
  await mkdir(target, { recursive: true });
  const destination = join(target, "sprint.rs");
  await writeFile(destination, source, "utf8");
  const format = spawnSync("rustfmt", ["--edition", "2021", destination], { encoding: "utf8" });
  if (format.status !== 0) throw new Error(`Sprint entity formatting failed: ${format.stderr}`);
}
