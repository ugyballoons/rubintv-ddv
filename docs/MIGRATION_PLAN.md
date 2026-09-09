# DDV front-end migration plan: Flutter → web-native

Status: proposal, 2026-09-09.
Scope: `rubintv_visualization` (Flutter web app, ~11.9k lines Dart) and `rubin_chart`
(hand-written Flutter chart package, ~9.2k lines Dart). The Python
`rubintv_analysis_service` and the RubinTV broker are unchanged except for a few
small protocol fixes listed in §6.

## 1. Summary and recommendation

The migration is feasible and, on the evidence in the code, a net simplification.
The recommendation is:

| Layer                  | Choice                                                                                      | Why                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI framework           | **React 19 + TypeScript**                                                                   | The main RubinTV app (`lsst-ts/rubintv`) is already React 19 / TypeScript / webpack / Jest. One framework, one skill set, and DDV can eventually share components with RubinTV.                                                                      |
| Build tool             | **Vite** for a standalone DDV package (webpack only if DDV is folded into the RubinTV repo) | Faster dev loop; output is a static `dist/` that RubinTV serves exactly as it serves the Flutter build today.                                                                                                                                        |
| Chart engine           | **Apache ECharts 6**                                                                        | Best fit for the specific axis and interaction requirements (base‑e log axes, custom tick formatters for MJD, scroll‑pan / shift‑zoom, inverted axes, custom-series histograms on log axes), first-party TypeScript types, small tree-shaken bundle. |
| Focal plane + colorbar | **Plain SVG in React + `d3-scale` / `d3-interpolate`**                                      | ~200 polygons from server-supplied corners. No chart library adds value here, and SVG gives free hit-testing, hover, and keyboard navigation.                                                                                                        |
| Selection hit-testing  | **KDBush** (flat static KD-tree)                                                            | Replaces the Dart quadtree. ECharts' brush component is not supported on large-mode scatter series, and the app already does its own hit-testing, so keep that responsibility in app code.                                                           |
| State                  | **Zustand** store slices                                                                    | Direct mapping from the current BLoCs; the `copyWith` boilerplate and subscribe/unsubscribe lifecycle code disappear.                                                                                                                                |
| WebSocket              | **`reconnecting-websocket`** + a `requestId → Promise` correlation layer                    | RubinTV already uses this package. The Flutter client has no reconnect at all.                                                                                                                                                                       |
| Window manager         | **`react-rnd`** (free-floating windows, matches the saved-workspace format)                 | Gives top-edge resize, min-size and viewport clamping, and z-order for free. `dockview` is the upgrade path if a tiling layout is wanted later.                                                                                                      |

Plotly.js is a credible second choice and is the fallback if the phase‑0 spike
shows app-side selection at 100k points is too slow (see §3.3). It is stronger
than ECharts in exactly one area that matters here: native box/lasso selection on
WebGL scatter. It is weaker on tick formatting, log bases, pan/zoom mapping,
bundle size, and React ergonomics.

A large secondary win is operational. Today every RubinTV container start clones
`rubin_chart` and `rubintv_visualization` at `$DDV_DEPLOY_BRANCH` and runs
`flutter build web --profile` (`start-daemon.sh` → `scripts/build-flutter-app.sh`),
and the RubinTV image carries a full Flutter SDK. The replacement is a Node build
stage in the RubinTV Dockerfile pinned to a DDV release tag.

## 2. What the current app actually is

The inventories below come from reading the code, not the docs. Line references
are in the three explorer reports summarised here.

### 2.1 Windows and workspace (`rubintv_visualization/lib/workspace`)

- Window types actually used: cartesian scatter, polar scatter, histogram, box,
  focal plane, detector selector. `combination` is declared but throws on creation.
- Windows are free-floating in a `Stack`, drag by title bar only, resize from
  left/right/bottom/bottom-corners only, no z-order, no focus, no clamping,
  no minimum size. New windows stair-step from the last window's offset.
