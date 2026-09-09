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

The build lands in `dist/` and is meant to be mounted by RubinTV at `{prefix}/ddv`,
exactly where the Flutter build is served today. Set `VITE_BASE` to change the mount path.

Licensed under the GPL-3.0-or-later, like the rest of the Rubin Observatory software.
