# Documentation & Wiki Contribution Guide (for GitHub Copilot & Contributors)

Defines the authoritative structure and conventions for documentation updates so automated assistance (Copilot) and humans keep the wiki lean and navigable.

## 1. Allowed Top-Level Wiki Pages
Only these files should exist at the wiki root:
1. `Home.md` – Landing & navigation.
2. `OVERVIEW.md` – User guide + feature overviews + basic workflows.
3. `TECHNICAL_REFERENCE.md` – All technical deep dives (architecture, algorithms, data sources, UI/UX, testing, security, extensibility).
4. `RELEASES.md` – Cumulative release notes (append; no per-release pages).

Reject creating new root wiki pages unless a compelling, durable category emerges (discuss in issue first).

## 2. When Updating Docs
| Change Type | Where to Edit | Commit Convention |
|-------------|--------------|-------------------|
| User workflow, new feature summary | `OVERVIEW.md` | `docs(overview): add X feature summary` |
| Algorithm / data source / model detail | `TECHNICAL_REFERENCE.md` | `docs(tech): update slope algo for ...` |
| Release entry | `RELEASES.md` | `release: add vX.Y.Z` |
| Navigation change | `Home.md` + related page | `docs(nav): ...` |

## 3. Release Process (Automation Friendly)
1. Implement & merge code changes.
2. Draft release section in `RELEASES.md` using template (keep descending chronological order – newest at top).
3. Update anchors in `TECHNICAL_REFERENCE.md` if algorithms/architecture changed.
4. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## 4. Section Structure Standards
Use level-2 headings (`##`) for primary sections inside aggregated pages. Provide concise intro paragraph then tables or bullet lists. Prefer tables for structured metrics.

## 5. Style Rules
* Voice: concise, task‑oriented, avoid marketing prose.
* Headings: Title Case except minor words; avoid emojis in `TECHNICAL_REFERENCE` algorithm headings (emojis permitted in `OVERVIEW` if clarifying).
* Tables: First column noun phrase; keep lines <120 chars.
* Code fences: annotate language.

## 6. Cross-Linking
Use relative links without `.md` extension (GitHub wiki auto-resolves). Anchor format: `(#section-name)` lowercase with hyphens. After renaming a section, scan for inbound links.

## 7. Deletions / Consolidations
When moving content into an aggregated page, delete the old page in the wiki repo (do not leave stubs – extra pages clutter navigation). Preserve commit history by referencing original file name in a footnote if significant.

## 8. Copilot Prompts Examples
Add feature summary:
> "Update OVERVIEW.md feature overviews table to include new real elevation service (list latency + accuracy)."

Add algorithm change:
> "In TECHNICAL_REFERENCE.md under Slope algorithm section, document new dynamic sampling interval logic (variable by segment curvature)."

Add release:
> "Append v1.1.0 release to RELEASES.md with highlights (performance caching, elevation API integration)."

## 9. Do Not
* Create `RELEASE_<version>.md` files.
* Duplicate user instructions already in `OVERVIEW`.
* Add partial pages ("WIP") – use PR draft or issue until complete.
* Store secrets or tokens.

## 10. Validation Checklist (Pre-commit)
[] Navigation still lists only allowed pages.
[] Internal links resolve (spot-check 3–5).
[] New release entry includes validation checklist.
[] Technical changes cross-referenced in release (if relevant).

---
Maintainers: revisit this guide every major release to validate structure suitability.
