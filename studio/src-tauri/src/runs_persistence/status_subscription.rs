//! The project-scoped, receive-only GraphQL subscription.
//!
//! Seaography rc.9 generates model CRUD but no snapshot/replay/live protocol,
//! so this one authored subscription is the recorded exception. It accepts no
//! writes, resolves against the same Runs services the queries and mutations
//! use, and only publishes the typed union in `status_frames`.

use futures_util::{stream::BoxStream, StreamExt};
use seaography::async_graphql::dynamic::{
    FieldValue, InputValue, ResolverContext, SubscriptionField, SubscriptionFieldFuture, TypeRef,
};
use seaography::async_graphql::Error;
use seaography::{BuilderContext, CustomOutputType};

use super::status_frames::RunStatusFrame;
use super::status_stream::{self, StatusStreamRequest};
use super::{status_frames, StatusStreamService};

const FIELD: &str = "run_status_stream";
const PROJECT_ID: &str = "project_id";
const AFTER_CURSOR: &str = "after_cursor";

pub fn register(builder: seaography::Builder) -> seaography::Builder {
    let mut builder = status_frames::register(builder);
    let context: &'static BuilderContext = builder.context;
    builder.register_subscription_field(
        SubscriptionField::new(
            FIELD,
            RunStatusFrame::gql_output_type_ref(context),
            move |ctx| {
                // Arguments and the service datum are read while the resolver
                // context is alive. The opened stream then owns everything it
                // needs, so cancellation only has to drop it.
                let opened = open(&ctx);
                SubscriptionFieldFuture::new(async move {
                    Ok(opened?.map(move |frame| {
                        record_delivery(&frame);
                        field_value(context, frame)
                    }))
                })
            },
        )
        .argument(InputValue::new(
            PROJECT_ID,
            TypeRef::named_nn(TypeRef::STRING),
        ))
        .argument(InputValue::new(AFTER_CURSOR, TypeRef::named(TypeRef::INT))),
    );
    builder
}

fn record_delivery(frame: &RunStatusFrame) {
    let (project_id, agent_run_id, cursor, frame_kind) = match frame {
        RunStatusFrame::RunStatusSnapshot(frame) => (
            Some(frame.project_id.as_str()),
            None,
            Some(frame.cursor),
            "snapshot",
        ),
        RunStatusFrame::RunStatusEvent(frame) => (
            Some(frame.project_id.as_str()),
            frame.agent_run_id.as_deref(),
            Some(frame.cursor),
            "event",
        ),
        RunStatusFrame::RunStatusCaughtUp(frame) => (
            Some(frame.project_id.as_str()),
            None,
            Some(frame.cursor),
            "caught_up",
        ),
        RunStatusFrame::RunStatusResetRequired(frame) => (
            Some(frame.project_id.as_str()),
            None,
            Some(frame.cursor),
            "reset_required",
        ),
        RunStatusFrame::RunStatusFailed(_) => (None, None, None, "failed"),
    };
    ticketry_diagnostics::record_launch_discovery(
        ticketry_diagnostics::LaunchDiscoveryRecord::new(
            "graphql-frame-delivered",
            ticketry_diagnostics::runtime_instance(),
            project_id,
            agent_run_id,
            cursor,
            None,
            None,
        )
        .with_detail("frameKind", serde_json::json!(frame_kind)),
    );
}

fn open(ctx: &ResolverContext<'_>) -> Result<BoxStream<'static, RunStatusFrame>, Error> {
    let project_id = ctx.args.try_get(PROJECT_ID)?.string()?.to_owned();
    let after_cursor = match ctx.args.get(AFTER_CURSOR) {
        Some(value) if !value.is_null() => Some(value.i64()?),
        _ => None,
    };
    // An unavailable Runs service is a terminal frame rather than a transport
    // error, so a controlled client sees exactly one typed outcome shape. A
    // runtime that has not published complete readiness is unavailable in
    // exactly the same way: Studio retries the subscription, and there is no
    // legacy socket left for it to fall back to.
    if !super::readiness_gate::open(ctx.ctx) {
        return Ok(status_stream::unavailable());
    }
    let Some(service) = ctx.ctx.data_opt::<StatusStreamService>().cloned() else {
        return Ok(status_stream::unavailable());
    };
    Ok(status_stream::open(
        service,
        StatusStreamRequest {
            project_id,
            after_cursor,
        },
    ))
}

fn field_value(
    context: &'static BuilderContext,
    frame: RunStatusFrame,
) -> Result<FieldValue<'static>, Error> {
    frame
        .gql_field_value(context)
        .ok_or_else(|| Error::new("The status frame could not be published."))
}
