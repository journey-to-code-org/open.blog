//! `POST pieces` with codes (Studio R6 G44) and the question-for-readers and code-block kinds (G45):
//! each problem names its field, row and code; the sentences stay for the old Admin.

use super::*;

fn pieces(f: &Fixture, s: &(String, String), body: Json) -> (u16, Json) {
    let response = handle(
        &f.state,
        &authed(json_req("POST", "/admin/api/pieces", body), s, true),
    );
    (response.status, body_json(&response))
}

#[test]
fn a_refused_piece_says_each_problem_by_field_row_and_code_and_keeps_the_sentences() {
    let f = fixture("pieces-coded");
    let s = login_ok(&f);
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "faq", "values": [["question", "Can I freeze it?"], ["answer", "Yes."], ["question", ""], ["answer", "No."]] }),
    );
    assert_eq!(status, 422);
    assert_eq!(answer["code"], "required");
    assert!(
        answer["problems"][0].is_string(),
        "the old Admin reads sentences"
    );
    assert_eq!(answer["issues"][0]["field"], "question");
    assert_eq!(answer["issues"][0]["item"], 1);
    assert_eq!(answer["issues"][0]["code"], "required");
    assert!(answer["issues"][0]["message"].is_string());

    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "callout", "values": [["tone", "success"], ["title", "x".repeat(81)], ["body", "Bake <b>early</b>"]] }),
    );
    assert_eq!(status, 422);
    let codes: Vec<(String, String)> = answer["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["field"].as_str().unwrap_or("").into(),
                p["code"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert!(codes.contains(&("body".into(), "html".into())), "{codes:?}");

    let (_, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "button", "values": [["label", "Order"], ["href", "http://example.com"]] }),
    );
    assert_eq!(answer["issues"][0]["field"], "href");
    assert_eq!(answer["issues"][0]["code"], "bad-address");
    let (_, answer) = pieces(&f, &s, json!({ "kind": "gallery", "values": [] }));
    assert_eq!(answer["issues"][0]["code"], "unknown-kind");
    let (_, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "compare", "values": [["before", "/images/a.jpg"], ["after", "/images/b.jpg"], ["after-alt", "The loaf"]] }),
    );
    assert_eq!(answer["issues"][0]["field"], "before-alt");
    assert_eq!(answer["issues"][0]["code"], "required");
}

#[test]
fn the_size_limits_and_a_bad_request_carry_codes() {
    let f = fixture("pieces-limits");
    let s = login_ok(&f);
    let many: Vec<Json> = (0..=MAX_PIECE_VALUES)
        .map(|i| json!([format!("f{i}"), "x"]))
        .collect();
    let (status, answer) = pieces(&f, &s, json!({ "kind": "button", "values": many }));
    assert_eq!((status, answer["code"].as_str()), (413, Some("too-many")));
    let big = "x".repeat(MAX_PIECE_REQUEST_BYTES + 1);
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "button", "values": [["label", big]] }),
    );
    assert_eq!((status, answer["code"].as_str()), (413, Some("too-large")));
    let (status, answer) = pieces(&f, &s, json!({ "kind": "button", "values": "label=x" }));
    assert_eq!(
        (status, answer["code"].as_str()),
        (400, Some("bad-request"))
    );
}

#[test]
fn a_question_for_readers_and_a_code_block_come_back_as_the_markdown_the_build_reads() {
    let f = fixture("pieces-quiz-code");
    let s = login_ok(&f);
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "quiz", "values": [["question", "Which oven?"], ["answer", "Hot"], ["answer", "Cool"], ["right", "1"]] }),
    );
    assert_eq!(status, 200, "{answer}");
    assert_eq!(
        answer["markdown"],
        "```quiz\nWhich oven?\n- [x] Hot\n- [ ] Cool\n```\n"
    );
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "quiz", "values": [["question", "Q"], ["answer", "![a](/images/a.jpg)"], ["answer", "b"], ["right", "2"]] }),
    );
    assert_eq!(status, 422);
    assert_eq!(answer["issues"][0]["code"], "links");
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "code", "values": [["language", "js"], ["title", "app.js"], ["highlight", "1"], ["body", "let a = 1;"]] }),
    );
    assert_eq!(status, 200, "{answer}");
    assert_eq!(
        answer["markdown"],
        "```js title=\"app.js\" {1}\nlet a = 1;\n```\n"
    );
    let (status, answer) = pieces(
        &f,
        &s,
        json!({ "kind": "code", "values": [["highlight", "two"], ["body", "x"]] }),
    );
    assert_eq!(status, 422);
    assert_eq!(answer["issues"][0]["field"], "highlight");
    assert_eq!(answer["issues"][0]["code"], "bad-lines");
    // The build agrees: a post holding both builds.
    let post = format!(
        "---\ntitle: Both\ndate: 2026-01-01\n---\n\n{}\n{}",
        "```quiz\nWhich oven?\n- [x] Hot\n- [ ] Cool\n```\n",
        "```js title=\"app.js\" {1}\nlet a = 1;\n```\n"
    );
    fs::write(f.dir.join("content/posts/2026-01-01-both.md"), post).unwrap();
    let mut status = lock(&f.state.build);
    assert!(f.state.rebuild_locked(&mut status).is_ok());
}
