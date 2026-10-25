//! A shared reflection's place in a series (ADR 0036).
//!
//! There is no collaborative-series entity. A placement is the two front matter values an
//! ordinary Post already uses, `series` and `seriesOrder`, so title, description, theme, cover,
//! ordering and navigation all come from the existing series model and the site's own
//! `content/series/<slug>.md`. A participant never writes any of those. What a placement adds to
//! the private record is the reference itself, which is public output and therefore part of what
//! every author approves (ADR 0020).

use crate::collaboration::{valid_text, SharedPublication};
use crate::slug;

/// Front matter keys, identical to the ones an ordinary Post uses.
pub const SERIES_KEY: &str = "series";
pub const SERIES_ORDER_KEY: &str = "seriesOrder";

pub const MAX_SERIES_REFERENCE_BYTES: usize = 120;

/// The series a publication joins and, optionally, its explicit position.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, Eq, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SeriesPlacement {
    /// Any title one line long. The site slugifies it exactly as it does a Post's `series`.
    pub series: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

/// Why a placement was refused. It never repeats the submitted value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeriesError {
    /// Blank, over-long, multi-line, or made of control or direction characters.
    Reference,
    /// The text has no letter or digit, so no series address can be made from it.
    NoAddress,
}

impl std::fmt::Display for SeriesError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Reference => "invalid series title",
            Self::NoAddress => "a series title needs at least one letter or digit",
        })
    }
}

impl std::error::Error for SeriesError {}

impl SeriesPlacement {
    /// Trim and check a placement. Every Unicode title with a letter or digit is accepted.
    pub fn new(series: &str, order: Option<u32>) -> Result<Self, SeriesError> {
        let series = series.trim();
        if !valid_text(series, MAX_SERIES_REFERENCE_BYTES) {
            return Err(SeriesError::Reference);
        }
        if slug::slugify(series).is_empty() {
            return Err(SeriesError::NoAddress);
        }
        Ok(Self {
            series: series.to_string(),
            order,
        })
    }

    pub fn validate(&self) -> Result<(), SeriesError> {
        Self::new(&self.series, self.order).and_then(|clean| {
            if clean == *self {
                Ok(())
            } else {
                Err(SeriesError::Reference)
            }
        })
    }

    /// The approvable form. A tag no user text can contain (control characters are refused)
    /// keeps it from ever equalling a title or source value.
    pub(crate) fn binding_values(&self) -> [String; 2] {
        [
            format!("\u{0}series\u{0}{}", self.series),
            format!(
                "\u{0}seriesOrder\u{0}{}",
                self.order.map(|n| n.to_string()).unwrap_or_default()
            ),
        ]
    }
}

impl SharedPublication {
    /// The record with its series placement set or, with `None`, removed. A change alters
    /// public output, so callers reconcile approvals in the same write (`ApprovalSet::reconcile`);
    /// the binding is recomputed on every read, so a missed call still fails closed.
    pub fn with_series(&self, placement: Option<SeriesPlacement>) -> Result<Self, SeriesError> {
        if let Some(placement) = &placement {
            placement.validate()?;
        }
        let mut record = self.clone();
        record.series = placement;
        Ok(record)
    }
}
