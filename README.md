# rubintv-ddv

Web-native front-end for RubinTV's Derived Data Visualization (DDV): React 19,
TypeScript and Vite, with charts from [`rubin-charts`](https://github.com/ugyballoons/rubin-charts).
It replaces the Flutter app [`rubintv_visualization`](https://github.com/lsst-ts/rubintv_visualization)
and talks the same websocket protocol to
[`rubintv_analysis_service`](https://github.com/lsst-ts/rubintv_analysis_service),
so both front-ends can be served side by side during the cutover.

The migration plan, feature inventory and protocol notes are in
[docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md).

## Develop

```
npm install
cp .env.example .env      # point at a local mock_server.py or a RubinTV instance
npm run dev
npm test
```

### Local loop without a real consdb

With `rubintv_analysis_service` checked out beside this repo and its conda
environment active:

```
# 1. the broker (in rubintv_analysis_service)
python scripts/mock_server.py -p 9926

# 2. a worker backed by the service's sqlite test database (here)
python scripts/dev_worker.py -p 9926

# 3. the app, with .env containing VITE_DDV_WS_PATH=ws and VITE_DDV_WS_PORT=9926
npm run dev
```

Open http://127.0.0.1:5173/rubintv/ddv/ and choose the `testdb` instrument.

### End-to-end tests

The Playwright suite in `e2e/` drives the real app against the synthetic
backend. Start that backend on its own port (it must not share a broker with a
real worker), then run the tests; they start a second Vite server on port 5174:

```
scripts/dev-stack.sh          # mock broker + sqlite worker on port 9927
npm run e2e                   # Playwright's Chromium (npx playwright install chromium once)
E2E_BROWSER_CHANNEL=chrome npm run e2e   # or an installed Chrome
```

Tests skip themselves when no broker is listening on the port.

The build lands in `dist/` and is meant to be mounted by RubinTV at `{prefix}/ddv`,
exactly where the Flutter build is served today. Set `VITE_BASE` to change the mount path.

Licensed under the GPL-3.0-or-later, like the rest of the Rubin Observatory software.
