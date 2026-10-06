---
name: release
description: Cut a new ioBroker.kiwi release with @alcalzone/release-script (changelog, io-package news, version bump, tag). Use when asked to "release", "publish a new version", or "bump the version".
disable-model-invocation: true
---

# Release

Follow [CONTRIBUTING.md](../../../CONTRIBUTING.md#releasing). Summary:

1. Preconditions — stop and tell the user if any fails:
    - On `main`, working tree clean, `git pull` done, latest CI run on `main` is green (`gh run list --branch main -L 1`).
    - README.md has a `### **WORK IN PROGRESS**` changelog section with at least one entry.
    - The target tag `vX.Y.Z` does not exist yet (`git tag -l` and `git ls-remote --tags origin`).
2. Ask the user for the bump type (`patch`, `minor`, `major`, or a pre-release like `prerelease --preid beta`).
3. Dry run first: `npm run release -- <type> --dry`. Show the user the resulting version and changelog.
4. After confirmation: `npm run release -- <type>`. The script updates package.json, io-package.json (`common.news`,
   translated), README changelog, commits, tags `vX.Y.Z`, and pushes. Do not hand-edit those files before.
5. The tag push triggers the `deploy` job in `.github/workflows/test-and-release.yml`, which creates the GitHub release.
   npm publishing only happens if it is enabled there (see CONTRIBUTING.md).
6. Report the new version and the link to the GitHub release.
