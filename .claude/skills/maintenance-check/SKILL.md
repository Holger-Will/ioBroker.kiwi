---
name: maintenance-check
description: Check whether ioBroker.kiwi is still current with the latest ioBroker (repochecker, outdated npm packages, Node/js-controller/admin requirements) and prepare an update branch. Use when asked to "update dependencies", "check for updates", "is the adapter still compatible", or before a release.
---

# Maintenance check

Goal: keep the adapter running on the latest ioBroker with current dependencies. Do not add features here.

1. Start from an up-to-date `main`: `git switch main && git pull`, then `git switch -c chore/update-dependencies-<yyyy-mm>`.
2. `npm ci` — if it fails, the lockfile is out of sync; fix with `npm install` and commit the lockfile.
3. Gather the state:
    - `npx @iobroker/repochecker https://github.com/michiproep/ioBroker.kiwi --local` → collect all `[E…]` and `[W…]` lines.
    - `npm outdated`
4. Fix every repochecker **error** first (they block the ioBroker repository). Typical ones: minimum Node.js in
   `engines` and the CI matrix, minimum `admin`/`js-controller` in io-package.json, minimum versions of
   `@alcalzone/release-script*` and `@iobroker/testing`.
5. Update dependencies:
    - Patch/minor: `npm update`, then bump the ranges in package.json.
    - Major: one package at a time. Read its changelog/migration guide, adapt the code, run checks after each one.
    - Native modules (`better-sqlite3`, `sqlite-vec`) must have prebuilt binaries for every Node.js version in the CI matrix.
    - `@types/node` should match the **minimum** supported Node.js major, not the latest.
6. Verify: `npm run lint`, `npm run check`, `npm test`, and if possible `npm run test:integration`.
   Report failures with their output; do not hide them.
7. Add a line under `### **WORK IN PROGRESS**` in the README changelog (e.g. `- (michiproep) dependencies updated, Node.js >= 22 required`).
8. Commit, push the branch, and open a PR to `main` (ask before pushing).
