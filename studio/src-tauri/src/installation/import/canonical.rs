//! Canonical logical values shared by PostgreSQL and SQLite.

use sha2::{Digest, Sha256};

/// The conversion rule selected from the PostgreSQL column type.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Kind {
    Uuid,
    Boolean,
    DateTime,
    Json,
    Decimal,
    Binary,
    Integer,
    Real,
    Text,
}

impl Kind {
    #[must_use]
    pub fn from_postgres(data_type: &str, udt_name: &str) -> Self {
        match (data_type, udt_name) {
            ("uuid", _) => Self::Uuid,
            ("boolean", _) => Self::Boolean,
            ("timestamp with time zone" | "timestamp without time zone" | "date" | "time", _) => {
                Self::DateTime
            }
            ("json" | "jsonb", _) => Self::Json,
            ("numeric" | "decimal", _) => Self::Decimal,
            ("bytea", _) => Self::Binary,
            ("smallint" | "integer" | "bigint", _) => Self::Integer,
            ("real" | "double precision", _) => Self::Real,
            (_, "uuid") => Self::Uuid,
            _ => Self::Text,
        }
    }
}

/// One value after its engine-specific representation has been removed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Cell {
    Null,
    Text(String),
    Binary(Vec<u8>),
}

impl Cell {
    pub fn from_postgres(kind: Kind, value: Option<String>) -> Result<Self, String> {
        let Some(value) = value else {
            return Ok(Self::Null);
        };
        match kind {
            Kind::Uuid => Ok(Self::Text(value.replace('-', "").to_ascii_lowercase())),
            Kind::Boolean => match value.as_str() {
                "t" | "true" | "1" => Ok(Self::Text("1".to_owned())),
                "f" | "false" | "0" => Ok(Self::Text("0".to_owned())),
                _ => Err(format!("{value:?} is not a PostgreSQL boolean")),
            },
            Kind::Json => canonical_json(&value).map(Self::Text),
            Kind::Decimal => Ok(Self::Text(canonical_decimal(&value)?)),
            Kind::Binary => {
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value)
                    .map(Self::Binary)
                    .map_err(|error| format!("a PostgreSQL bytea value was not base64: {error}"))
            }
            Kind::DateTime | Kind::Integer | Kind::Real | Kind::Text => Ok(Self::Text(value)),
        }
    }

    pub fn from_sqlite(kind: Kind, value: Option<String>) -> Result<Self, String> {
        let Some(value) = value else {
            return Ok(Self::Null);
        };
        match kind {
            Kind::Binary => decode_hex(&value).map(Self::Binary),
            _ => Self::from_postgres(kind, Some(value)),
        }
    }

    fn hash_into(&self, hasher: &mut Sha256) {
        match self {
            Self::Null => hasher.update([0]),
            Self::Text(value) => {
                hasher.update([1]);
                framed(hasher, value.as_bytes());
            }
            Self::Binary(value) => {
                hasher.update([2]);
                framed(hasher, value);
            }
        }
    }
}

/// Hash rows independent of engine storage syntax and row order.
#[must_use]
pub fn digest(rows: &[Vec<Cell>]) -> String {
    let mut encoded = rows
        .iter()
        .map(|row| {
            let mut hasher = Sha256::new();
            for cell in row {
                cell.hash_into(&mut hasher);
            }
            hasher.finalize().to_vec()
        })
        .collect::<Vec<_>>();
    encoded.sort_unstable();
    let mut hasher = Sha256::new();
    for row in encoded {
        framed(&mut hasher, &row);
    }
    hex(&hasher.finalize())
}

fn canonical_json(value: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(value)
        .map_err(|error| format!("a PostgreSQL JSON value is invalid: {error}"))?;
    serde_json::to_string(&value).map_err(|error| format!("JSON could not be encoded: {error}"))
}

fn canonical_decimal(value: &str) -> Result<String, String> {
    let (negative, unsigned) = value
        .strip_prefix('-')
        .map_or((false, value), |value| (true, value));
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(format!("{value:?} is not a finite decimal"));
    }
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let fraction = fraction.trim_end_matches('0');
    let zero = whole == "0" && fraction.is_empty();
    Ok(format!(
        "{}{}{}",
        if negative && !zero { "-" } else { "" },
        whole,
        if fraction.is_empty() {
            String::new()
        } else {
            format!(".{fraction}")
        }
    ))
}

fn framed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("a SQLite blob did not encode as hexadecimal".to_owned());
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|error| error.to_string())?;
            u8::from_str_radix(pair, 16).map_err(|error| error.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{digest, Cell, Kind};

    #[test]
    fn canonicalizes_every_cross_engine_type() {
        assert_eq!(
            Cell::from_postgres(
                Kind::Uuid,
                Some("A0B1C2D3-0000-0000-0000-000000000000".into())
            )
            .unwrap(),
            Cell::Text("a0b1c2d3000000000000000000000000".into())
        );
        assert_eq!(
            Cell::from_postgres(Kind::Boolean, Some("t".into())).unwrap(),
            Cell::Text("1".into())
        );
        assert_eq!(
            Cell::from_postgres(Kind::Decimal, Some("-001.2300".into())).unwrap(),
            Cell::Text("-1.23".into())
        );
        assert_eq!(
            Cell::from_postgres(Kind::Json, Some("{\"b\":2,\"a\":1}".into())).unwrap(),
            Cell::Text("{\"a\":1,\"b\":2}".into())
        );
        assert_eq!(Cell::from_postgres(Kind::Text, None).unwrap(), Cell::Null);
        assert_eq!(
            Cell::from_postgres(Kind::Text, Some("a|b\n\0".into())).unwrap(),
            Cell::Text("a|b\n\0".into())
        );
        assert_eq!(
            Cell::from_postgres(Kind::Binary, Some("AP+A".into())).unwrap(),
            Cell::Binary(vec![0, 255, 128])
        );
    }

    #[test]
    fn row_digest_is_order_independent_and_type_sensitive() {
        let a = vec![vec![Cell::Text("1".into())], vec![Cell::Null]];
        let b = vec![vec![Cell::Null], vec![Cell::Text("1".into())]];
        assert_eq!(digest(&a), digest(&b));
        assert_ne!(
            digest(&a),
            digest(&[vec![Cell::Binary(vec![49])], vec![Cell::Null]])
        );
    }
}
