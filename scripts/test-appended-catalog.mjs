// Exercise the actual installation acceptance binaries with a synthetic registry
// entry. Work on a source snapshot: never mutate the developer's registry or data.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = await mkdtemp(path.join(tmpdir(), "ticketry-appended-catalog-"));
const workspace = path.join(snapshot, "studio/src-tauri");
const registryRelative = "crates/config/ticketry-settings/src/provider_catalog_migrations/catalog_registry.rs";
let failed = false;

try {
  console.log("Snapshotting migration acceptance sources (live checkout remains unchanged)");
  await mkdir(path.join(snapshot, "studio"), { recursive: true });
  await cp(path.join(repository, "studio/src-tauri"), workspace, {
    recursive: true,
    filter: (source) => !["target", "vendor", ".ticketry-dev"].includes(path.basename(source)),
  });
  await cp(path.join(repository, "config"), path.join(snapshot, "config"), { recursive: true });
  await cp(path.join(repository, "studio/src-tauri/vendor/libghostty/resources"),
    path.join(workspace, "vendor/libghostty/resources"), { recursive: true });
  await cp(path.join(repository, "studio/src"), path.join(snapshot, "studio/src"), { recursive: true });
  await mkdir(path.join(snapshot, "studio/dist"), { recursive: true });
  await writeFile(path.join(snapshot, "studio/dist/index.html"), "<!doctype html><title>Migration acceptance</title>");

  const registry = path.join(workspace, registryRelative);
  const source = await readFile(registry, "utf8");
  const nonCatalog = await readFile(path.join(workspace,
    "crates/execution/ticketry-installation/src/final_schema_migrations/non_catalog.rs"), "utf8");
  const steps = [...source.matchAll(/\bstep:\s*(\d+)/g), ...nonCatalog.matchAll(/:\s*\((\d+),/g)]
    .map((match) => Number(match[1]));
  const nextStep = Math.max(...steps) + 1;
  const migrationId = `${String(nextStep).padStart(4, "0")}_acceptance_appended_catalog`;
  console.log(`Appending synthetic catalog step ${nextStep} in the snapshot`);
  const declaration = /pub\(super\) const REGISTRY: &\[&CatalogEntry\] = &\[([\s\S]*?)\n\];/;
  if (!declaration.test(source)) throw new Error("Cannot locate the catalog registry declaration");
  const synthetic = `
// Synthetic migration used only by this isolated acceptance build.
const ACCEPTANCE_APPEND: CatalogEntry = CatalogEntry {
    migration_id: "${migrationId}",
    ledger: "ticketry_acceptance_appended_catalog_migration",
    source_commit: "0123456789abcdef0123456789abcdef01234567",
    step: ${nextStep},
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel { name: "acceptance-next-model", reasoning: &["low", "high"] }],
};
`;
  await writeFile(registry, source.replace(declaration, (match, entries) =>
    `pub(super) const REGISTRY: &[&CatalogEntry] = &[${entries}\n    &ACCEPTANCE_APPEND,\n];`) + synthetic);

  const sprintTests = path.join(workspace, "crates/execution/ticketry-installation/tests/sprint_migration_chain.rs");
  await writeFile(sprintTests, await readFile(sprintTests, "utf8") + `
#[tokio::test]
async fn appended_catalog_model_and_ledger_are_installed() {
    let (_directory, database) = support::fixture().await;
    install_final_schema_migrations(&database).await.unwrap();
    install_final_schema_migrations(&database).await.unwrap();
    assert_eq!(ORDERED_MIGRATION_IDS.last(), Some(&"${migrationId}"));
    support::sprint_acceptance::assert_sprint_history(&ORDERED_MIGRATION_IDS);
    support::sprint_acceptance::assert_sprint_schema_and_ledger(&database).await;
    let row = database.query_one_raw(Statement::from_string(DbBackend::Sqlite,
        "SELECT COUNT(*) AS count FROM worktracker_agentmodel model
         JOIN worktracker_provider provider ON provider.id=model.provider_id
         WHERE provider.slug='codex' AND model.name='acceptance-next-model'".to_owned()))
        .await.unwrap().unwrap();
    assert_eq!(row.try_get::<i64>("", "count").unwrap(), 1);
    let row = database.query_one_raw(Statement::from_string(DbBackend::Sqlite,
        "SELECT migration_id FROM ticketry_acceptance_appended_catalog_migration".to_owned()))
        .await.unwrap().unwrap();
    assert_eq!(row.try_get::<String>("", "migration_id").unwrap(), "${migrationId}");
}
`);

  const cases = [
    ["-p", "ticketry-installation", "--test", "sprint_migration_chain", "installation_chain_reaches_sprints_and_preserves_backlog"],
    ["-p", "ticketry", "--no-default-features", "--test", "final_schema_migration_chain", "fresh_production_entry_reaches_the_final_leaf"],
    ["-p", "ticketry-installation", "--test", "sprint_migration_chain", "appended_catalog_model_and_ledger_are_installed"],
    ["-p", "ticketry-installation", "--lib", "final_schema_migrations::tests::"],
  ];
  for (const test of cases) {
    console.log(`\nAppended catalog acceptance: ${test.at(-1)}`);
    const selection = test.at(-1).endsWith("::") ? [] : ["--exact"];
    const result = spawnSync("cargo", ["test", "--locked", ...test, "--", ...selection, "--nocapture"], {
      cwd: workspace,
      stdio: "inherit",
      env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(repository, "studio/src-tauri/target") },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) failed = true;
  }
} finally {
  await rm(snapshot, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
