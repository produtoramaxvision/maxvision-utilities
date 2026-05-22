# Changelog

All notable changes to `media-forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial plugin scaffold (folders, package.json, TypeScript strict config, tsup build, ESLint flat config, Prettier, Vitest with 80% coverage thresholds).
- Top-tier model lock: `gemini-3-pro-image-preview`, `imagen-4.0-ultra-generate-001`, `veo-3.1-generate-preview`.
- pnpm-workspace.yaml at marketplace root to isolate media-forge from external pnpm workspaces.
