# AirwayAI eCRF Studio — static HTML bundle

This bundle contains the precompiled Screening and Eligibility YAML form editor for project `prj_20260721-1447`.

## Run locally

Serve the `client` directory from any static HTTP server, then open its root URL in a browser. For example:

```powershell
cd client
python -m http.server 8080
```

Open `http://127.0.0.1:8080/`.

Opening `index.html` directly with a `file://` URL is not supported because browsers normally block loading the adjacent `program.yaml` file.

## Hosting

Upload the complete contents of `client` to a static web host. Keep the `assets` directory and `program.yaml` beside `index.html`.

Draft editing, YAML upload, preview, language switching, and draft download are available. Authenticated confirmation and server-side CDASH lookup require the associated server/API deployment and are intentionally unavailable on a static-only host.

The bundle contains protocol metadata only and no participant data. It is an engineering artifact, not clinical or regulatory approval.

See `asset-manifest.json` and `checksums.sha256` for release integrity information.
