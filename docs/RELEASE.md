# Release Process (`docs/RELEASE.md`)

This project follows [Semantic Versioning (SemVer)](https://semver.org/).

---

## Release Checklist

1. **Clean Working Tree**: Ensure `git status` has zero untracked files or unstaged temporary artifacts.
2. **Lint, Build, Typecheck & Tests**:
   ```bash
   npm run clean
   npm run build
   npm run typecheck
   npm run lint
   npm test
   ```
3. **Doctor & Stdio Probe Verification**:
   ```bash
   npm run doctor
   npm run probe
   ```
4. **Tag & Publish**:
   ```bash
   git tag v0.2.1
   git push origin main --tags
   ```
5. **GitHub Release**:
   Draft a GitHub release summarizing verified changes, test counts, and platform boundaries.
