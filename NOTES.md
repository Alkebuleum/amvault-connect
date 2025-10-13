# NOTES — amvault-connect (ops)

- Repo: https://github.com/Alkebuleum/amvault-connect
- NPM: https://www.npmjs.com/package/amvault-connect

## Local publish
```bash
npm login
npm version patch
npm run build
npm publish --access public
```

## CI publish (recommended)
- Add repo secret `NPM_TOKEN` (automation token).
- Push a tag `vX.Y.Z` → GitHub Action publishes with provenance.

## SemVer
- patch: fixes
- minor: compatible features
- major: breaking changes
