

# Create npm account: https://www.npmjs.com/signup        
# Enable 2FA (recommended: "Auth & Writes")

un:alkebuleum,ps:papa@me

# Install deps
npm i
npm i -D typescript @types/react @types/react-dom

# Verify build
npm run build


2) Publish to npm (manual/local)

npm login
npm version patch        # or minor/major
npm run build
npm publish --access public


## update code

npm version patch         # 0.1.0 -> 0.1.1
npm run build
npm publish --access public








3) Versioning rules (SemVer)

patch: fixes/internal refactors → npm version patch

minor: backwards-compatible features → npm version minor

major: breaking changes → npm version major

Pre-releases:

npm version prerelease --preid=rc  # e.g., 0.2.0-rc.0
npm publish --tag next --access public
# consumers: npm i amvault-connect@next

4) Try before publish (local pack)
npm pack
# installs as a tarball in another app:
# npm i ../amvault-connect-sdk/amvault-connect-<version>.tgz

5) GitHub repo (recommended, optional)
git init
git add .
git commit -m "chore: initial release"
git branch -M main
git remote add origin https://github.com/<org>/amvault-connect.git
git push -u origin main


Add these to package.json for nice npm links:

"repository": { "type": "git", "url": "git+https://github.com/<org>/amvault-connect.git" },
"bugs": { "url": "https://github.com/<org>/amvault-connect/issues" },
"homepage": "https://github.com/<org>/amvault-connect#readme"


.gitignore

node_modules
dist
*.log
.DS_Store
examples/**/node_modules

6) CI publish (GitHub Actions) with provenance (optional)

Create NPM automation token → add to repo secrets as NPM_TOKEN.

Add .github/workflows/release.yml:

name: Release
on:
  push:
    tags:
      - 'v*.*.*'
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write      # for npm --provenance
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci || npm i
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}


Release flow:

npm version patch   # or minor/major
git push --follow-tags
# Action builds + publishes automatically

7) Deprecation / yanking

Prefer deprecation over unpublish:

npm deprecate amvault-connect@"<0.2.0" "Use >=0.2.0 — popup stability fixes"


Unpublish is restricted and risky for dependents.

8) Security & hygiene

Keep 2FA enabled.

Rotate NPM_TOKEN if personnel changes.

Run npm audit occasionally.

Keep runtime deps minimal (we only use peer deps).

9) Roadmap ideas

isValidator() helper (pluggable registry call).

withRoleGuard(Component, 'validator') HOC.

Built-in SIWE-style message templates (already similar).

Example with AkeOutlet wiring and role-gated routes.

10) FAQ

Why peerDependencies for React & ethers?
Let the host app control versions to avoid duplicate React/ethers in bundles.

CJS build needed?
Current output is ESM. If consumers need CJS, add a dual build (we can add tsup and output both).