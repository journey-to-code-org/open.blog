//! Content profiles augment posts with field-specific authoring and rendering
//! behavior without creating new document kinds.

use crate::frontmatter::FrontMatter;

pub const ARTICLE_ID: &str = "article";
pub const RECIPE_ID: &str = "recipe";
pub const RESEARCH_ID: &str = "research";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileFieldKind {
    Text,
    Number,
    Duration,
}

impl ProfileFieldKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "number",
            Self::Duration => "duration",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProfileField {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: ProfileFieldKind,
    pub help: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentProfile {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub fields: &'static [ProfileField],
}

const RECIPE_FIELDS: &[ProfileField] = &[
    ProfileField {
        key: "servings",
        label: "Servings",
        kind: ProfileFieldKind::Number,
        help: "Number of servings.",
    },
    ProfileField {
        key: "yield",
        label: "Yield",
        kind: ProfileFieldKind::Text,
        help: "What the recipe makes, such as 12 cookies.",
    },
    ProfileField {
        key: "prepTime",
        label: "Prep time",
        kind: ProfileFieldKind::Duration,
        help: "A readable duration such as 20 min.",
    },
    ProfileField {
        key: "cookTime",
        label: "Cook time",
        kind: ProfileFieldKind::Duration,
        help: "A readable duration such as 1 hour.",
    },
    ProfileField {
        key: "totalTime",
        label: "Total time",
        kind: ProfileFieldKind::Duration,
        help: "Optional total duration.",
    },
    ProfileField {
        key: "cuisine",
        label: "Cuisine",
        kind: ProfileFieldKind::Text,
        help: "Cuisine or food tradition.",
    },
    ProfileField {
        key: "category",
        label: "Category",
        kind: ProfileFieldKind::Text,
        help: "Meal or recipe category.",
    },
    ProfileField {
        key: "calories",
        label: "Calories",
        kind: ProfileFieldKind::Text,
        help: "Free text such as 520 kcal.",
    },
];

const RESEARCH_FIELDS: &[ProfileField] = &[
    ProfileField {
        key: "doi",
        label: "DOI",
        kind: ProfileFieldKind::Text,
        help: "DOI assigned to this work, as a DOI name or https://doi.org URL.",
    },
    ProfileField {
        key: "license",
        label: "License",
        kind: ProfileFieldKind::Text,
        help: "Absolute URL of the license that applies to this work.",
    },
];

const PROFILES: &[ContentProfile] = &[
    ContentProfile {
        id: ARTICLE_ID,
        label: "Article",
        description: "A general-purpose article with standard publishing metadata.",
        fields: &[],
    },
    ContentProfile {
        id: RECIPE_ID,
        label: "Recipe",
        description: "A recipe with ingredients, steps, timing, servings, and structured data.",
        fields: RECIPE_FIELDS,
    },
    ContentProfile {
        id: RESEARCH_ID,
        label: "Research",
        description: "A research article with portable references and scholarly metadata.",
        fields: RESEARCH_FIELDS,
    },
];

pub fn catalog() -> &'static [ContentProfile] {
    PROFILES
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileBehavior {
    Article,
    Recipe,
    Research,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileResolution {
    pub id: String,
    pub behavior: ProfileBehavior,
    pub warnings: Vec<String>,
}

/// Resolve the profile used by a post, including recipe markers supported by
/// earlier open.blog releases.
pub fn resolve(front_matter: &FrontMatter) -> ProfileResolution {
    if let Some(authored_id) = canonical_id(front_matter) {
        let normalized_id = authored_id.to_ascii_lowercase();
        let known = is_known(&normalized_id);
        let id = if known {
            normalized_id.clone()
        } else {
            authored_id
        };
        let behavior = match normalized_id.as_str() {
            RECIPE_ID => ProfileBehavior::Recipe,
            RESEARCH_ID => ProfileBehavior::Research,
            _ => ProfileBehavior::Article,
        };
        let mut warnings = Vec::new();
        if !known {
            warnings.push(format!(
                "unknown content profile `{id}`; rendering as an article"
            ));
        }
        if legacy_recipe(front_matter) && behavior != ProfileBehavior::Recipe {
            warnings.push(format!("profile `{id}` overrides the legacy recipe marker"));
        }
        return ProfileResolution {
            id,
            behavior,
            warnings,
        };
    }
    if legacy_recipe(front_matter) {
        return ProfileResolution {
            id: RECIPE_ID.into(),
            behavior: ProfileBehavior::Recipe,
            warnings: Vec::new(),
        };
    }
    ProfileResolution {
        id: ARTICLE_ID.into(),
        behavior: ProfileBehavior::Article,
        warnings: Vec::new(),
    }
}

fn is_known(id: &str) -> bool {
    catalog().iter().any(|profile| profile.id == id)
}

fn canonical_id(front_matter: &FrontMatter) -> Option<String> {
    front_matter
        .get("profile")
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn legacy_recipe(front_matter: &FrontMatter) -> bool {
    front_matter.get_bool("recipe") == Some(true)
        || ["type", "layout", "kind"]
            .iter()
            .filter_map(|key| front_matter.get(key))
            .any(|value| value.trim().eq_ignore_ascii_case(RECIPE_ID))
}
