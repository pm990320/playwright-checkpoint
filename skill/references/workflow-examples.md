# Workflow examples (triage playbooks)

Use these examples as a strict triage order: manifest -> summary deltas -> artifact correlation -> fix -> targeted re-run.

## Scenario 1: Mobile checkout button is missing

### Symptoms
- User reports checkout cannot complete on mobile.
- Desktop test still passes.

### Step-by-step
1. Open `checkpoint-manifest.json` for both desktop and mobile projects.
2. Align same checkpoint (`03-cart-review`) across variants.
3. Compare summaries:
   - mobile `web-vitals.cls` spikes,
   - mobile screenshot exists but CTA not visible.
4. Open `page.png` for mobile: sticky promo overlaps footer action bar.
5. Open `page.html`: confirm CTA still in DOM (not removed).
6. Open `console-errors.json`: no runtime exception.
7. Root cause: layout overlap, not functional logic.
8. Fix CSS (reserve space for sticky promo on mobile).
9. Re-run only affected path:
   ```bash
   npx playwright test tests/checkout.spec.ts --project mobile-dark
   ```
10. Verify:
    - button visible,
    - CLS improved,
    - no regression on desktop.

## Scenario 2: Login intermittently fails in CI

### Symptoms
- Flaky sign-in flow in CI.
- Local runs often pass.

### Step-by-step
1. Check `failed-requests.json` at `02-after-submit`.
2. Find intermittent 401/429 from auth API.
3. Open `storage-state.json`:
   - missing expected session cookie on failed runs.
4. Open `form-state.json`:
   - username populated,
   - password redacted but field recorded as present and non-empty.
5. Open `console-errors.json`:
   - no frontend exception.
6. Open `network-timing.json`:
   - auth endpoint response delay spikes before failure.
7. Root cause hypothesis: backend rate limit / auth race, not selector issue.
8. Apply fix:
   - improve test data isolation,
   - avoid shared credentials under parallel load,
   - add resilient wait around auth completion state.
9. Re-run focused subset:
   ```bash
   npx playwright test --grep @authentication --project desktop-light
   ```
10. Confirm reduced flake and stable cookie/session creation.

## Scenario 3: Accessibility regressions after UI refactor

### Symptoms
- A11y checks jump from 3 violations to 18.
- Visual output appears mostly unchanged.

### Step-by-step
1. Open `checkpoint-manifest.json` and compare `axe.summary.violations` before/after refactor.
2. Open `axe.json` and sort by impact:
   - critical/serious first.
3. Open `aria-snapshot.json`:
   - detect missing `main` landmark and altered heading structure.
4. Open `page.html`:
   - verify form inputs lost explicit label associations.
5. Root causes:
   - component refactor removed semantic wrappers,
   - custom field component dropped `for/id` linking.
6. Fix semantic structure and labeling.
7. Re-run only affected flow and variant:
   ```bash
   npx playwright test tests/account.spec.ts --project desktop-light --grep @smoke
   ```
8. Validate:
   - critical/serious violations cleared,
   - ARIA tree structure restored,
   - no functional regressions.

---

## Practical checklist before closing any defect

- [ ] Reproduced issue with a stable checkpoint name.
- [ ] Confirmed root cause using at least two collectors.
- [ ] Re-ran single test + single variant for fast validation.
- [ ] Re-ran broader suite/tag slice if blast radius is non-trivial.
- [ ] Added/updated checkpoint description if docs should reflect the fix.
