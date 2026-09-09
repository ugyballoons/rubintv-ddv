"""Local development worker for rubintv-ddv.

Builds the small sqlite consdb that rubintv_analysis_service's test suite uses
and connects it to a mock broker (scripts/mock_server.py) as a worker, so the
web app can be developed without a real consdb, Butler, or credentials.

Usage (with the analysis service checked out beside this repo and its conda env active):

    python scripts/mock_server.py -p 9925          # in rubintv_analysis_service
    python scripts/dev_worker.py                   # here
    npm run dev                                    # here, with .env pointing at port 9925

Select the instrument "testdb" in the app.
"""

from __future__ import annotations

import argparse
import logging
import os
import pathlib
import sys
import tempfile

import sqlalchemy
import yaml

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_SERVICE = REPO.parent / "rubintv_analysis_service"


def _shim_afw_if_missing() -> None:
    """`load instrument` imports lsst.afw.cameraGeom unconditionally, but only uses it
    when the instrument has a camera. testdb has none, so a stub keeps the dev env
    free of the full LSST stack. (Upstream fix: move that import under `if camera`.)"""
    try:
        import lsst.afw.cameraGeom  # noqa: F401
        return
    except ImportError:
        pass
    import types

    afw = types.ModuleType("lsst.afw")
    camera_geom = types.ModuleType("lsst.afw.cameraGeom")
    camera_geom.FOCAL_PLANE = None  # type: ignore[attr-defined]
    afw.cameraGeom = camera_geom  # type: ignore[attr-defined]
    sys.modules["lsst.afw"] = afw
    sys.modules["lsst.afw.cameraGeom"] = camera_geom
    logging.getLogger(__name__).warning("lsst.afw not installed; stubbed lsst.afw.cameraGeom for testdb")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-a", "--address", default="localhost", help="Mock broker address")
    parser.add_argument("-p", "--port", default=9925, type=int, help="Mock broker port")
    parser.add_argument("--path", default="/ws/worker", help="Worker endpoint path on the broker")
    parser.add_argument(
        "--service",
        default=str(DEFAULT_SERVICE),
        help="Path to a rubintv_analysis_service checkout (for tests/schema.yaml, joins.yaml, utils.py)",
    )
    parser.add_argument("--user-path", default=str(REPO / ".dev-user"), help="Directory for saved workspaces")
    parser.add_argument("--log", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log.upper()))
    service = pathlib.Path(args.service)
    tests_dir = service / "tests"
    if not (tests_dir / "schema.yaml").exists():
        sys.exit(f"Cannot find {tests_dir / 'schema.yaml'}; pass --service")

    sys.path.insert(0, str(tests_dir))
    from utils import create_database  # noqa: E402  (rubintv_analysis_service/tests/utils.py)

    _shim_afw_if_missing()

    from lsst.rubintv.analysis.service.data import DataCenter
    from lsst.rubintv.analysis.service.database import ConsDbSchema
    from lsst.rubintv.analysis.service.worker import Worker

    with open(tests_dir / "schema.yaml") as f:
        schema = yaml.safe_load(f)
    # sqlite has no schema names; the test suite does the same.
    schema["name"] = None
    with open(tests_dir / "joins.yaml") as f:
        joins = yaml.safe_load(f)["joins"]

    db_file = tempfile.NamedTemporaryFile(prefix="ddv-testdb-", suffix=".sqlite", delete=False)
    db_file.close()
    create_database(schema, db_file.name)
    engine = sqlalchemy.create_engine("sqlite:///" + db_file.name)
    database = ConsDbSchema(schema=schema, engine=engine, join_templates=joins)

    os.makedirs(args.user_path, exist_ok=True)
    data_center = DataCenter(schemas={"testdb": database}, user_path=args.user_path)

    logging.getLogger(__name__).info(
        "testdb ready at %s; connecting to ws://%s:%s%s", db_file.name, args.address, args.port, args.path
    )
    Worker(address=args.address, port=args.port, data_center=data_center, path=args.path).run()


if __name__ == "__main__":
    main()
