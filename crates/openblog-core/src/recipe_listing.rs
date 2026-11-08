//! The recipe listing: `/recipes/` and one filter page per course and cuisine
//! (ADR 0352). Pure grouping of the site's published recipes; the renderer
//! turns each archive into pages the way it does for jobs.
//!
//! Unlike `/services/`, the address is not reserved. An owner's own page keeps
//! its address and the listing gives way, because reserving it would stop her
//! saving a page she already has the moment she publishes a first recipe.

use std::collections::{BTreeMap, HashMap};

use crate::model::{Site, SourceFile};
use crate::recipe::{self, Recipe};
use crate::render::url_to_file;
use crate::slug::{limit, slugify};

pub const RECIPES_URL: &str = "/recipes/";
/// Where the list of every recipe goes when the owner has a page at [`RECIPES_URL`].
pub const RECIPES_FALLBACK_URL: &str = "/recipes/all/";

/// The longest filter address segment, the rule tags follow.
const MAX_SLUG_CHARS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecipeArchiveKind {
    All,
    Course,
    Cuisine,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecipeArchive {
    pub kind: RecipeArchiveKind,
    /// The address of the first page, ending in `/`.
    pub url: String,
    /// The value as the newest recipe spells it; "Recipes" for the whole list.
    pub name: String,
    pub title: String,
    pub description: String,
    /// Indices into `Site::posts`, newest first.
    pub posts: Vec<usize>,
}

impl RecipeArchive {
    /// How many pages the archive needs at `per_page` posts a page (0 means
    /// one page with everything).
    pub fn page_count(&self, per_page: usize) -> usize {
        crate::job_archive::page_count(self.posts.len(), per_page)
    }

    pub fn page_url(&self, page_number: usize) -> String {
        crate::job_archive::page_url(&self.url, page_number)
    }
}

/// Every page the site's recipes call for. A site with no published recipe
/// gets the empty plan, so nothing changes for it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RecipePlan {
    /// The whole list when it has an address, then courses, then cuisines,
    /// each in slug order.
    pub archives: Vec<RecipeArchive>,
    /// Where the whole list lives, if the owner's own pages left it an address.
    pub all_url: Option<String>,
    /// One plain sentence, for the owner, for each page that gave way to her
    /// address and each value that could not have a page.
    pub notes: Vec<String>,
}

impl RecipePlan {
    /// The filter pages of one kind, in slug order.
    pub fn filters(&self, kind: RecipeArchiveKind) -> impl Iterator<Item = &RecipeArchive> {
        self.archives.iter().filter(move |a| a.kind == kind)
    }

    /// The filter page a value belongs on, if it has one.
    pub fn filter_url(&self, kind: RecipeArchiveKind, value: &str) -> Option<&str> {
        let url = filter_address(kind, &address_part(value))?;
        self.filters(kind)
            .find(|archive| archive.url == url)
            .map(|archive| archive.url.as_str())
    }
}

fn address_part(value: &str) -> String {
    limit(&slugify(value), MAX_SLUG_CHARS)
}

fn filter_address(kind: RecipeArchiveKind, slug: &str) -> Option<String> {
    let segment = match kind {
        RecipeArchiveKind::All => return None,
        RecipeArchiveKind::Course => "course",
        RecipeArchiveKind::Cuisine => "cuisine",
    };
    Some(format!("{RECIPES_URL}{segment}/{slug}/"))
}

/// Plan the listing. Membership is [`Site::is_published`], not `post.draft`, so
/// a scheduled post or a preview load's draft never opens a page.
pub fn plan(site: &Site) -> RecipePlan {
    if !site.config.recipes.listing {
        return RecipePlan::default();
    }
    let mut all = Vec::new();
    let mut courses = Filters::default();
    let mut cuisines = Filters::default();
    for (index, post) in site.posts.iter().enumerate() {
        let Some(recipe) = &post.recipe else { continue };
        if !site.is_published(post) {
            continue;
        }
        all.push(index);
        courses.add(recipe.courses(), index);
        cuisines.add(recipe.cuisines(), index);
    }
    if all.is_empty() {
        return RecipePlan::default();
    }

    let claimed = claimed_files(site);
    let is_claimed = |url: &str| claimed.contains_key(&url_to_file(url));
    let how_to_free = |url: &str, goal: &str| {
        claimed
            .get(&url_to_file(url))
            .map(|claim| claim.how_to_free(url, goal))
            .unwrap_or_default()
    };
    let mut notes = Vec::new();
    let all_url = if !is_claimed(RECIPES_URL) {
        Some(RECIPES_URL)
    } else if !is_claimed(RECIPES_FALLBACK_URL) {
        notes.push(format!(
            "A page of yours already uses the address {RECIPES_URL}, so the automatic list of recipes is at {RECIPES_FALLBACK_URL}. {}",
            how_to_free(RECIPES_URL, "move the list back")
        ));
        Some(RECIPES_FALLBACK_URL)
    } else {
        notes.push(format!(
            "Pages of yours already use the addresses {RECIPES_URL} and {RECIPES_FALLBACK_URL}, so there is no automatic list of all your recipes. {}",
            how_to_free(RECIPES_URL, "bring the list back")
        ));
        None
    };

    let mut archives = Vec::new();
    if let Some(url) = all_url {
        archives.push(RecipeArchive {
            kind: RecipeArchiveKind::All,
            url: url.into(),
            name: "Recipes".into(),
            title: "Recipes".into(),
            description: "Every recipe, newest first.".into(),
            posts: all,
        });
    }
    let mut wordless = Vec::new();
    for (kind, word, example, filters) in [
        (RecipeArchiveKind::Course, "course", "Dessert", courses),
        (RecipeArchiveKind::Cuisine, "cuisine", "Italian", cuisines),
    ] {
        for value in filters.without_address {
            wordless.push(format!(
                "The {word} \"{value}\" has no letters or numbers to make a web address from, so readers can't browse recipes by it. Add a word to it, such as {example}."
            ));
        }
        for (slug, (name, posts)) in filters.by_slug {
            let Some(url) = filter_address(kind, &slug) else {
                continue;
            };
            if is_claimed(&url) {
                notes.push(format!(
                    "A page of yours already uses the address {url}, so recipes can't be filtered by {name}. {}",
                    how_to_free(&url, "bring the filter back")
                ));
                continue;
            }
            archives.push(RecipeArchive {
                kind,
                url,
                title: format!("{name} recipes"),
                description: format!("{name} recipes, newest first."),
                name,
                posts,
            });
        }
    }
    notes.append(&mut wordless);
    RecipePlan {
        archives,
        all_url: all_url.map(str::to_string),
        notes,
    }
}

