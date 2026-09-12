# Cleanup regression evaluation

`cases.json` contains 138 synthetic dictations covering corrections, preservation,
formatting, literal content, and multiple languages. All are now regression data;
use new frozen cases to validate future prompt changes.

The runner reads the current `CLEANUP_PROMPT` directly from `llm_cleanup.rs` and
uses fresh Apple Foundation Models sessions with the app's cleanup wrapper,
temperature 0, and 4,096 maximum response tokens. It prints raw responses and
expected outputs as JSONL. It does not apply the app's output filtering or enforce
its 60-second timeout. Run only on a Mac with Apple Foundation Models available.

From the repository root:

```sh
eval_dir="$(mktemp -d)"
xcrun swiftc -parse-as-library tests/llm-cleanup/evaluate.swift -o "$eval_dir/evaluate"
"$eval_dir/evaluate" . > "$eval_dir/results.jsonl"
# Run selected cases:
"$eval_dir/evaluate" . 01 H25 C19
```

Review output against the expectations; these are not exact-match CI tests.
Some cases have known model failures. Arabic, Hindi, and Russian were reported
unsupported by the model used for the original evaluation. Preserved text alone
does not establish language support.

## Results recorded September 12, 2026

On Apple's model in macOS 26.6.2, before → after expected final outputs:

| Set | Cases | Before | After |
| --- | ---: | ---: | ---: |
| Regression | 76 | 48 | 55 |
| Initial prompt holdout | 42 | 26 | 31 |
| Final frozen confirmation | 20 | 10 | 14 |

These numbers include output filtering and source fallback, not just model edits.
Raw model matches on the final confirmation improved from 9 to 13. The initial
holdout informed the script safeguard; only the final confirmation was frozen
after all changes. The samples are assistant-authored and are not an independent
benchmark or statistical proof. Some corrections, spoken formatting, and
same-script translations still fail. No full microphone-to-insertion test was run.

The 10 deterministic cleanup/parser tests live alongside the production code:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib llm_cleanup::tests
```
