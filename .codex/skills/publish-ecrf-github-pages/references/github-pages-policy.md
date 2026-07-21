# GitHub Pages eCRF publication policy

## Publication model

- Publish a static project site at `https://<owner>.github.io/<repository>/` unless the repository uses a verified custom domain.
- Use GitHub Actions Pages deployment with `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.
- Treat the deployment job output as the authoritative page URL; do not construct a URL when a custom domain or private Pages configuration may apply.
- GitHub Pages serves static HTML, JavaScript, CSS, and assets. Do not depend on Node, React SSR/RSC, Worker APIs, server authentication, filesystem access, or secret runtime environment variables.

Official references:

- GitHub Pages overview: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Custom Pages workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Check the current official documentation during publication because action versions, permissions, plan entitlements, and configuration APIs can change.

## Exact-artifact rule

The directory tested by QA must be the directory uploaded by the Pages workflow. The default is `github-pages/`.

It must contain:

- `index.html`;
- compiled JavaScript and CSS;
- referenced static assets;
- `.nojekyll`;
- `asset-manifest.json`;
- `checksums.sha256`.

The Git repository should also contain the source and workflow needed to reproduce the artifact when those files are approved for publication. Do not copy private protocol material into the public artifact merely because it was an upstream build input.

## QA and approval state

Use separate state labels:

- QA: `PASS`, `FAIL`, or `PARTIAL`;
- clinical approval: `approved` or `pending`;
- publication approval: `approved` only after the post-QA user response;
- deployment: `pending`, `succeeded`, or `failed`.

QA failure is advisory for this workflow because the user requested the right to publish anyway. Clinical approval, secret/PHI screening, artifact integrity, and an exact publication target are mandatory blockers.

## Public-data boundary

Allow only runtime material intended for unrestricted internet access. Exclude:

- participant records, submission exports, PHI/PII, identifiers, and browser-storage snapshots;
- protocol PDFs/DOCX files, confidential source extracts, private review comments, and unresolved approval identities;
- `.env*`, tokens, API keys, credentials, private keys, local absolute paths, temporary archives, and server bundles;
- authenticated YAML confirmation/editor APIs that cannot run on static Pages.

Keep eCRF submission disabled by default. A public data-collection endpoint requires a separate explicit authorization and security/privacy review.

## Push prompt content

The action-time question must identify:

1. QA status and failures;
2. repository and branch;
3. files/directories to be committed;
4. whether repository or Pages visibility will change;
5. proposed public URL;
6. confirmation that the public artifact passed the public-data boundary review.

No reply, an ambiguous reply, or a request to keep the result local means do not push.

