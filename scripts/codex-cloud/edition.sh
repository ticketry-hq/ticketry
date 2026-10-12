# Sourced by the Codex Cloud scripts that call Cargo directly. It mirrors
# studio/scripts/edition-build-policy.mjs: TICKETRY_EDITION is exactly "pocock"
# (the default when unset) or "core"; anything else fails before Cargo runs.
# Bun launchers and Vite resolve the same variable themselves, so it is passed
# through unchanged rather than exported with a default.
edition_cargo_features=()
if [[ -z ${TICKETRY_EDITION+set} ]]; then
  edition_name=pocock edition_source=default
elif [[ $TICKETRY_EDITION == pocock || $TICKETRY_EDITION == core ]]; then
  edition_name=$TICKETRY_EDITION edition_source=explicit
else
  echo "TICKETRY_EDITION must be exactly \"pocock\" or \"core\"; received \"$TICKETRY_EDITION\". Unset it to build the default pocock edition." >&2
  exit 2
fi
if [[ $edition_name == core ]]; then edition_cargo_features=(--features edition-core); fi
echo "Edition: $edition_name ($edition_source)"
