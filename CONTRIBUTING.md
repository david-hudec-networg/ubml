# Contributing to UBML

UBML is maintained by [NETWORG](https://networg.com) and used in production by TALXIS®.

## This fork

This fork is a preview channel for TALXIS/ubml: it ships changes before, or instead of, proposing them upstream.

- `master` is an exact copy of TALXIS `master`. Nothing is committed to it directly.
- Cut every branch from `master` and open its PR into this fork's `preview`, where it merges once the work is finished. A PR to TALXIS/ubml is opened only when its maintainers want the change.
- A fix to work still in its PR goes on the same branch; anything after the merge gets a new branch.
- `preview` is the default branch and the one people install from. It takes upstream changes from `master` through a PR whenever TALXIS moves; where they clash with work here, upstream wins and the work is rebuilt on top.
- Releases are cut from `preview` with a `-preview.N` version.
- Commits that only make the fork installable (the preview version number and this section) live on `preview` alone, never on a PR branch.
- This repository is public: no customer names, project codes, internal paths or people's names in code, commits, branch names or PR text.

## Development Setup

```bash
npm install
npm run build
npm test
```

## Making Changes

1. Read `/docs/PRINCIPLES.md` before modifying the language
2. For significant changes, add a decision record to `/docs/DESIGN-DECISIONS.md`
3. Track unresolved design questions in `/plan/00-design-decisions.md`
4. Run `npm test` and `npm run typecheck` before committing

## Schema Files

| Type | Pattern | Location |
|------|---------|----------|
| Shared definitions | `*.defs.yaml` | `schemas/{version}/defs/` |
| Type definitions | `*.types.yaml` | `schemas/{version}/types/` |
| Document schemas | `*.schema.yaml` | `schemas/{version}/documents/` |

Every property must have a description explaining purpose, not just type.

## Questions?

Open an issue or check `/docs/` for design context.
