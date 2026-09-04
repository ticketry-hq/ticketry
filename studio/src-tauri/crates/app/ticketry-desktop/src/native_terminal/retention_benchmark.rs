use serde::Serialize;

pub(crate) const RETENTION_BENCHMARK_ENV: &str = "TICKETRY_NATIVE_RETENTION_BENCHMARK";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRetentionBenchmarkStatus {
    pub requested_count: u16,
    pub created_count: u16,
    pub visible_count: u16,
    pub selected_count: u16,
    pub hidden_count: u16,
}

pub(crate) fn retention_benchmark_enabled() -> bool {
    std::env::var(RETENTION_BENCHMARK_ENV).as_deref() == Ok("1")
}

pub(crate) fn validate_retention_benchmark_request(
    enabled: bool,
    count: u16,
) -> Result<(), &'static str> {
    if !enabled {
        return Err("native retention benchmark is disabled");
    }
    if !matches!(count, 0 | 1 | 5 | 20) {
        return Err("native retention benchmark count must be 0, 1, 5, or 20");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_retention_benchmark_request;

    #[test]
    fn benchmark_requires_the_explicit_runtime_gate() {
        assert_eq!(
            validate_retention_benchmark_request(false, 1).unwrap_err(),
            "native retention benchmark is disabled"
        );
    }

    #[test]
    fn benchmark_accepts_only_measurement_counts_and_zero_for_disposal() {
        for count in [0, 1, 5, 20] {
            assert!(validate_retention_benchmark_request(true, count).is_ok());
        }
        for count in [2, 4, 10, 21, u16::MAX] {
            assert_eq!(
                validate_retention_benchmark_request(true, count).unwrap_err(),
                "native retention benchmark count must be 0, 1, 5, or 20"
            );
        }
    }
}
