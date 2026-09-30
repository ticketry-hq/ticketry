//! Restricted State mutation views.
//!
//! Generated State writes stay private as one audited contract:
//!
//! | Operation | Public fields | Identity and invariants | Decision |
//! | --- | --- | --- | --- |
//! | Create one | `project_id`, `name`, `group`, `color` | locks one Project, allocates color and order, writes one status fact | restricted Seaolim view |
//! | Create batch | none | color and order allocation require one serialized Project catalogue | private |
//! | Update | `name`, `group`, `color`, `sort_order` | binds one State identity and writes its status fact atomically | restricted Seaolim view |
//! | Delete | none | binds one identity and checks protection, group membership, occupancy, and workflow references | restricted Seaolim view |
//!
//! Reorder is the declared non-CRUD operation. It replaces the complete
//! project-owned ordering and writes every row fact in one transaction.

mod views;

pub fn register_mutations(mut builder: seaography::Builder) -> seaography::Builder {
    views::register(&mut builder);
    builder
}
