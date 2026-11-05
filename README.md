![icon](./src/assets/icon.svg)

# RollerCoaster Web Client (`rc-web-client`)

`rc-web-client` provides the browser-based client application for RollerCoaster, an analytical workspace modeled after modern business intelligence suites. The client delivers interactive report canvas authoring, semantic data modeling, tabular data inspection, step-based data transformation, and custom analytical formula evaluation.

The application runs on Angular 22 in zoneless reactivity mode. State flows through Angular Signals and `OnPush` components. All heavy data transformations run off the main thread in dedicated Web Workers.

---

## Workspace Modules & Features

The web client organizes analytical workflows into specialized modules accessible via the primary left rail and top workspace bar:

### 1. Report Canvas (`/report-builder`)

- **Responsive Tile Grid**: Configurable CSS grid layout supporting dynamic column and row spans (`colSpan`, `rowSpan`).
- **Visual Archetypes**: Renders bar charts, column charts, line charts, area charts, pie and donut charts, KPI metric cards, tabular views, and Europe NUTS2 choropleth maps powered by Chart.js and `chartjs-chart-geo`.
- **Multi-Page Management**: Add, duplicate, rename, reorder, or delete report canvas pages using interactive tabs.
- **Visual Formatting Dock**: Fine-grained styling controls for chart titles, subtitles, custom color swatches, Cartesian axes, legends, tooltips, and data labels.
- **Filter Dock & Slicers**: Interactive dimension slicers and multi-select filter clauses evaluated reactively by the RAX filter context engine.
- **Undo / Redo Stack**: State snapshot history supporting quick rollbacks across canvas visual additions, deletions, repositioning, and formatting adjustments.

### 2. Table View (`/table-view`)

- **Data Exploration**: Tabular viewer for exploring loaded relational datasets, calculated tables, and measure outputs.
- **Dynamic Calendar Engine**: Built-in 365-day dynamic calendar generator with date offsets, fiscal quarters, day-of-week indexing, and `SUMMARIZECOLUMNS` aggregations.
- **Column Formatting**: Column sorting, numeric and currency formatting, schema inspection, and metadata profiling.

### 3. Semantic Data Model (`/model-view`)

- **Entity-Relationship Diagram**: Visual diagramming canvas displaying tables, field lists, data types, and primary/foreign key connections.
- **Relationship Editor**: Configure relationship cardinalities (`1:1`, `1:N`, `N:1`, `N:M`) and cross-filtering behavior (single or bidirectional).
- **Measure Inventory**: Dedicated panel to create, edit, inspect, and organize model-level analytical measures.

### 4. Data Preparation (`/data-prep`)

- **Applied Steps Pipeline**: Sequential, step-based ETL pipeline following the Power Query paradigm.
- **Transformation Toolkit**: Column renaming, explicit data type casting, row filtering, value replacement, delimiter splitting, and conditional column generation.
- **Audit & Step Reordering**: Inspect intermediate dataset states at any point in the transformation stack.

### 5. RAX Requests Studio (`/rax-requests`)

- **Formula & Query Console**: Dedicated workspace to draft, execute, and debug RollerCoaster Analytical Expressions (RAX).
- **Intelligent Formula Bar**: Syntax highlighting, token inspection, parameter tooltips, and contextual autocompletion.
- **Dual Execution Modes**: Evaluates single scalar expressions as KPI metrics or complex multi-line queries returning full tabular datasets.

### 6. Automated Print View (`/print-view/:reportId`)

- **Headless Export Target**: Dedicated route stripped of workspace chrome, sidebars, ribbons, and docks.
- **High-Fidelity Rendering**: Optimized for Playwright headless browser automation to produce crisp vector PDFs and high-resolution PNG exports.

### 7. Identity & Security (`/login`, `/signup`)

- **Session Lifecycle**: JWT token management with local persistence, automatic bearer authorization header injection, and silent session expiration handling.
- **Route Protection**: Functional Angular router guards (`authGuard`, `guestGuard`, `roleGuard`) controlling authenticated workspace entry.

### 8. Regulatory Compliance (`/accessibility`, `/privacy`)

- **Accessibility Declaration**: Formal RGAA 4.1.2 and WCAG 2.1 Level AA compliance statement with audit metrics, keyboard navigation mappings, and legal remediation channels.
- **Privacy Policy**: GDPR privacy declaration specifying zero user tracking, zero remote telemetry, and zero third-party egress.

---

## Technical Architecture

### Zoneless Angular 22

