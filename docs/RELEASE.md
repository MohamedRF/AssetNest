# Release process

AssetNest uses [Semantic Versioning](https://semver.org/) and a single version
for the root and every workspace package. The OpenAPI document, `/api/v1/version`
and the MCP server all report that version.

## 1. Prepare a release

Start from the latest `master` and prepare the release on a branch:

```sh
git switch master
git pull --ff-only origin master
git switch -c release/v0.2.0
```

Then update and verify the candidate:

```sh
pnpm install --frozen-lockfile

# Bump every manifest + the version strings in one step:
pnpm release:sync 0.2.0
pnpm install            # refresh the lockfile / editor state

# Add a CHANGELOG.md section:  ## [0.2.0] - YYYY-MM-DD
$EDITOR CHANGELOG.md

# Fail if anything is inconsistent:
pnpm release:check

pnpm lint && pnpm typecheck && pnpm test --concurrency=1 && pnpm build && pnpm format:check && pnpm sdk:check
```

Commit the version bump and changelog, then open a pull request:

```sh
git add -A
git commit -m "release: v0.2.0"
git push -u origin release/v0.2.0
gh pr create --base master --title "release: v0.2.0" --body "Prepare the 0.2.0 release. See CHANGELOG.md for release notes."
```

Wait for required CI and merge the release PR through the protected branch. Then tag the merged commit:

```sh
git switch master
git pull --ff-only origin master
pnpm release:check
git tag -a v0.2.0 -m "AssetNest v0.2.0"
git push origin v0.2.0
```

Pushing the tag publishes the release if verification passes; do this only when ready to publish.
Do not push release commits directly to `master`.

Pushing a stable `vX.Y.Z` tag triggers `.github/workflows/release.yml`. The
workflow checks that the tag matches the version in `package.json` before
publishing. To verify a candidate through Actions, run the workflow manually
and enter the version from the selected ref. A manual run produces verification
artifacts and skips publication.

## 2. What the workflow does

1. **Verify** — frozen install, `release:check`, lint, SDK drift check,
   typecheck, full tests, build, format check; uploads `openapi.json` and the
   packed SDK tarball as artifacts.
2. **Images** — multi-arch (`linux/amd64`, `linux/arm64`) API, web and worker
   images built with Buildx and pushed to
   `ghcr.io/<owner>/assetnest-{api,web,worker}` (tags: `vX.Y.Z`, `latest`,
   short SHA). OCI labels carry the version, revision and creation time.
3. **SBOM** — SPDX JSON for the source tree and each image, uploaded as workflow
   artifacts and attached to the GitHub release.
4. **Signatures** — keyless [cosign](https://github.com/sigstore/cosign) via the
   GitHub Actions OIDC identity (no long-lived signing key). Each image digest is
   signed and then verified with the workflow identity and
   `https://token.actions.githubusercontent.com`.
5. **Provenance** — build-provenance attestations are pushed to the registry for
   each image.
6. **GitHub release** — generated notes plus `openapi.json`, the SDK tarball and
   the four SBOMs.

## 3. Repository settings required

- Actions → General → Workflow permissions: **Read and write** (for GHCR and
  releases).
- Allow GitHub Actions to publish to GHCR (packages inherit repo permissions).
- No registry passwords or signing keys are stored; keyless signing uses the
  workflow's OIDC token.

## 4. Verify a published release

```sh
# Signature (keyless)
cosign verify \
  --certificate-identity 'https://github.com/<owner>/AssetNest/.github/workflows/release.yml@refs/tags/v0.2.0' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/<owner>/assetnest-api:v0.2.0

# Provenance
gh attestation verify oci://ghcr.io/<owner>/assetnest-api:v0.2.0 -R <owner>/AssetNest

# SBOM
syft ghcr.io/<owner>/assetnest-api:v0.2.0 -o spdx-json=sbom-api.json
```

See [GitHub's artifact attestation verification guide](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
for private registries and offline verification.

## 5. Rollback

1. For a deployment using registry images, re-deploy the previous image
   digests. Keep the API and migration job on the same image digest. For the
   source-built reference Compose stack, check out the previous release tag
   and rebuild from that source.
2. If a migration was applied, restore the pre-upgrade backup into a fresh
   database and point the previous release at it. See `docs/UPGRADE.md` for
   restoring the matching private files.
3. Record the deployed image digests and confirm readiness before resuming traffic.

## 6. Release evidence

Before announcing a release, capture the workflow run URL, image digests, SBOMs
and signature and provenance verification output. Record the staging install,
upgrade and restore results and the health and version checks. Verify any
enabled OIDC, AI, SMTP, webhook or MCP integration on the target configuration
and record operator sign-off.
