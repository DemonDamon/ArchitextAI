# Changelog

## [1.1.0] - January 10, 2026

### Added
- **DSL Editor Panel**: New side panel for real-time DSL editing with auto-sync
  - Auto-sync mode with 500ms debounce for live preview
  - Manual sync mode for controlled updates
  - Keyboard shortcuts: `Ctrl+S` to save, `Esc` to close
  - Copy to clipboard, reset to original, unsaved changes indicator
- **Edit DSL Code button** in Properties Panel for INFOGRAPHIC elements

### Fixed
- CSS centering for infographic content display
- Improved container styling for better visual alignment

---

## [1.0.0] - January 9, 2026

### Added
- **`hierarchy-structure` Template Support**: Added full support for the `hierarchy-structure` infographic template from `@antv/infographic`. This enables the generation of professional layered architecture diagrams.
- **New `/layers` Command**: Added a quick command alias for generating layered architecture diagrams.
- **Enhanced AI System Prompt**: The AI prompt in `infographicService.ts` now includes detailed instructions and examples for the `hierarchy-structure` template, ensuring correct DSL generation.

### Changed
- **README.md**: Completely rewritten in English. The document now accurately reflects the project's capabilities, including the new architecture diagram feature.
- **INFOGRAPHIC_TEMPLATES.md**: Updated to include documentation for the `hierarchy-structure` template with correct DSL format examples.
- **`infographicService.ts`**: Refactored the `cleanDslOutput` function to correctly handle nested `children` structures required by the `hierarchy-structure` template.

### Fixed
- **Architecture Diagram Generation Issue**: Resolved the bug where prompts like "generate a layered architecture diagram" would fail to produce a valid diagram. The root cause was:
    1. The `hierarchy-structure` template was not included in the AI's system prompt.
    2. The DSL cleaning function did not correctly handle the nested `children` indentation required by this template.

---

*Author: Damon Li*
