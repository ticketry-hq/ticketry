/// The exact development renderer origin admitted by a planner listener.
#[derive(Clone, Debug)]
pub struct PlannerFrontendOrigin(String);

impl PlannerFrontendOrigin {
    /// Accept only a canonical HTTP origin on Ticketry's IPv4 loopback host.
    pub fn parse(origin: &str) -> Result<Self, String> {
        let port = origin
            .strip_prefix("http://127.0.0.1:")
            .and_then(|port| port.parse::<u16>().ok())
            .filter(|port| *port != 0);
        if port.is_some_and(|port| origin == format!("http://127.0.0.1:{port}")) {
            Ok(Self(origin.to_owned()))
        } else {
            Err("Ticketry frontend origin must be http://127.0.0.1:<port> with a port between 1 and 65535".to_owned())
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_exact_loopback_origins() {
        for origin in ["http://127.0.0.1:5176", "http://127.0.0.1:6200"] {
            assert_eq!(
                PlannerFrontendOrigin::parse(origin).unwrap().as_str(),
                origin
            );
        }
        for origin in [
            "http://localhost:5176",
            "https://127.0.0.1:5176",
            "http://127.0.0.1:0",
            "http://127.0.0.1:65536",
            "http://127.0.0.1:5176/",
            "http://127.0.0.1:5176/path",
            "http://127.0.0.1:05176",
            "http://127.0.0.1:5176?query",
            "http://127.0.0.1:5176#fragment",
            "http://user@127.0.0.1:5176",
        ] {
            assert!(PlannerFrontendOrigin::parse(origin).is_err(), "{origin}");
        }
    }
}