/// The recipes of each value of one facet, by slug.
#[derive(Default)]
struct Filters {
    /// The name first seen, which is the newest recipe's spelling, and the
    /// indices of its recipes.
    by_slug: BTreeMap<String, (String, Vec<usize>)>,
    /// Values with nothing to make an address from, each once. They get no
    /// page, and the owner is told.
    without_address: Vec<String>,
}

impl Filters {
    fn add(&mut self, values: Vec<String>, index: usize) {
        for value in values {
            let slug = address_part(&value);
            if slug.is_empty() {
                if !self.without_address.contains(&value) {
                    self.without_address.push(value);
                }
                continue;
            }
            let (_, posts) = self.by_slug.entry(slug).or_insert((value, Vec::new()));
            // "Dessert, dessert" files a recipe once.
            if posts.last() != Some(&index) {
                posts.push(index);
            }
        }
    }
}

/// Which of the owner's documents holds an address and how, which decides what
/// she has to change to free it.
#[derive(Clone, Copy)]
struct Claim<'a> {
    noun: &'static str,
    title: &'a str,
    by_alias: bool,
}

impl Claim<'_> {
    /// The sentence that tells her how to get the address back. Admin can
    /// change a Slug but has no field for a document's old addresses, so that
    /// case says who can.
    fn how_to_free(&self, url: &str, goal: &str) -> String {
        let Claim { noun, title, .. } = self;
        if self.by_alias {
            format!(
                "To {goal}, ask whoever helps with your site to remove the old address {url} from the file of your {noun} \"{title}\". Admin has no setting for it."
            )
        } else {
            format!(
                "To {goal}, open your {noun} \"{title}\", and in Settings change its Slug, the last part of its web address, to another name, such as my-recipes."
            )
        }
    }
}

/// The files the owner's own posts, pages and series, with their aliases, write.
fn claimed_files(site: &Site) -> HashMap<String, Claim<'_>> {
    let posts = site
        .posts
        .iter()
        .map(|p| ("post", p.title.as_str(), &p.url, &p.aliases));
    let pages = site
        .pages
        .iter()
        .map(|p| ("page", p.title.as_str(), &p.url, &p.aliases));
    let series = site
        .series
        .iter()
        .filter(|s| !s.posts.is_empty())
        .map(|s| ("series", s.name.as_str(), &s.url, &s.aliases));
    let documents: Vec<_> = posts.chain(pages).chain(series).collect();
    let aliases = documents.iter().flat_map(|(noun, title, _, aliases)| {
        aliases.iter().map(move |url| {
            let claim = Claim {
                noun,
                title,
                by_alias: true,
            };
            (url_to_file(url), claim)
        })
    });
    // A document's own address wins over another's alias.
    let own = documents.iter().map(|(noun, title, url, _)| {
        let claim = Claim {
            noun,
            title,
            by_alias: false,
        };
        (url_to_file(url), claim)
    });
    aliases.chain(own).collect()
}

/// The courses and cuisines the owner has already written, read from the post
/// sources (drafts included) so Admin can offer them back to her. A value that
/// can't have a filter page is not worth offering.
pub fn owner_values(posts: &[SourceFile]) -> (Vec<String>, Vec<String>) {
    let mut courses = Vec::new();
    let mut cuisines = Vec::new();
    for file in posts {
        let Ok(doc) = crate::frontmatter::parse(&file.contents) else {
            continue;
        };
        if !recipe::is_recipe(&doc.front_matter) {
            continue;
        }
        let recipe = Recipe::from_front_matter(&doc.front_matter, Vec::new(), Vec::new());
        let has_address = |value: &String| !address_part(value).is_empty();
        courses.extend(recipe.courses().into_iter().filter(has_address));
        cuisines.extend(recipe.cuisines().into_iter().filter(has_address));
    }
    (courses, cuisines)
}