The application eliminates `zone.js` entirely using `provideZonelessChangeDetection()`. Change detection relies on Angular Signals (`signal`, `computed`, `effect`) and explicit signal writes (`.set()`, `.update()`). All components enforce `ChangeDetectionStrategy.OnPush`.

### Web Worker Compute Pipeline

Heavy mathematical transformations run in background threads to guarantee a smooth 60 FPS user interface:

- **LTTB Decimation Worker (`lttb-decimation.worker.ts`)**: Downsamples massive, high-frequency time-series datasets using the Largest Triangle Three Buckets algorithm, preserving visual peaks and troughs while preventing canvas DOM lockups.
- **Geo-Projection Worker (`geo-projection.worker.ts`)**: Computes TopoJSON and GeoJSON coordinate projections for European NUTS2 regional choropleths off the main thread.

### Project Archive Format (`.rcp`)

Projects serialize into standard `.rcp` ZIP packages constructed directly in the browser via `zip-archive.ts`. Each archive contains:

- `manifest.json`: Project metadata, UUID, engine compatibility, and SHA-256 checksums.
- `definition.json`: Canvas page definitions, tile layouts, visual archetypes, and bound measures.
- `model.rsdl`: Semantic model schema, table contracts, relationships, and calculated columns.
- `queries.rq.json`: Data preparation ETL steps and applied queries.
- `theme.json`: Design tokens and active theme configuration.

Contract definitions are formally validated against JSON Schema definitions bundled in `public/schemas/v1/`.

### Zero-Egress Privacy & Telemetry Suppression

- **Build Gate (`scripts/verify-telemetry.mjs`)**: Automated gate executed during `postinstall`, `prebuild`, and `pretest`. Ensures Angular CLI analytics remain disabled, `NG_CLI_ANALYTICS=false` is enforced, and no `zone.js` dependency exists.
- **Zero External CDNs**: All assets, including Assistant font variants (`.woff2`) and geographic boundary data, are hosted locally.
- **Strict Content Security Policy**: Prohibits unexpected outbound connections and iframe embedding.

---

## Repository Structure

```
rc-web-client/
├── .angular/                  # Angular build cache directory
├── public/
│   └── schemas/
│       └── v1/                # Official JSON Schema contracts (manifest, definition, theme)
├── scripts/
│   └── verify-telemetry.mjs   # Pre-build telemetry suppression and architecture gate
├── src/
│   ├── app/
│   │   ├── core/              # Core business logic, guards, interceptors, workers, state
│   │   │   ├── auth.guard.ts
│   │   │   ├── auth.interceptor.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── export.service.ts
│   │   │   ├── geo-projection.ts
│   │   │   ├── help-center.service.ts
│   │   │   ├── lttb-decimation.ts
│   │   │   ├── project-serialization.service.ts
│   │   │   ├── rax-language.service.ts
│   │   │   ├── rax-query.service.ts
│   │   │   ├── semantic-model.service.ts
│   │   │   ├── state-manager.service.ts
│   │   │   ├── writeback.service.ts
│   │   │   └── zip-archive.ts
│   │   ├── features/          # Domain feature components and views
│   │   │   ├── auth/          # Login and registration workflows
│   │   │   ├── compliance/    # Accessibility statement and privacy policy
│   │   │   ├── data-prep/     # Power Query ETL transformation interface
│   │   │   ├── model-view/    # ER semantic modeler and relationship editor
│   │   │   ├── print-view/    # Headless print layout for Playwright exports
│   │   │   ├── rax-requests/  # RAX formula console and evaluator
│   │   │   ├── report-builder/# Visual canvas, chart widgets, docks, and tabs
│   │   │   └── table-view/    # Tabular dataset explorer and calendar engine
│   │   ├── services/
│   │   │   └── api.service.ts # Common HTTP client service
│   │   ├── shared/            # Reusable standalone UI widgets
│   │   │   ├── chart-canvas.component.ts
│   │   │   └── rax-formula-bar.component.ts
│   │   ├── workers/           # Background Web Worker entrypoints
│   │   │   ├── geo-projection.worker.ts
│   │   │   └── lttb-decimation.worker.ts
│   │   ├── app.config.ts      # Zoneless bootstrap configuration and providers
│   │   ├── app.routes.ts      # Lazy-loaded route map
│   │   └── app.ts             # Shell container, navigation rail, and status bar
│   ├── assets/
│   │   ├── fonts/             # Self-hosted Assistant typography (WOFF2)
│   │   ├── geo/               # Europe NUTS2 TopoJSON boundaries
│   │   └── images/            # Brand marks and illustration assets
│   ├── styles/
│   │   ├── _maps.scss         # Chart color ramps and geographic map palettes
│   │   ├── _tokens.scss       # WCAG AA design system tokens
│   │   ├── _variables.scss    # Bootstrap 5.3 variable overrides
│   │   ├── _workspace.scss    # Workspace docks, canvas, and rail layout styles
│   │   └── styles.scss        # Global SCSS stylesheet
│   ├── index.html             # Shell HTML with early theme initialization
│   └── main.ts                # Application bootstrap entrypoint
├── angular.json               # Angular CLI workspace configuration
├── Dockerfile                 # Multi-stage production container build
├── nginx.conf                 # Hardened NGINX reverse proxy configuration
├── package.json               # Project manifest and scripts
├── proxy.conf.json            # Development proxy routing `/api` and `/ws`
├── tsconfig.app.json          # TypeScript compilation configuration for app
├── tsconfig.json              # TypeScript workspace configuration
├── tsconfig.spec.json         # Vitest TypeScript test configuration
└── tsconfig.worker.json       # Web Worker TypeScript configuration
```

