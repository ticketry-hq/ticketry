mod ingest_lifecycle;

pub(super) fn register(builder: &mut seaography::Builder) {
    ingest_lifecycle::register(builder);
}
