# Cleanup regression evaluation

`cases.json` contains 171 synthetic dictations covering corrections, preservation,
formatting, literal content, fillers, and multiple languages. All are now regression data;
use new frozen cases to validate future prompt changes.

The runner reads the current `CLEANUP_PROMPT` directly from `llm_cleanup.rs` and
uses fresh Apple Foundation Models sessions with the app's cleanup wrapper,
permissive content-transformation guardrails, greedy sampling, and 4,096 maximum
response tokens, like the Glimpse-Speech shim. It prints raw responses and
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

| Set                       | Cases | Before | After |
| ------------------------- | ----: | -----: | ----: |
| Regression                |    76 |     48 |    55 |
| Initial prompt holdout    |    42 |     26 |    31 |
| Final frozen confirmation |    20 |     10 |    14 |

These numbers include output filtering and source fallback, not just model edits.
Raw model matches on the final confirmation improved from 9 to 13. The initial
holdout informed the script safeguard; only the final confirmation was frozen
after all changes. The samples are assistant-authored and are not an independent
benchmark or statistical proof. Some corrections, spoken formatting, and
same-script translations still fail. No full microphone-to-insertion test was run.

## Results recorded October 13, 2026

Filler cases F01–F33 were added because the set had five filler cases and four
failed. F21–F30 were written before any prompt change as a filler holdout. Raw model
output on Apple's model in macOS 27, before → after the filler rule and example,
strict match / match ignoring case and punctuation:

| Set                       | Cases |  Before |   After |
| ------------------------- | ----: | ------: | ------: |
| Regression                |    76 | 45 / 49 | 53 / 55 |
| Initial prompt holdout    |    42 | 27 / 28 | 30 / 33 |
| Final frozen confirmation |    20 | 14 / 14 | 13 / 14 |
| Filler development        |    23 |   3 / 8 | 14 / 15 |
| Filler holdout            |    10 |   2 / 3 |   7 / 9 |

Qwen3.8-27B (temperature 0, no thinking) stood in for remote providers: 69 → 72
strict on the regression set, one fewer on filler development, and unchanged on
the others, so both share the prompt.
Five other variants were tried. Removing the examples or naming "like", "you know"
and "I mean" as fillers made results worse; the latter deleted intentional words.
Repeated phrases ("I think I think") and non-English hesitations still often
survive. The holdout totals were seen once before the last variant was tried.

The 10 deterministic cleanup/parser tests live alongside the production code:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib llm_cleanup::tests
```
