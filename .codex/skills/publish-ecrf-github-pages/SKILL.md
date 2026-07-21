---
name: publish-ecrf-github-pages
description: Package a QA-reviewed, precompiled React eCRF as an exact static GitHub Pages artifact, require a fresh user decision after QA even when checks fail, and only then commit, push, deploy, and verify the public page. Use when Codex must publish a completed eCRF, approved JSON contract, or validated HTML/JavaScript/CSS form bundle to a public GitHub project page, or when the clinical-form orchestrator reaches its post-QA GitHub release gate.
---

# Publish eCRF to GitHub Pages

Publish a completed runtime eCRF as a public static project site. Treat QA outcome and publication authorization as separate decisions.

## Resolve inputs

Require:

- an approved JSON eCRF contract or the exact precompiled runtime bundle derived from it;
- one static entry point plus compiled JavaScript, CSS, assets, manifest, and checksums;
- the QA report for the exact Pages artifact; it may be passing or failing;
- the GitHub repository, target branch, authenticated `gh` context, and proposed Pages URL;
- confirmation that the public artifact contains no participant data, PHI/PII, secrets, confidential protocol source, or private review history.

Read [references/github-pages-policy.md](references/github-pages-policy.md) before preparing or publishing. If the input is only `program.yaml`, an unapproved JSON contract, or the authenticated YAML review editor, return to `orchestrate-clinical-forms`; GitHub Pages cannot provide its server-side confirmation API.

## Prepare the exact public artifact

1. Compile the approved JSON contract with `template/crf/` as static React. Do not use SSR, RSC, Worker-rendered HTML, or runtime JSON-to-HTML conversion.
2. Keep browser submission disabled unless the user separately authorizes a reviewed public submission endpoint.
3. Run `scripts/prepare-pages-release.mjs` to create `github-pages/`, `.nojekyll`, the asset manifest, checksums, and `.github/workflows/deploy-ecrf-pages.yml`.
4. Run HTML/browser QA against the resulting `github-pages/index.html`, not an earlier build directory.
5. Record every QA result and limitation. Do not rebuild, rewrite, or repackage after QA. If anything changes, repeat QA before asking to push.

Example:

```text
node <skill>/scripts/prepare-pages-release.mjs \
  --bundle <validated-static-bundle> \
  --output <repository>/github-pages \
  --workflow <repository>/.github/workflows/deploy-ecrf-pages.yml \
  --branch <default-branch> \
  --replace
```

Use `--replace` only after resolving the exact repository and confirming that `github-pages/` and the workflow are the intended generated targets.

## Enforce the post-QA push gate

After QA finishes, always stop and ask for a fresh action-time decision, whether QA passed or failed. Report:

- `PASS`, `FAIL`, or `PARTIAL`, with unresolved failures;
- repository, branch, proposed commit scope, workflow, and public URL;
- manifest and checksum paths;
- the fact that pushing may expose the compiled eCRF to anyone on the internet.

Ask: `QA 已完成（結果：<status>）。是否要將上述檔案 commit 並 push 到 <repository>/<branch>，啟用或更新 GitHub Pages，公開於 <url>？`

Do not stage, commit, push, enable Pages, change visibility, or dispatch a workflow until the user explicitly answers yes. Earlier broad instructions to finish the workflow do not replace this gate. A failing QA result does not prevent asking or publishing when the user knowingly approves it. Missing entry files, detected secrets/PHI, an unapproved clinical contract, or an unresolved publication target remain hard blockers.

## Publish only after approval

1. Recheck `gh auth status`, repository identity, default branch, remotes, worktree changes, and Pages configuration.
2. Do not make a repository public or change Pages visibility unless that exact change was included in the approval prompt.
3. Stage only the reviewed source changes, `github-pages/`, the Pages workflow, and QA/release evidence. Exclude protocol source, local environment files, credentials, temporary archives, participant data, and unrelated edits.
4. Commit intentionally and push without force. Never overwrite remote history to publish a page.
5. Configure GitHub Pages to use GitHub Actions when needed, using current official GitHub documentation or API behavior.
6. Wait for the Pages workflow to finish. On failure, report it; if source or artifact changes are required, rebuild, repeat QA, and obtain a new push decision.
7. Read the deployment output or Pages API for the authoritative URL, then verify the page loads and its compiled assets resolve under the project path.

## Return

Return the public GitHub Pages URL, repository and commit, QA status, rendering mode, manifest/checksum, workflow result, submission behavior, and any unresolved clinical or technical limitations. Never describe public availability as clinical validation or regulatory approval.