---

## Getting Started

### Prerequisites

- **Node.js**: `24.x LTS`
- **npm**: `10.x` or higher
- **Backend API (Optional for full integration)**: Spring Boot service running on `http://localhost:8080`

### 1. Installation

Install project dependencies. The telemetry suppression gate runs automatically upon installation:

```bash
npm install
```

### 2. Development Server

Start the local development server on port 4200:

```bash
npm start
```

Navigate to `http://localhost:4200/`. The development server proxies `/api` and `/ws` calls to `http://localhost:8080` according to `proxy.conf.json`.

### 3. Production Build

Compile the application for production deployment:

```bash
npm run build
```

Compiled static artifacts are generated in `dist/rc-web-client/browser/`.

### 4. Running Unit Tests

Execute the Vitest test suite in non-watch mode:

```bash
npm test
```

The test runner evaluates all 20 test suites (140+ unit and accessibility tests), checking state transitions, serialization logic, formula lexing, and axe-core accessibility compliance.

---

## Container Deployment

The application includes a hardened multi-stage Docker build producing an unprivileged NGINX runtime container.

### Build Container Image

```bash
docker build -t rollercoaster-web-client:latest -f Dockerfile .
```

### Run Container Standalone

```bash
docker run -d \
  -p 8080:8080 \
  --name rc-web-client \
  rollercoaster-web-client:latest
```

### Production NGINX Features

- **Unprivileged Non-Root Execution**: Runs under the `nginx` UID/GID on port `8080`.
- **API & WebSocket Reverse Proxying**: Routes `/api/` requests to the Spring Boot REST endpoints and `/ws/` requests to STOMP WebSocket streams.
- **JSON Schemas**: Serves definition contracts at `/schemas/v1/` with CORS and cache headers.
- **Static Asset Optimization**: Immutably caches fonts and TopoJSON assets under `/assets/` for 7 days.
- **Security Hardening**: Drops indexing via `X-Robots-Tag: noindex, nofollow`, prevents clickjacking via `X-Frame-Options: DENY`, and locks browser execution via a rigid `Content-Security-Policy`.
- **HTML5 Routing**: Maps all fallback client routes to `index.html`.

---

## Code Standards & Accessibility Guidelines

All development within `rc-web-client` must follow the standards defined in `AGENTS.md`:

- **Component Encapsulation**: Keep components focused on view presentation and user orchestration. Delegate all state mutations and business computations to injected services.
- **Functional Dependency Injection**: Use functional `inject(...)` at the property declaration level instead of legacy constructor injection.
- **Strict Typing**: Disallow `any`. Define strong interfaces and DTOs for all data models and serialization boundaries.
- **Accessibility Compliance (RGAA 4.1.2 & WCAG 2.1 AA)**:
  - Contrast ratios must satisfy ≥ 4.5:1 for standard text and ≥ 3.0:1 for graphical interface controls.
  - Never convey status or validation states through color alone; accompany colors with text badges or semantic icons.
  - Interactive elements must retain visible focus indicators (`:focus-visible`).
  - Provide descriptive alternative text for non-text items and structured fallback data tables for canvas-rendered charts.
  - Maintain programmatic skip-links (`#main-content`) and ARIA live regions for background notifications.
