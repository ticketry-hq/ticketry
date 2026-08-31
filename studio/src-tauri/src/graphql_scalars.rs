//! Seaography scalar adapters this application defines.
//!
//! Every slice's GraphQL surface needs the same handful of list and patch
//! shapes, so they live below all of them rather than inside whichever slice
//! happened to need one first.

use seaography::{
    async_graphql::dynamic::{FieldValue, TypeRef, ValueAccessor},
    BuilderContext, CustomInputType, CustomOutputType, SeaResult, SeaographyError,
};
use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct StringList(pub Vec<String>);

impl CustomOutputType for StringList {
    fn gql_output_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::NonNull(Box::new(TypeRef::List(Box::new(TypeRef::named_nn(
            "String",
        )))))
    }

    fn gql_field_value(self, _ctx: &'static BuilderContext) -> Option<FieldValue<'static>> {
        Some(FieldValue::list(self.0.into_iter().map(FieldValue::value)))
    }
}

impl CustomInputType for StringList {
    fn gql_input_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::NonNull(Box::new(TypeRef::List(Box::new(TypeRef::named_nn(
            "String",
        )))))
    }

    fn parse_value(
        _ctx: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        let value =
            value.ok_or_else(|| SeaographyError::AsyncGraphQLError("Value expected".into()))?;
        let values = value
            .list()?
            .iter()
            .map(|item| item.string().map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(values))
    }
}
