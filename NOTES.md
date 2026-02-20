# NOTES — amvault-connect (ops)

- Repo: https://github.com/Alkebuleum/amvault-connect
- NPM: https://www.npmjs.com/package/amvault-connect

## First commit to git 
git status
# If it's just your intended edits:
git add -A
git commit -m "modify amvaultProvider"


## Second publish npm (this is how to publish changes to the sdk)
```bash
npm login (un:alk)
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
