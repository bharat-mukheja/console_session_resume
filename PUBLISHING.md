# Marketplace release guide

Published: **bmukheja.console-session-resume 0.3.0**, pre-release.
The public listing and a direct Marketplace installation were verified on
November 16, 2026.

## Initial Marketplace submission

On November 16, 2026, publisher ownership for `bmukheja` was verified in the signed-in
Marketplace dashboard and version `0.3.0` was uploaded manually. The server accepted
the upload and registered `Microsoft.VisualStudio.Code.PreRelease: true`. Microsoft
validation completed at approximately 16:07 UTC, and installation from Marketplace
then succeeded in an isolated VS Code profile. The icon and listing screenshots are
present on the public page:
<https://marketplace.visualstudio.com/items?itemName=bmukheja.console-session-resume>.

Install this preview with:

```bash
code --install-extension bmukheja.console-session-resume --pre-release
```

Uploaded VSIX SHA-256:
`e0e585a60bff35050d9f79d35ce74f5b2b527c48f848eea45d528c053ddc5d27`.
The public Marketplace metadata reports the same digest as the local package.
The uploaded package used the source from commit
`704a2636ab4b14491813b975ca8821d4a173a020` and listing asset/content URLs pinned to
`a9a90c5b53d8a54663f06c9b4e75d9037fc440d2`.

The first upload rejected a Marketplace URL used as the extension homepage.
`homepage` now points to the public GitHub project, and `bugs.url` points to its
issues page. Keep these project-specific URLs when packaging later releases.

Manual uploads use **New extension → Visual Studio Code** for the first release
and the existing extension's **Update** action for later versions. Upload a VSIX
created with `npm run package`; the prepared package contains the pre-release flag.
The OIDC workflow below is a separate future publishing path and still requires
its exact publisher trust policy to be configured.

## Prepared in this repository

- Publisher `bmukheja`, display name, description, search keywords, MIT license,
  support URL, dark gallery banner, and 256 × 256 PNG icon.
- README with three real screenshots from a newly created `orbit-api` sample
  workspace in the dedicated **Session Resume Screenshots** VS Code profile.
- Privacy, support, changelog, and migration from the old `local-tools` identity.
- Pinned official `@vscode/vsce` package tool and a package-content verifier.
- Cross-platform validation workflow and a manual OIDC publishing workflow.

The approved generated icon source is `images/icon.png`; the packaged icon is
`images/icon-256.png`. Its exact generation prompt is in `images/icon-prompt.txt`.
Screenshots are unaltered captures of the actual extension UI. No existing user
project was used as the screenshot workspace. The fixture runs real sample commands.

## Build and validate

Use Node.js 22 or later:

```bash
npm ci --ignore-scripts
npm test
npm run test:shell
npm run test:vscode
npm run package
npm run verify:package
```

The shell tests require POSIX PTYs; unavailable shells are explicitly skipped.
The native tests need a graphical VS Code installation and create only an isolated
`.test-work` profile. `node scripts/ci-native.js` downloads official VS Code for CI;
set `VSCODE_VERSION=1.93.0` to test the minimum declared version.

Review the **Validate extension** workflow results on Windows, Linux, and macOS
before claiming those platforms have passed. A workflow definition is not evidence
that a platform test passed. Windows PowerShell requires PSReadLine.

## Public listing files

The source repository is public with the owner's explicit approval. It hosts the
approved PNG icon, three real screenshots, and public documentation. Default
GitHub rewriting can serve these files; the release configuration can instead pin
the URLs to an exact commit for a reproducible listing.

Configure repository Actions variables:

- `MARKETPLACE_BASE_IMAGES_URL`: raw HTTPS repository root containing `images/`.
- `MARKETPLACE_BASE_CONTENT_URL`: public HTTPS blob root containing `PRIVACY.md`,
  `SUPPORT.md`, `CHANGELOG.md`, and `LICENSE`.

For example, use a public listing repository's raw `main/` root for images and its
`blob/main/` root for content. The values must end with `/`. Build locally with the
same environment variables. Check all rewritten URLs anonymously before release.
No authentication tokens should appear in image URLs.
Run `npm run verify:package -- --check-links` to check that all four packaged
README images load anonymously. The publishing workflow runs this check.

## Publisher account and trusted publishing

1. Sign in at <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that owns publisher **bmukheja**. Verify the actual publisher ID.
   Complete any account/profile/terms steps personally when required.
2. Create the repository environment **marketplace** and protect it with a required
   reviewer if that feature is available for the repository/account.
3. In the publisher's Trusted Publishing configuration, add this exact policy:

   | Field | Value |
   | --- | --- |
   | Provider | GitHub Actions |
   | GitHub organization/owner | `bharat-mukheja` |
   | Repository | `console_session_resume` |
   | Workflow filename | `publish.yml` |
   | Environment | `marketplace` |

   Review the binding before saving: it authorizes this GitHub workflow to publish
   under the publisher. For a private repository, Microsoft's current guide requires
   the first token exchange within 48 hours after creating the trust policy.
4. Commit and push the verified candidate. Confirm CI passes for that exact commit.
5. Run **Publish Marketplace preview** manually on the intended release commit,
   supplying exactly `0.3.0`. The workflow checks the publisher/version, tests,
   packages, verifies, then publishes the VSIX as a pre-release with OIDC.
6. Verify the Marketplace page, PNG icon, all screenshots, support links, and an
   installation from the Marketplace. Confirm the installed ID and version.

The workflow requests `id-token: write` only in the publishing job. No PAT is
checked in or required for OIDC. A publisher badge/domain verification is separate
from creating a publisher or publishing an extension.

Do not run `vsce publish` to work around a missing trust policy or account access.
Resolve the account/policy step, then run the prepared workflow.

## Upgrade check

Disable the old `local-tools.console-session-resume` extension and reload. Verify
names, pins, directory, and history import on the same terminal host; close and
resume a migrated terminal. Original files remain unchanged. Fish retains its
existing UUID-based namespace. Never include actual histories in CI artifacts.

## Official references

Checked November 14, 2026:

- <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- <https://code.visualstudio.com/api/references/extension-manifest>

Recheck Microsoft's guide before changing publisher authentication or release
procedures. The guide documents retirement of global Azure DevOps PATs on
December 1, 2026; use Trusted Publishing for this prepared release flow.
