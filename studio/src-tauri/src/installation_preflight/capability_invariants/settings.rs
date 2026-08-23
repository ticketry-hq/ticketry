//! Stored settings, which decide how startup itself behaves.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "settings-scope-empty",
            area: Area::Capability,
            rule: "every stored setting names the scope and key it belongs to",
            requires: &["app_settings.scope", "app_settings.key"],
            query: "SELECT (scope || '/' || key) AS identity FROM app_settings
                    WHERE scope = '' OR key = ''"
                .to_owned(),
        },
        Invariant {
            code: "settings-value-malformed",
            area: Area::Capability,
            rule: "every stored setting value is readable JSON",
            requires: &[
                "app_settings.scope",
                "app_settings.key",
                "app_settings.value",
            ],
            query: "SELECT (scope || '/' || key) AS identity FROM app_settings
                    WHERE NOT json_valid(value)"
                .to_owned(),
        },
    ]
}