- Toolbar: connection status dot, instrument dropdown (hard-coded LsstCam,
  LsstComCam, Latiss, LsstComCamSim), show focal plane, detector label, load
  workspace (paste JSON / remote file), save workspace (clipboard / remote file),
  add chart menu, copy selection as `[(dayObs, seqNum), …]`, global query editor,
  date picker, "clear all" (which destroys the workspace, not the selection),
  log export.
- Workspace JSON: `{windows, version, instrument, globalQuery, dayObs, detector}`.
  Window states carry series as `{name, schema, database}` field references
  resolved against the live schema on load. Loading a workspace saved under a
  different instrument first sends `load instrument` and parks the JSON.
- Data model: schema from the server's `instrument info` message; the client
  hard-codes the exposure/visit1/ccd table taxonomy (duplicated from
  `database.py`) to choose `exposure_id` vs `visit_id` and to exclude CCD tables
  from scatter series. Boolean columns are silently dropped; `date`/`datetime`
  datatypes throw.

### 2.2 Charts (`rubin_chart` + `rubintv_visualization/lib/chart`)

Design target is **≤100,000 points per scatter series** (the row-count
confirmation dialog fires above that). Rendering is CPU canvas with a cached
picture above 100k, debounce-smeared pan/zoom, and one quadtree per axes-set for
hit-testing only. No downsampling, no WebGL.

Features to preserve:

- Cartesian scatter with numeric, categorical, datetime (rendered as MJD floats),
  log10 and log‑e axes, per-axis inversion (the norm for magnitudes), fixed-bounds
  axes immune to zoom.
- Polar scatter with θ=0 at top increasing clockwise and an invertible radial
  axis (max at centre for altitude plots).
- Histogram with **bins computed in pixel space** (uniform on-screen widths on a
  log axis), categorical and datetime main axes, count axis inverted for
  horizontal orientation. Bins carry their contributing data IDs.
- Binned box plot: continuous main axis binned, five-number summary per bin,
  whiskers to min/max, drawn correctly on log axes.
- Interactions: click / click-empty-to-clear / rectangle drag select on scatter;
  drag-in-drill-down-mode = zoom to region; plain scroll pans, shift+scroll zooms,
  pinch zooms, holding `X` or `Y` constrains zoom to one axis; `Esc` clears
  drill-down. Histogram/box: click, cmd/ctrl-click toggle, shift-click range,
  left/right arrows navigate bins with wrap-around and shift-extend across
  non-contiguous blocks.
- Two independent selection channels shared across all charts, keyed on
  `DataId{dayObs, seqNum}`: **selection** (last writer wins, with a live
  uncommitted preview broadcast during drag) and **drill-down** (filters the
  rendered points and, optionally, refits the axes).
- Tooltips after a delay (1 s scatter, 0.5 s binned), live coordinate readout,
  legend click opens the series editor, floating draggable legend, 21-colour
  distinguishable series cycle, reset-axes and sync-with-server buttons,
  per-chart "use global query" toggle, series editor with autocomplete column
  combobox, axis editor (label + invert), row-count confirmation above 100k.

Things the current library only pretends to do, which come free with any JS
library: calendar datetime axes (the implementation throws), grid lines,
error bars, non-circle markers, per-point colour/size, horizontal legends,
legend click to toggle visibility, lasso select, zoom about the cursor.

### 2.3 Focal plane (`rubintv_visualization/lib/focal_plane`)

- Geometry is server-supplied: `instrument info` carries `detectors[{id, name,
corners: [[x,y]×4]}]`. The client computes bboxes, a uniform scale, flips y,
  fills polygons, labels detector ids.
- Click and arrow-key detector selection (nearest centre in that direction).
- Colorbar with user-editable stops: tap to add a stop, drag handles, tap a
  handle for a hue-ring colour picker with numeric value; stops rescale
  proportionally when data bounds change; piecewise-linear colour lerp.
- Playback over the sorted `dataIds`: play/pause, step, index slider, speed
  slider 0.1–10×, loop toggle; chips for dayObs, seqNum, column.
