# Contributing to ioBroker.kiwi

This fork (`michiproep/ioBroker.kiwi`) is maintained independently of the original
[Holger-Will/ioBroker.kiwi](https://github.com/Holger-Will/ioBroker.kiwi), which is no longer maintained.

## Branching model

We use a simple trunk-based flow (GitHub flow):

- `main` is the only long-lived branch. It must always be releasable and pass CI.
- Every change happens on a short-lived branch created from the latest `main`:

    | Prefix   | Use for                                | Example                             |
    | -------- | -------------------------------------- | ----------------------------------- |
    | `feat/`  | new functionality                      | `feat/configurable-embeddings`      |
    | `fix/`   | bug fixes                              | `fix/apikey-shared-by-providers`    |
    | `chore/` | dependencies, tooling, CI, refactoring | `chore/update-dependencies-2026-10` |
    | `docs/`  | documentation only                     | `docs/vector-store-status`          |

- Open a pull request to `main`. CI (`Test and Release`) must be green before merging.
  PRs and pushes test on Linux and macOS; Windows is only tested for release tags, because its runners are slow.
- Prefer **squash merge** so `main` gets one clean commit per change.
- `main` is protected by the ruleset _"main: PR + green CI"_: changes only via pull request, `check-and-lint` and all
  `adapter-tests` jobs must pass, no force-push or deletion. Repository admins can bypass it (needed for the release
  script, which pushes the version commit and tag directly).
- **Auto-merge:** enable it on a PR (button _"Enable auto-merge"_ → squash, or `gh pr merge <nr> --auto --squash`)
  and GitHub merges it as soon as all required checks are green. Merged branches are deleted automatically.
- Experiments (for example trying a new vector store) live on `feat/…` branches. They are merged only when they are
  usable and documented in the README's
  [AI and vector store integration status](README.md#ai-and-vector-store-integration-status).
- Dependabot PRs follow the same rules; patch updates may be auto-merged.

### Commit messages

Short, imperative, optionally with a [Conventional Commits](https://www.conventionalcommits.org/) prefix:
`fix: await getHistory call`, `chore(deps): bump openai to 5.x`, `docs: describe vector store status`.

### Changelog

Every user-visible change adds a line to the top of the README changelog, under the placeholder:

```md
## Changelog

### **WORK IN PROGRESS**

- (michiproep) short description of the change
```

Do **not** change `version` in package.json/io-package.json or `common.news` by hand. The release script does that.

## Local checks

```sh
npm ci
npm run lint
npm run check
npm test
npm run test:integration   # optional, slow: starts a real js-controller
npx @iobroker/repochecker https://github.com/michiproep/ioBroker.kiwi --local
```

## Releasing

Releases use [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script), the ioBroker standard, and
[Semantic Versioning](https://semver.org/). While the version is `0.x`, breaking changes bump the minor version.

1. Make sure you are on an up-to-date `main` with a clean working tree, the last CI run is green, and the README has a
   `### **WORK IN PROGRESS**` section.
2. Dry run: `npm run release -- patch --dry` (or `minor` / `major` / `prerelease --preid beta`).
3. Release: `npm run release -- patch`.
   The script bumps the version in package.json and io-package.json, turns the changelog placeholder into the version
   entry, writes translated `common.news`, commits, creates the tag `vX.Y.Z` and pushes.
4. The tag push runs the `deploy` job in `.github/workflows/test-and-release.yml` after all tests pass:
    - **Default (fork):** a GitHub release is created, see [Installing a fork release](#installing-a-fork-release).
    - **npm publishing** is only possible once this fork has publish rights for the `iobroker.kiwi` npm package
      (currently owned by the upstream author; for abandoned adapters, ask the ioBroker core team about taking over
      maintenance). Then set the repository variable `NPM_PUBLISH=true` and configure npm
      [trusted publishing](https://docs.npmjs.com/trusted-publishers) for this repository and the workflow
      `test-and-release.yml`.

### Installing a fork release

Until the fork can publish to npm, install a GitHub release in ioBroker via _Adapters → Install from custom URL_
(expert mode) with `https://github.com/michiproep/ioBroker.kiwi/tarball/vX.Y.Z`.

Never create release tags by hand. If a tag was created by mistake, delete it locally and on GitHub before the next
release, or release a higher version.
