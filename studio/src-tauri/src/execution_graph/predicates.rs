use super::{ChildSchedulingFacts, ExecutionMode};

pub fn automatically_eligible(facts: &ChildSchedulingFacts) -> bool {
    !facts.child.is_satisfied()
        && !facts.has_campaign_claim
        && facts.blockers.iter().all(|blocker| blocker.is_satisfied())
}

pub fn manually_startable(facts: &ChildSchedulingFacts) -> bool {
    !facts.child.is_satisfied()
        && !facts.has_live_work
        && facts.blockers.iter().all(|blocker| blocker.is_satisfied())
}

pub fn automatic_candidates(
    children: &[ChildSchedulingFacts],
    mode: ExecutionMode,
    serial_frontier_pending: bool,
) -> Vec<&ChildSchedulingFacts> {
    if mode == ExecutionMode::Serial && serial_frontier_pending {
        return Vec::new();
    }
    select(children, mode, automatically_eligible)
}

pub fn manual_candidates(
    children: &[ChildSchedulingFacts],
    mode: ExecutionMode,
) -> Vec<&ChildSchedulingFacts> {
    if mode == ExecutionMode::Serial
        && children
            .iter()
            .any(|facts| !facts.child.is_satisfied() && facts.has_live_work)
    {
        return Vec::new();
    }
    select(children, mode, manually_startable)
}

fn select(
    children: &[ChildSchedulingFacts],
    mode: ExecutionMode,
    predicate: impl Fn(&ChildSchedulingFacts) -> bool,
) -> Vec<&ChildSchedulingFacts> {
    let mut selected = children
        .iter()
        .filter(|facts| predicate(facts))
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| {
        left.child
            .sequence_id
            .cmp(&right.child.sequence_id)
            .then_with(|| left.child.id.cmp(&right.child.id))
    });
    if mode == ExecutionMode::Serial {
        selected.truncate(1);
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution_graph::WorkItemFact;

    fn child(id: &str, sequence_id: i32) -> ChildSchedulingFacts {
        ChildSchedulingFacts {
            child: WorkItemFact {
                id: id.to_owned(),
                sequence_id,
                state_name: Some("Todo".to_owned()),
                state_group: Some("unstarted".to_owned()),
                is_archived: false,
            },
            blockers: Vec::new(),
            has_campaign_claim: false,
            has_live_work: false,
        }
    }

    #[test]
    fn automatic_and_manual_rules_read_different_facts() {
        let mut stale_claim = child("claimed", 1);
        stale_claim.has_campaign_claim = true;
        let mut live = child("live", 2);
        live.has_live_work = true;

        assert!(!automatically_eligible(&stale_claim));
        assert!(manually_startable(&stale_claim));
        assert!(automatically_eligible(&live));
        assert!(!manually_startable(&live));
    }

    #[test]
    fn satisfaction_covers_archive_completed_cancelled_and_review() {
        let mut facts = child("child", 1);
        for (name, group, archived) in [
            ("Todo", "unstarted", true),
            ("Done", "completed", false),
            ("Cancelled", "cancelled", false),
            ("Review", "started", false),
        ] {
            facts.child.state_name = Some(name.to_owned());
            facts.child.state_group = Some(group.to_owned());
            facts.child.is_archived = archived;
            assert!(facts.child.is_satisfied());
            assert!(!automatically_eligible(&facts));
            assert!(!manually_startable(&facts));
        }
    }

    #[test]
    fn candidates_use_stored_sequence_then_id_and_serial_holds_live_work() {
        let mut rows = vec![child("b", 7), child("a", 7), child("first", 2)];
        assert_eq!(
            automatic_candidates(&rows, ExecutionMode::Parallel, false)
                .into_iter()
                .map(|facts| facts.child.id.as_str())
                .collect::<Vec<_>>(),
            ["first", "a", "b"]
        );
        rows[2].has_live_work = true;
        assert!(manual_candidates(&rows, ExecutionMode::Serial).is_empty());
        assert_eq!(
            manual_candidates(&rows, ExecutionMode::Parallel)
                .into_iter()
                .map(|facts| facts.child.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(automatic_candidates(&rows, ExecutionMode::Serial, true).is_empty());
    }

    #[test]
    fn blockers_are_shared_by_both_predicates() {
        let mut facts = child("child", 1);
        facts.blockers.push(child("blocker", 9).child);
        assert!(!automatically_eligible(&facts));
        assert!(!manually_startable(&facts));
        facts.blockers[0].state_name = Some("Review".to_owned());
        assert!(automatically_eligible(&facts));
        assert!(manually_startable(&facts));
    }
}
