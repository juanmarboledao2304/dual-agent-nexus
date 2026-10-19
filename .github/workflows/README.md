# .github/workflows/

GitHub Actions workflows for this repository.

| Workflow           | Triggers                                   | What it does |
| ------------------ | ------------------------------------------ | ------------ |
| `ci.yml`           | push and pull request (all branches)       | Format check, server + client tests, cross-OS snapshot store tests, client build, path-change detection, macOS DMG and Windows EXE desktop builds, advisory deployment-stack validation, OCI image supply chain, and release publishing via `scripts/publish-release.js`. |
| `file-headers.yml` | pull request                               | Runs `.claude/skills/file-headers/scripts/check-headers-pr.sh` so every touched source file carries the required authorship header. |
| `triage.yml`       | issues, `pull_request_target`, manual      | Reconciles `size/*`, `area/*`, `type/*`, `priority/*`, and review-signal labels using `.github/scripts/label-rules.js`; assigns authors; adds items to the project board. Hand-applied labels are never removed. |

## Related files

- `../scripts/label-rules.js` — pure labeling logic, unit-tested by `server/__tests__/label-rules.test.js`. Changes to rules take effect only after they reach `master`, so prove them with the tests first.
- `../ISSUE_TEMPLATE/` and `../PULL_REQUEST_TEMPLATE.md` — forms whose fields feed the triage labels.
- `../CONTRIBUTING.md` — contributor workflow and expectations.

## Reproducing CI locally

```bash
npm run verify               # headers, format, client typecheck, server + client tests
npm run test:snapshots       # snapshot store tests (CI runs them on Linux, macOS, Windows)
npm run build                # client production build
npm run deploy:validate      # deployment stack validation
```

`triage.yml`'s project-board step needs a personal access token secret because `GITHUB_TOKEN` cannot write to Projects v2; see the comment block at the top of the workflow.
