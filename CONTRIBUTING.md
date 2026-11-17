# Contributing to Zov Computer Use

We welcome community contributions, bug reports, and enhancements!

---

## 1. Development Principles

1. **Accessibility-First**: Prefer semantic Accessibility APIs over raw screen coordinates whenever possible.
2. **Clean-Room Integrity**: Never introduce proprietary binaries or decompiled code.
3. **Fail-Closed Error Classification**: Always throw or return structured `ComputerUseError` types instead of silent fake-successes.
4. **Test Before Submitting**: Ensure `npm run lint`, `npm run typecheck`, and `npm test` pass cleanly.

---

## 2. Pull Request Guidelines

1. Fork the repository and create your feature branch:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Verify all gates pass:
   ```bash
   npm run build
   npm run typecheck
   npm run lint
   npm test
   ```
3. Commit using conventional commit messages:
   ```bash
   git commit -m "feat(core): add stable handle caching"
   ```
4. Push and open a Pull Request.
