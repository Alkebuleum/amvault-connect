# Contributing to amvault-connect

Thanks for helping improve the SDK!

## Dev setup
```bash
git clone https://github.com/Alkebuleum/amvault-connect.git
cd amvault-connect
npm i
npm run build
```

## Testing in a consumer app
```bash
npm pack
# inside your test app
npm i ../amvault-connect/amvault-connect-*.tgz
```

## Release
We tag & publish via GitHub Actions.
```bash
git status
npm version patch|minor|major      # creates a git tag vX.Y.Z
git push --follow-tags             # triggers .github/workflows/release.yml
```
Manual fallback:
```bash
npm run build
npm publish --access public
```

## Guidelines
- ESM + TypeScript, strict.
- Keep `react` and `ethers` as peerDependencies.
- Don’t commit `dist/`.
- Update README and CHANGELOG for user-facing changes.
