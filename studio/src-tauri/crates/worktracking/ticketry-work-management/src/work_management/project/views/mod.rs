mod acknowledge_onboarding;
mod create;
mod delete;
mod support;
mod update;

use seaography::Builder;

pub(super) fn register_model_mutations(builder: &mut Builder) {
    acknowledge_onboarding::register(builder);
    update::register(builder);
}

pub(super) fn register_authored_mutations(builder: &mut Builder) {
    create::register(builder);
    delete::register(builder);
}
