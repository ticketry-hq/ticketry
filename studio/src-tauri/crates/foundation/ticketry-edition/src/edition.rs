//! The editions named in `config/editions.json`.

use crate::EditionCapability;

/// A shipped edition of Ticketry, in the manifest's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Edition {
    Pocock,
    Core,
}

impl Edition {
    /// The edition's name as `config/editions.json` spells it.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Pocock => "pocock",
            Self::Core => "core",
        }
    }

    /// Whether this edition grants `capability`, per the manifest's table.
    pub const fn has(self, capability: EditionCapability) -> bool {
        capability.granted_in(self)
    }
}
