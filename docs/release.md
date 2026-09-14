# Release Checklist

Each release publishes two artifacts:

- npm package: `@kahme247/ompweb`
- GitHub Release: [kahme247/ompweb](https://github.com/kahme247/ompweb)

After the initial bootstrap release, publishing is performed by GitHub Actions
with npm trusted publishing. No npm access token is stored in this repository
or in GitHub secrets.

## Downstream deployment branch

The `andrebrait/ompweb` fork uses `deploy/integration` as the single source
for patched deployments. Keep individual fixes on separate pull-request
branches, then cherry-pick their reviewed commits onto this branch. Do not
deploy a feature branch, a dirty working tree, or a manually combined source
directory. The integration branch retains the upstream fixes and all local
patches, including the PWA, queue, ANSI, sidebar, workspace, and provider fixes.

### Refresh from upstream

Use the dedicated integration worktree with a clean working tree:

```bash
git fetch upstream main
git fetch origin deploy/integration
git merge --ff-only origin/deploy/integration
git branch backup/deploy-integration-<unique-name>
git rebase upstream/main
```

Git can drop patch-equivalent commits automatically. When upstream squashes
or changes a patch, remove a local commit only after confirming upstream
preserves its complete behavior. Never resolve an integration conflict by
taking an entire old or new file without reviewing the other patches in it.
Compare the rebased series with the backup, run the checks below, and push
with `git push --force-with-lease origin deploy/integration`. Normal patch
additions use a regular push. Keep the deployed release available for rollback
throughout a rebase; rebasing a branch does not change the running release.

### Build and deploy a committed snapshot

Build with `/opt/omp-deployment/bin/ompweb-build <commit-ish>`. It resolves the commit
on `origin/deploy/integration`, creates a detached build worktree at that exact SHA
under `/opt/ompweb-patched/builds/`, refuses a dirty tree, runs `npm ci`, `npm run build`,
`npm run lint`, and `npm test` there, packs with `npm pack --ignore-scripts`, and unpacks
the tarball into `/opt/ompweb-patched/releases/<sha>/`. The build worktree is removed
at the end; `builds/` is empty between deployments. Never run the production build in a
development worktree. Verify the affected UI in a browser before switching releases.

Runtime dependencies come from `/opt/ompweb-patched/deps/<lock>/node_modules`, one
entry per distinct `package-lock.json` (`<lock>` is the first 16 hex characters of its
SHA-256); `releases/<sha>/node_modules` is a symlink into it and `releases/<sha>/.deps-lock`
records the key. A release is therefore the unpacked package plus its pruned `.next`
(tens of MiB), not a checkout.

Production provenance lives in `/opt/omp-deployment/current.json`: record the branch,
full commit SHA, build ID, the pack tarball (`/opt/omp-deployment/artifacts/<sha>.tgz`),
the release directory, and the source-file checksum manifest
(`artifacts/<sha>-manifest.json`, written by the build from `git ls-files` at that
commit). Refuse a deployment if its tracked source differs from that commit. Do not
infer source provenance from a directory name.

The web deployment has separate frontend and RPC services. The frontend uses
`ompweb-pwa.service` on port 30179; the current API unit and port are recorded
in `/opt/omp-deployment/current.json`. Frontend-only changes must not restart
the RPC service or replace the native OMP binary. API upgrades start a new
versioned service and keep active session requests on their existing owner
until those runs and queued messages drain. Cursor-history reads can use the
new file reader while the old owner continues to serve its live RPC stream.
Existing owners do not gain new live-snapshot capabilities until retirement.
Retain previous hashed static assets for open tabs, back up service and nginx
configuration plus deployment metadata, and verify public page/API health.

### Retire

Retention is the live releases (enabled or active `ompweb*` units, running processes,
`/opt/ompweb-patched/current`) plus one rollback, the newest other release by commit
date. A retirement script ends, after the old unit is stopped and routes are switched,
with `/opt/omp-deployment/bin/ompweb-retire`: it removes every other release, every
`deps/` entry no remaining release links to, and any build worktree an aborted build left
behind, then prints the kept set and `df`. `--dry-run` shows the plan. Point `current` at
the live API release before retiring; a disabled unit that still names a release does
not keep it.

## Bootstrap the first release

`@kahme247/ompweb` is not registered on npm yet. npm exposes trusted-publisher settings
only for an existing package, so version `0.2.0` must be published once from a
reviewed local checkout using the authenticated npm account:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
npm publish --access public
```

Do not create a tag or GitHub Release for this bootstrap version: npm will
reject a duplicate version.
After this succeeds, configure trusted publishing before publishing any later
version.

## One-time trusted-publisher setup

1. In npm, open the `@kahme247/ompweb` package settings and add a **GitHub Actions**
   trusted publisher with:
   - Owner: `kahme247`
   - Repository: `ompweb`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. In GitHub, create the `npm` environment for this repository. Add required
   reviewers if releases need approval.
3. Confirm Actions are enabled for the repository.

The workflow at `.github/workflows/publish.yml` requests `contents: write` to
create the GitHub Release and `id-token: write` for trusted publishing. It
installs npm 11.5.1 or newer, as required for trusted publishing. The OIDC
permission lets npm verify the GitHub Actions identity and generate provenance
for the published package.

## Release later versions

Run these from a clean `main` checkout after the release changes are merged.

```bash
npm ci
npm test
npm run build
npm version <major|minor|patch>
git push origin main --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, creates a commit,
and creates a `v<version>` tag. Review the generated commit before pushing.

Pushing the tag starts the `Publish npm package` workflow. It checks out that
immutable tag, verifies the tag matches `package.json`, installs from the
lockfile, runs tests and the production build, then creates a draft GitHub
Release with generated notes. It publishes `ompweb` through the configured
trusted publisher and makes that release public only after npm accepts the
package. A rerun can safely finish a release if npm has already accepted its
version.

## Verify

```bash
gh run list --repo kahme247/ompweb --workflow publish.yml --limit 1
npm view @kahme247/ompweb@<version> version --registry https://registry.npmjs.org/
npm view @kahme247/ompweb@<version> --json --registry https://registry.npmjs.org/
```

Confirm the workflow succeeded, the exact package version resolves, and npm
shows the expected provenance link.
