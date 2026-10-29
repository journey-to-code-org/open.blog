use openblog_core::capture;

#[test]
fn the_limits_are_advertised_for_the_phone_and_follow_the_sites_upload_size() {
    let limits = capture::limits_json(10);
    assert_eq!(limits["maxPhotos"], 12);
    assert_eq!(limits["maxNotesChars"], 8_000);
    assert_eq!(limits["maxPhotoBytes"], 10 * 1024 * 1024);
    assert_eq!(limits["maxAudioSeconds"], 180);
    assert_eq!(capture::limits_json(2)["maxPhotoBytes"], 2 * 1024 * 1024);
}

#[test]
fn only_a_32_digit_lowercase_hex_id_is_a_capture_id() {
    let id = "0123456789abcdef0123456789abcdef";
    assert!(capture::valid_id(id));
    for bad in [
        "",
        "short",
        "0123456789ABCDEF0123456789ABCDEF",
        "0123456789abcdef0123456789abcdeg",
        "../0123456789abcdef0123456789ab",
        "0123456789abcdef0123456789abcdef0",
    ] {
        assert!(!capture::valid_id(bad), "{bad}");
    }
    assert_eq!(capture::photo_stem(id, 0).unwrap(), "capture-0123456789ab-0");
    assert_eq!(capture::photo_stem(id, 11).unwrap(), "capture-0123456789ab-11");
    assert!(capture::photo_stem(id, capture::MAX_PHOTOS).is_none());
    assert!(capture::photo_stem("nope", 0).is_none());
}

#[test]
fn a_ledger_entry_is_versioned_and_a_newer_one_is_refused() {
    let text = capture::ledger_text("posts/2026-10-29-a.md");
    assert_eq!(capture::parse_ledger(&text).unwrap(), "posts/2026-10-29-a.md");
    assert!(capture::parse_ledger(r#"{"v":2,"path":"x"}"#).is_err());
    assert!(capture::parse_ledger(r#"{"v":1}"#).is_err());
    assert!(capture::parse_ledger("not json").is_err());
}

#[test]
fn the_queue_bounds_are_finite_and_nest() {
    let limits = capture::limits_json(10);
    assert_eq!(limits["storedVersion"], 1);
    assert!(capture::MAX_CAPTURE_BYTES <= capture::MAX_QUEUE_BYTES);
    assert_eq!(limits["maxQueued"], capture::MAX_QUEUED);
}