- Column editor limited to CCD tables; detector column found by substring match.
- Refetches on selection change (500 ms debounce) using the selected DataIds.

### 2.4 Query builder, file dialog, transport

- Query expression is an immutable graph (nodes/roots/children/parents) with
  add/update/remove/reparent/connect, single-child-parent collapse, cycle check,
  and a single-root invariant. UI: per-node rows with left/right operators and
  values; drag a node's handle onto another to AND them; parent operator
  dropdown (and/or/xor). Wire form is a recursive tree sent as `query` and
  `global_query`.
- File dialog operates on a **remote** filesystem via eight websocket commands
  (`list directory`, `create directory`, `rename`, `delete`, `duplicate`, `move`,
  `save`, `load`), rendered as a directory tree + listing with drag-to-move and
  click-again-to-rename.
- Transport: one broadcast stream every BLoC filters by a composite `requestId`
  of `"{windowId},{windowId}-{seriesId}"`; 5 s ping, 20 s pong timeout that
  only toasts; `reconnect()` exists and is never called; `isConnected` stays
  true after the socket dies.

### 2.5 Deployment today

- RubinTV (`lsst-ts/rubintv`, FastAPI + React 19/TS/webpack) mounts the build at
  `{prefix}/ddv` from `ddv/build/web`, proxies the browser socket at
  `{prefix}/ws/ddv/client`, and accepts analysis-service workers at
  `/rubintv/internal/ddv/worker`. The broker never inspects payloads.
- The RubinTV Dockerfile clones the Flutter SDK; `start-daemon.sh` clones both
  Dart repos at `$DDV_DEPLOY_BRANCH` and runs `flutter build web --profile` at
  **container start**. The `deploy-*` branches in this checkout are identical to
  `main`; the branch name is only a deployment selector.

## 3. Feasibility: chart engine

### 3.1 Requirements matrix

Legend: **native** = option flag; **config** = a few lines of configuration or a
formatter; **app** = implemented in application code either way; **gap** = not
supported.

| Requirement                                               | ECharts 6                                                                                       | Plotly.js 3.4                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 100k-point scatter render                                 | native (`large`, `progressive`, typed arrays)                                                   | native (`scattergl`, WebGL)                                            |
| Rectangle select over 100k points                         | **app** (brush unsupported in large mode; use KDBush)                                           | native (box/lasso, returns indices)                                    |
| Live cross-chart selection preview during drag            | app                                                                                             | app                                                                    |
| Two selection channels keyed by DataId                    | app                                                                                             | app                                                                    |
| Histogram with pixel-space bins on a log axis             | config (`custom` series drawing rects at explicit edges)                                        | awkward (`bar` widths in data units misbehave on log axes; use shapes) |
| Binned box plot at numeric x                              | config (`custom` series, or `boxplot` on a category axis)                                       | native (`box` with precomputed quartiles and numeric x)                |
| Polar: θ=0 at top, clockwise, inverted radius             | native (`angleAxis.startAngle`, `clockwise`, `radiusAxis.inverse`)                              | native (`angularaxis.rotation/direction`, reversed radial range)       |
| Datetime axis with optional MJD labels                    | native (`axisLabel.formatter` function)                                                         | config (manual `tickvals`/`ticktext`; no function formatters)          |
| Log axis base e with `eⁿ` labels                          | native (`logBase: Math.E` + formatter)                                                          | **gap** (base 10 only)                                                 |
| Scroll pans, shift+scroll zooms, X/Y-key constrained zoom | native (`dataZoom` inside: `moveOnMouseWheel`, `zoomOnMouseWheel: 'shift'`, per-axis instances) | app (custom wheel + `relayout` handlers)                               |
| Inverted axes, fixed bounds                               | native                                                                                          | native                                                                 |
| Tooltips, legend toggle, grid lines, error bars, markers  | native                                                                                          | native                                                                 |
| Categorical axis on 100k rows                             | native (dataset dimension)                                                                      | native                                                                 |
| React integration                                         | thin hook around `setOption` (~50 lines) or `echarts-for-react`                                 | `react-plotly.js`                                                      |
| TypeScript                                                | first-party types                                                                               | community `@types/plotly.js`                                           |
| Bundle (minified, chart code only)                        | ~0.4 MB tree-shaken                                                                             | ~2 MB (`cartesian` + `gl2d` partial bundles)                           |
| Licence                                                   | Apache-2.0                                                                                      | MIT                                                                    |

