//! Publishing an approved video release to YouTube (epic #386, story #400, ADRs 0844 to 0846).
//!
//! The pure half of the upload: what an approval binds and when it still stands, the exact
//! `videos.insert` resource sent, how a Google reply is classified into a reliable failure state,
//! how far a resumable session got, and what a lookup after an uncertain upload may conclude. The
//! command line holds the credential, the network and the files; nothing here touches any of them.

/// Lets an upload create videos and set their thumbnails
/// (<https://developers.google.com/youtube/v3/docs/videos/insert>,
/// <https://developers.google.com/youtube/v3/docs/thumbnails/set>).
pub const SCOPE_UPLOAD: &str = "https://www.googleapis.com/auth/youtube.upload";
/// Lets a lookup list the channel's own uploads after an uncertain upload
/// (<https://developers.google.com/youtube/v3/docs/channels/list>).
pub const SCOPE_READONLY: &str = "https://www.googleapis.com/auth/youtube.readonly";
/// The scopes every connection asks for, and must be granted in full.
pub const SCOPES: [&str; 2] = [SCOPE_UPLOAD, SCOPE_READONLY];
