# Settings store

The vocabulary of host-local configuration: facts about this machine and this
installation, distinct from the shared planning domain.

## Language

**Module link**:
The host-local binding of one module to the absolute folder where it lives on
this machine. Exactly one per module; deleting the module deletes the link.
_Avoid_: Profile, module folder map, workspace binding, checkout

**Host-local configuration**:
Settings that describe this installation or machine (module links,
keybindings, provider catalog) rather than shared planning data. Typed
persistence is the rule; open-ended JSON is reserved for genuinely
open-ended values, currently only keybindings.
_Avoid_: Profile, config file, features file, generic settings table

**Folder validation**:
The stateless check that a candidate module path exists and is usable. It
persists nothing.
_Avoid_: Link creation, folder registration
