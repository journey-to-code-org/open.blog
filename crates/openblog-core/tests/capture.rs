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
