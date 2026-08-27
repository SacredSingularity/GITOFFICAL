# LessonCanvas — Round 8 Testing Report

Manual browser pass on `lessoncanvas.html`, per `lessoncanvas-fix-plan-round8.md`. **No code changes
were made this round** — every item passed on the first genuine test (one false alarm on item 2,
caused by a test-script mistake, not an app bug; see below).

## Results

| # | Item | Result |
|---|---|---|
| 1 | Widget persistence (slider value, threshold reveal, steps-shown count) across slide nav | ✅ Pass |
| 2 | All six overlays close via close button, backdrop click, and Escape; AI Helper + AI Inspect stack correctly | ✅ Pass |
| 3 | Focus restores to the triggering button after modal close; dot `:focus-visible` ring visible on real Tab | ✅ Pass |
| 4 | Arrow-key slide nav blocked while AI Helper input is focused, a modal is open, or the whiteboard is open | ✅ Pass |
| 5 | SRI sanity — network on, no "features unavailable" banner, no console errors | ✅ Pass |
| 6 | Offline degradation — CDN blocked, banner names all three missing features, dismiss causes no scroll jump | ✅ Pass |
| 7 | AI Helper request body is exactly `{ question, context }` (no `messages`), and a real answer comes back | ✅ Pass |

## Notes

- **Item 2 false alarm:** the first backdrop-click test used `element.click()`, which only fires a
  synthetic `click` event. The actual close-on-backdrop-click handler listens for `mousedown`
  (`backdrop.addEventListener('mousedown', ...)`), so the first pass looked like a failure. Re-tested
  with a real `mousedown` dispatch and it closed correctly — not a bug, a test-tooling mistake.
- **Item 6** required building a temporary copy of `lessoncanvas.html` with `cdn.jsdelivr.net` and
  `cdnjs.cloudflare.com` replaced by invalid domains, run from inside the project folder (files
  outside it only render as static, non-interactive snapshots in the test browser), then deleted
  after testing. No trace left behind.
- **Item 7** confirmed via `fetch` interception on a fresh page load: the captured request body's
  keys are exactly `["question", "context"]`, and the live Worker returned a correct, on-topic
  answer.

## Outcome

Step 2 of the round-8 plan (README authoring checklist) was already in place from round 7, verbatim
match to what was asked — nothing to add there either.

Per the plan: after this pass, the project has no known outstanding work.