### 3.2 Verdict

ECharts covers every requirement natively or with configuration except
rectangle selection on large series, and that one item the app should own
anyway: the current Flutter code already does its own hit-testing, the drag
preview must be broadcast to other charts mid-drag, and the histogram/box
keyboard state machine has no library equivalent. KDBush indexes 100k points in
a few milliseconds and answers a range query in well under a frame.

Plotly's native selection is attractive but its weaknesses hit the astronomy
specifics directly: no base‑e log axes, no function tick formatters (so MJD and
`eⁿ` labels are manual), and the pan/zoom behaviour users have learned would
have to be re-implemented on top of the library rather than switched on.

### 3.3 Decision gate (phase 0 spike)

Build the three riskiest pieces once with ECharts and once with Plotly, in a
throwaway Vite app against `scripts/mock_server.py`:

1. Scatter with 100k points from a `Float64Array`, rectangle drag select with
   live highlighted overlay, inverted y, log10 x, a second chart highlighting
   the same DataIds during the drag.
2. Histogram with bins computed in pixel space on a log axis, cmd-click and
   shift-click bin selection, arrow-key navigation.
3. Polar scatter with the astronomy convention and an inverted radial axis.

Pass criteria: drag select at 100k points stays above 30 fps; option updates on
selection change do not re-upload the full series; bundle under 1 MB gzipped
for the whole app. If ECharts passes, proceed; if it fails on (1), switch the
scatter adapter to Plotly `scattergl` or `regl-scatterplot` and keep ECharts for
the rest. The adapter boundary in §4.2 is what makes that swap cheap.

### 3.3.1 Spike log

Measured 2026-09-09 in headless Chrome (Playwright), Vite dev build, against
the mock broker and `dev_worker.py --rows 100000` (sqlite, synthetic exposures).

| Experiment                                                                                                        | Result                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Fetch 100k rows of 3 columns over the websocket (JSON)                                                            | ~0.3 s, convert to typed arrays ~35 ms                                               |
| Rectangle hit-test over 100k points (KDBush, `convertFromPixel`)                                                  | 2–5 ms per query                                                                     |
| Drag select, one 100k scatter                                                                                     | 61 fps                                                                               |
| Drag select, two linked 100k scatters + histogram, live preview on all                                            | 32–38 fps                                                                            |
| Selection overlay on its own ECharts `zlevel`                                                                     | kept base layer from re-uploading; modest fps gain                                   |
| Histogram: pixel-uniform bins on log10 axis (`custom` series)                                                     | correct equal-width bars                                                             |
| Bin selection: click, cmd-click toggle, shift-click range, arrow keys with wrap, shift+arrow extend across blocks | ported state machine passes unit tests and drives the linked scatters in the browser |
| Console errors                                                                                                    | none                                                                                 |

Open items from the spike: the frame rate with three linked panels sits just
above the 30 fps bar and is dominated by ECharts repainting the large base
series when the shared selection changes; candidates are throttling preview
broadcasts to linked charts to ~20 Hz, or drawing the base layer once to an
offscreen canvas. Polar (experiment 3) not yet run.

### 3.4 Alternatives considered

- **Plotly.js**: see above. Fallback for the scatter adapter.
- **Vue 3 + Pinia**: technically equivalent to React + Zustand and a perfectly
  good stack; not recommended only because it would be a second framework in
  the RubinTV codebase.
- **Vega-Lite**: elegant declarative brushing/linking, but canvas performance at
  100k points and the bespoke keyboard interactions push it out.
- **D3 / Observable Plot**: maximal control, most code. `d3-scale`,
  `d3-interpolate`, and `d3-axis` are still worth using as helpers for the focal
  plane and colorbar.
