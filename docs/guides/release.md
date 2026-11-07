# Release

## Package

`bdmv2web` is published from `apps/cli` as one self-contained ESM entry plus the menu runtime it copies into each generated package.

```sh
npm install -g bdmv2web
bdmv2web --version
```

Runtime requirements: Node.js `>=22`, and `ffmpeg`/`ffprobe` on `PATH` for media export.

## Version and tag

- The version is the `version` field of `apps/cli/package.json`.
- Release tags use `v<major>.<minor>.<patch>` and may carry a prerelease suffix, for example `v0.2.0-rc.1`.
- The tag version and the package version must be identical. The publish workflow fails when they differ.

## Local pre-publish check

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm --filter bdmv2web pack --pack-destination /tmp/bdmv2web-pack

mkdir -p /tmp/bdmv2web-prefix
npm install -g --prefix /tmp/bdmv2web-prefix /tmp/bdmv2web-pack/bdmv2web-*.tgz
/tmp/bdmv2web-prefix/bin/bdmv2web --version
```

`pnpm pack` runs the `prepack` script, which bundles `apps/cli/src/index.ts` with esbuild and copies the menu runtime. `packages/*/dist` must already exist, so run `corepack pnpm build` first.

## Package contents

| Path | Content |
| --- | --- |
| `dist/index.js` | Bundled CLI entry with the `bdmv2web` bin mapping |
| `dist/runtime/app.bundle.js` | Menu runtime read while packaging a disc |
| `package.json`, `LICENSE` | Package metadata and licence |

`pnpm pack` rewrites the `workspace:*` entries of `devDependencies` to fixed versions. Those entries stay out of the published dependency graph because the build inlines every workspace package into `dist/index.js`.

## Publish workflow

`.github/workflows/npm-publish.yml` runs on a push of a `v*` tag and on manual dispatch with a `tag` input. Steps:

1. Validate the tag against `^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$`.
2. Check out `refs/tags/<tag>`.
3. Install Node.js from `.node-version` and npm `11.5.1`.
4. `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`.
5. `pnpm --filter bdmv2web pack --pack-destination artifacts/npm`.
6. Verify the tarball: exactly one archive, name `bdmv2web-<version>.tgz`, version equal to the tag, required files present, and `node <archive>/dist/index.js --version` equal to the version.
7. Read `npm view bdmv2web@<version>`: when the version already exists the upload is skipped, otherwise the tarball is published with `npm publish artifacts/npm/*.tgz --access public`.

Authentication uses npm Trusted Publishing over OIDC: the job requests `id-token: write` and runs in the `npm` environment. No npm token secret is read.

## First release

Trusted publishing cannot create a package that does not exist yet, because the trusted-publisher entry lives on the package's settings page. The first version is therefore published once from a logged-in machine:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm --filter bdmv2web pack --pack-destination /tmp/bdmv2web-pack

npm login
npm publish /tmp/bdmv2web-pack/bdmv2web-<version>.tgz --access public --provenance=false
```

Publish the tarball rather than the package directory: the directory's `devDependencies` use the `workspace:` protocol, which npm does not resolve.

After the upload completes:

1. Register the trusted publisher on npmjs.com under the package's Settings, or with npm `>=11.15`: `npm trust github bdmv2web --file npm-publish.yml --allow-publish`.
2. Tag the released commit and push the tag. The workflow re-runs the tarball checks and skips the upload because the version exists.

## Later releases

Raise `version` in `apps/cli/package.json`, commit, create `v<version>`, and push the tag. The workflow publishes it without further local steps.

## Repository setup

1. Create a GitHub environment named `npm` in `tautcony/bdmv2web`.
2. Add a Trusted Publisher for `bdmv2web` with repository `tautcony/bdmv2web`, workflow filename `npm-publish.yml`, and environment `npm`. The entry requires the package to exist, so it follows the first release.
3. Keep `repository.url` in `apps/cli/package.json` equal to `https://github.com/tautcony/bdmv2web`; trusted publishing compares the two.

Prerelease versions publish to the `latest` dist-tag because the workflow passes no `--tag`.

## Menu runtime bundle

`corepack pnpm build` emits `packages/runtime-web/dist/browser.bundle.js` through `scripts/build-runtime-browser.mjs`. Packaging a disc copies that file to `dist/runtime/app.bundle.js` and then to `runtime/app.bundle.js` inside the generated package. `scripts/bundle-cli.mjs` performs the same copy for the published CLI.
