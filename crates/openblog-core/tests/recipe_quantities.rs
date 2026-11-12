//! The recipe check reads ingredient amounts the way the reader's scaler does (ADR 0334): the
//! same cases run here and in `tests/web/quantity.test.mjs` against `findQuantity`.

use openblog_core::recipe_check::{quantity, scaler_amounts, scaler_metric, Quantity};

#[test]
fn the_check_reads_every_shared_case_as_the_scaler_does() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/recipe-quantities.json"
    ))
    .unwrap();
    let rounded = |values: Vec<f64>| -> Vec<f64> {
        values
            .into_iter()
            .map(|v| (v * 1e6).round() / 1e6)
            .collect()
    };
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() > 20);
    for case in cases {
        let line = case["line"].as_str().unwrap();
        let expected: Option<Vec<f64>> = serde_json::from_value(case["values"].clone()).unwrap();
        assert_eq!(
            scaler_amounts(line).map(rounded),
            expected,
            "values of {line:?}"
        );
        if expected.is_some() {
            assert_eq!(
                scaler_metric(line),
                case["metric"].as_bool().unwrap(),
                "metric of {line:?}"
            );
        }
        let code = match quantity(line) {
            Quantity::Problem(code) => Some(code.as_str()),
            Quantity::Amount(_) | Quantity::None => None,
        };
        assert_eq!(code, case["check"].as_str(), "check of {line:?}");
    }
}