- **BokehJS**: Rubin uses Bokeh from Python, but its standalone JS API is built
  for Python-driven documents and is awkward to drive from TypeScript.
- **regl-scatterplot**: WebGL scatter specialised for millions of points with
  lasso select. The escape hatch if the 100k design target grows by an order of
  magnitude.
- **uPlot**: extremely fast but no polar, box, or rich selection.
- **Highcharts / LightningChart**: commercial licences; not worth the friction.

## 4. Target architecture

### 4.1 Repositories

Two separate public repositories, mirroring the current app/library split
(decided 2026-09-09; both created under github.com/ugyballoons to start):

- **`rubin-charts`** (https://github.com/ugyballoons/rubin-charts): the
  engine-independent chart core and the ECharts adapters. Successor to `rubin_chart`.

  ```
  src/core/        DataId keys, axis mappings, pixel-space binning, KDBush point index,
                   histogram bin-selection state machine
  src/adapter.ts   ChartAdapterProps contract
  src/adapters/    echarts option builders: scatter (done), polar, histogram, box
  ```

- **`rubintv-ddv`** (https://github.com/ugyballoons/rubintv-ddv): the React app.
  Successor to `rubintv_visualization`. Depends on `rubin-charts` from phase 2
  onwards (published to npm or consumed as a git dependency; decide then).

  ```
  src/protocol/    websocket client, message types, requestId correlation (done)
  src/model/       schema, instrument, QueryExpression, workspace serialisation (v0.1 compatible)
  src/store/       Zustand slices: connection (done), workspace, windows, selection, drillDown, globalQuery
  src/charts/      chart windows built on rubin-charts adapters
  src/focalPlane/  SVG renderer, colorbar, playback, column editor, detector selector
  src/query/       expression editor
  src/files/       remote file dialog
  src/workspace/   toolbar, window manager (react-rnd), editors, dialogs
  docs/            this plan
  ```

Both are GPL-3.0-or-later like the rest of the Rubin software, use Vite,
vitest, oxlint and prettier, and run lint, typecheck, test and build in GitHub
Actions on every push.

### 4.2 The chart adapter boundary

Every chart window renders through one interface so the engine stays swappable:

```ts
interface ChartAdapterProps {
  series: Array<{ id: SeriesId; x: Float64Array | string[]; y: ...; dataIds: DataIdKey[]; marker: Marker }>;
  axes: AxisSpec[];            // location, label, mapping (linear|log10|logE), inverted, fixedBounds, kind (number|category|datetime{mjd?})
  selected: ReadonlySet<DataIdKey>;
  drillDown: ReadonlySet<DataIdKey> | null;
  tool: 'select' | 'drillDown';
  onSelect(ids: Set<DataIdKey>, committed: boolean): void;   // committed=false is the live drag preview
  onZoom(bounds: AxisBounds[]): void;
  onAxisTap(axis: AxisId): void;
  onLegendTap(series: SeriesId): void;
}
```

Selection hit-testing, the histogram/box keyboard state machine, and the
pixel-space binning live in `charts/core` and are engine-independent. The
ECharts adapters only translate props into `setOption` calls and DOM events
into callbacks.

### 4.3 State mapping

| Flutter                 | React                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `WorkspaceBloc`         | `workspace` + `windows` slices                                                                      |
| `ControlCenter` streams | `selection` and `drillDown` slices (Sets of DataId keys, with `preview` field for uncommitted drag) |
| `ChartBloc` per window  | per-window slice entry + hooks; data lives in `seriesData` map keyed by SeriesId                    |
| `DataCenter`            | `schema` slice + `seriesData` slice                                                                 |
| `QueryBloc`             | local reducer inside the query editor                                                               |
| `FileDialogBloc`        | local reducer + protocol calls                                                                      |
| Row-count callback map  | `await protocol.countRows(...)` then a confirm dialog promise                                       |

### 4.4 Data path

Keep the JSON columnar payload initially. Convert incoming arrays to typed
arrays once on receipt and hand those to ECharts. If payloads above 100k rows
become routine, add an Apache Arrow binary frame type to the analysis service;
the broker already forwards frames verbatim and allows 100 MB.

## 5. Phased plan

Effort figures assume one engineer full time and are ranges, not commitments.

| Phase               | Weeks | Deliverable                                                                                                                                                                                                                                | Exit criterion                                |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 0. Spike            | 1–2   | Throwaway app with the three §3.3 experiments in both libraries; TS protocol client talking to `mock_server.py`                                                                                                                            | Engine decision recorded                      |
| 1. Foundations      | 2–3   | Repo scaffold (Vite, React 19, TS, ESLint/Prettier matching RubinTV), protocol client with reconnect + correlation, schema/instrument model, store, toolbar, window manager, workspace JSON load/save compatible with existing saved files | Existing saved workspaces load without charts |
| 2. Charts           | 3–4   | Scatter, polar, histogram, box adapters; selection + drill-down channels; series editor with off-the-shelf combobox; axis editor; row-count confirmation                                                                                   | Feature parity with §2.2 checklist            |
| 3. Focal plane      | 2     | SVG renderer, colorbar with stops, colour picker, playback, column editor, detector selector                                                                                                                                               | Parity with §2.3                              |
| 4. Query + files    | 1–2   | Expression editor with drag-to-combine, remote file dialog                                                                                                                                                                                 | Parity with §2.4                              |
| 5. Deploy + cutover | 1–2   | Node build stage in RubinTV Dockerfile pinned to a DDV tag; Flutter SDK removed; side-by-side at `{prefix}/ddv-next`; parity sign-off; delete Dart repos' deploy hooks                                                                     | Old app unmounted                             |

Total: roughly 10–15 weeks. Phases 3 and 4 can run in parallel with the tail of
phase 2 if a second person is available.

## 6. Backend and protocol changes to make alongside

Small, and all backwards compatible with the Flutter client:

1. Include `requestId` in `error` envelopes (`command.py`); today a failed
   request never resolves on the client.
2. Move file-command errors from `content.error` to a top-level `error`
   response, or have the client check `content.error`. Today they are dropped.
3. Add `date`/`datetime` to the client type map (client-side only).
4. Fix the `ParentQuery` round trip (`toJson` writes `operator`, `fromJson`
   reads `content.operator`), so compound global queries reload. Client-side.
5. Normalise the `left_operator` flip table keys in `query.py` to the operator
   names actually sent (`startswith`, not `starts with`).
6. Optional: expose `get bounds` in the series editor (already implemented
   server-side, never called).
7. Optional, later: Arrow frames for large payloads.

## 7. Risks

| Risk                                                                    | Mitigation                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| App-side selection at 100k points too slow in ECharts                   | Phase 0 measures it; Plotly `scattergl` or `regl-scatterplot` behind the same adapter                                          |
| Users' saved workspaces break                                           | Keep the v0.1 JSON format verbatim; implement the empty `convertWorkspace` hook for real; test against saved files from summit |
| Interaction parity regressions (keyboard bin navigation, X/Y zoom keys) | Port the state machines as pure functions with unit tests before wiring UI                                                     |
| Framework choice contested by the RubinTV team                          | Decide in phase 0 with them; the plan changes only in the `workspace/` and `query/` UI code if Vue is chosen                   |
| Two apps in flight during cutover                                       | Serve both at different prefixes from the same RubinTV image; no backend change needed                                         |

## 8. Things not to port

Dead or misleading code identified during the survey: `WindowTypes.combination`,
`Butler`/`EfdClient` data sources, `image/viewer.dart`, `FutureLoadColumnsCommand`,
the unregistered `LoadDetectorInfoCommand`/`LoadImageCommand`, the `dateTimeSelect`
tool, `ReparentQuery`, `QueryOperator.not`, the duplicate reset button on binned
charts, the two no-op hamburger buttons, the "Clear all selections" button that
clears the workspace, the static row-count callback map, and the 130-line
hand-rolled autocomplete scroll manager.
