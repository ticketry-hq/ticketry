//! GraphQL argument adapters that preserve `omitted | null | value`.
//!
//! A plain `Option<T>` argument collapses "the caller said null" into "the
//! caller said nothing", which a restricted patch input may not do. These
//! adapters carry the distinction through to `workflow::PatchValue`.

use seaography::{
    async_graphql::dynamic::{TypeRef, ValueAccessor},
    BuilderContext, CustomInputType, SeaResult,
};

use super::commands::workflow;
use ticketry_entities::StringList;

pub struct GraphqlPatchString(pub workflow::PatchValue<String>);
pub struct GraphqlPatchBool(pub workflow::PatchValue<bool>);
pub struct GraphqlPatchStringList(pub workflow::PatchValue<StringList>);
pub struct GraphqlPatchJson(pub workflow::PatchValue<serde_json::Value>);
/// WorkItem fields whose generated full-mutation variables use `null` as the
/// representation of an omitted optional argument.
///
/// This is intentionally separate from [`GraphqlPatchString`], because
/// explicit `null` remains meaningful for parent detachment and launch-binding
/// clearing.
pub struct GraphqlPatchStringNullAsUnset(pub workflow::PatchValue<String>);
pub struct GraphqlPatchBoolNullAsUnset(pub workflow::PatchValue<bool>);
pub struct GraphqlPatchStringListNullAsUnset(pub workflow::PatchValue<StringList>);
pub struct GraphqlPatchJsonNullAsUnset(pub workflow::PatchValue<serde_json::Value>);

impl CustomInputType for GraphqlPatchStringNullAsUnset {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named(TypeRef::STRING)
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Unset,
            Some(value) => workflow::PatchValue::Value(value.string()?.to_owned()),
        }))
    }
}

impl CustomInputType for GraphqlPatchBoolNullAsUnset {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named(TypeRef::BOOLEAN)
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Unset,
            Some(value) => workflow::PatchValue::Value(value.boolean()?),
        }))
    }
}

impl CustomInputType for GraphqlPatchStringListNullAsUnset {
    fn gql_input_type_ref(ctx: &'static BuilderContext) -> TypeRef {
        match StringList::gql_input_type_ref(ctx) {
            TypeRef::NonNull(inner) => *inner,
            other => other,
        }
    }

    fn parse_value(
        ctx: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Unset,
            Some(value) => {
                workflow::PatchValue::Value(StringList::parse_value(ctx, Some(value))?)
            }
        }))
    }
}
impl CustomInputType for GraphqlPatchJsonNullAsUnset {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named("Json")
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Unset,
            Some(value) => workflow::PatchValue::Value(value.deserialize()?),
        }))
    }
}

impl CustomInputType for GraphqlPatchString {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named(TypeRef::STRING)
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Null,
            Some(value) => workflow::PatchValue::Value(value.string()?.to_owned()),
        }))
    }
}

impl CustomInputType for GraphqlPatchBool {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named(TypeRef::BOOLEAN)
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Null,
            Some(value) => workflow::PatchValue::Value(value.boolean()?),
        }))
    }
}

impl CustomInputType for GraphqlPatchStringList {
    fn gql_input_type_ref(ctx: &'static BuilderContext) -> TypeRef {
        match StringList::gql_input_type_ref(ctx) {
            TypeRef::NonNull(inner) => *inner,
            other => other,
        }
    }

    fn parse_value(
        ctx: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Null,
            Some(value) => workflow::PatchValue::Value(StringList::parse_value(ctx, Some(value))?),
        }))
    }
}

impl CustomInputType for GraphqlPatchJson {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named("Json")
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => workflow::PatchValue::Unset,
            Some(value) if value.is_null() => workflow::PatchValue::Null,
            Some(value) => workflow::PatchValue::Value(value.deserialize()?),
        }))
    }
}
