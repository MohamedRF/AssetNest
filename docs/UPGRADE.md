# Upgrade AssetNest

AssetNest upgrades are **forward-only**. Migrations are additive and versioned;
never edit an applied migration. Always take a verified backup first.

## 1. Before you upgrade

1. Read the release notes / `CHANGELOG.md` for the target version.
2. Check `docs/UPGRADE.md` for breaking changes and required configuration.
3. **Back up**:
   - PostgreSQL dump (`sh infrastructure/scripts/backup.sh` or your managed-PG
     snapshot),
   - the private file storage (`STORAGE_ROOT` / bucket),
   - `.env` secrets (`SESSION_SECRET`, `ENCRYPTION_KEY`, OIDC/SMTP/AI keys).
4. If possible, **drill the restore** on a staging copy:
   `sh infrastructure/scripts/drill-restore.sh`.
5. Note the current image tags/digests so you can roll back.

## 2. Upgrade the reference Compose stack

From the repo root:

```sh
git fetch --tags
git checkout vX.Y.Z            # or the tag you are upgrading to

# Rebuild images (the one-shot migrate job runs before the API):
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build

# Follow the migration job:
docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app logs -f migrate
```

The `migrate` service applies `packages/db/migrations` and exits; the `api` and
`worker` wait for it. If a migration fails, the old API is not rolled forward
automatically — fix the issue or restore the backup.

## 3. Upgrade a source / managed deployment

```sh
git checkout vX.Y.Z
pnpm install --frozen-lockfile
pnpm db:migrate            # applies new migrations only
pnpm build
# restart the API and worker processes
```

If you use an external reverse proxy, reload it after the restart if needed.

## 4. Post-upgrade verification

```sh
curl -fsS http://localhost/api/v1/health/ready
```

- Log in and confirm assets, locations, members and documents load.
- Confirm the version endpoint reports the new version:
  `curl -fsS http://localhost/api/v1/version`.
- Check worker health/logs if `REDIS_URL` is set.
- Confirm scheduled/backup jobs still point at the right retention.
- Run the [installation smoke test](DEMO.md) on staging before promoting to production.

## 5. Rollback

1. Stop the API/worker (or scale to zero).
2. Restore the pre-upgrade backup into a fresh database and restore the matching
   file archive to a fresh storage directory. Point the previous deployment at
   those restored resources.
3. Re-deploy the previous image tag/digest.
4. Start the API/worker and verify `/api/v1/health/ready` and the version endpoint.

Do **not** attempt to "downgrade" by reverting migrations; restore from backup
instead. If you must recover without a backup, fix forward with a new additive
migration.

## 6. Compatibility policy

- Within a major version, upgrades are expected to be backward compatible for
  configuration and API clients.
- Breaking API changes require a version bump and a migration note.
- The OpenAPI document and generated SDK are regenerated per release; pin the
  SDK version and test against the target API version.
- PostgreSQL 17 is the supported baseline. Newer PostgreSQL major versions are
  not automatically supported.

## 7. Release/rollback evidence to record

For each upgrade, record: source and target versions, backup path and restore
drill result, migration output, post-upgrade health/version output, and the
operator sign-off. See the [release process](RELEASE.md#6-release-evidence).
