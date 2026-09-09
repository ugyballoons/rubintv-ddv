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


def populate_synthetic(schema: dict, db_filename: str, n_rows: int, seed: int) -> None:
    """Fill the test schema's tables with n_rows plausible exposures.

    Same tables and column types as the 10-row fixture, so joins and the
    day_obs/seq_num data ids work unchanged. exposure_id == visit_id so the
    exposure <-> visit1_quicklook join matches every row.
    """
    import sqlite3

    import numpy as np
    from astropy.time import Time

    sys.path.insert(0, str(pathlib.Path(schema["_tests_dir"])))
    from utils import create_table  # noqa: E402

    rng = np.random.default_rng(seed)
    nights = max(1, min(30, n_rows // 500))
    per_night = -(-n_rows // nights)  # ceil
    first_night = Time("2025-11-01T00:00:00", scale="utc")
    filters = ["u", "g", "r", "i", "z", "y"]

    ids = np.arange(1, n_rows + 1)
    night_index = (ids - 1) // per_night
    seq_num = (ids - 1) % per_night
    night_mjd = first_night.mjd + night_index
    day_obs = [Time(m, format="mjd").strftime("%Y-%m-%d") for m in np.unique(night_mjd)]
    day_obs_col = [day_obs[i] for i in night_index]
    # Start times: one exposure every ~40 s through the night, with jitter
    obs_start_mjd = night_mjd + (seq_num * 40.0 + rng.normal(0, 3, n_rows)) / 86400.0 + 0.05
    obs_start = [Time(m, format="mjd").iso for m in obs_start_mjd]
    # A survey-like sky distribution: a few dense fields plus a scattered background
    field_ra = rng.uniform(0, 360, 6)
    field_dec = rng.uniform(-70, 10, 6)
    which = rng.integers(0, 6, n_rows)
    scatter = rng.random(n_rows) < 0.25
    ra = np.where(scatter, rng.uniform(0, 360, n_rows), (field_ra[which] + rng.normal(0, 1.5, n_rows)) % 360)
    dec = np.where(scatter, rng.uniform(-88, 30, n_rows), np.clip(field_dec[which] + rng.normal(0, 1.5, n_rows), -89, 30))
    physical_filter = [f"LSST {filters[i]}-band" for i in rng.integers(0, 6, n_rows)]
    exp_time = rng.choice([15.0, 30.0, 30.0, 30.0, 60.0], n_rows)

    generators = {
        "exposure_id": lambda: ids.tolist(),
        "visit_id": lambda: ids.tolist(),
        "seq_num": lambda: seq_num.tolist(),
        "day_obs": lambda: day_obs_col,
        "ra": lambda: ra.round(6).tolist(),
        "dec": lambda: dec.round(6).tolist(),
        "physical_filter": lambda: physical_filter,
        "obs_start": lambda: obs_start,
        "obs_start_mjd": lambda: obs_start_mjd.round(8).tolist(),
        "exp_time": lambda: exp_time.tolist(),
    }

    connection = sqlite3.connect(db_filename)
    cursor = connection.cursor()
    for table in schema["tables"]:
        create_table(cursor, table["name"], table["columns"])
        columns = []
        for col in table["columns"]:
            gen = generators.get(col["name"])
            columns.append(gen() if gen else [None] * n_rows)
        placeholders = ", ".join("?" for _ in columns)
        cursor.executemany(f"INSERT INTO {table['name']} VALUES({placeholders});", zip(*columns))
    connection.commit()
    cursor.close()
    connection.close()


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
    parser.add_argument(
        "--rows",
        type=int,
        default=0,
        help="Generate this many synthetic exposures per table instead of the 10-row test fixture "
        "(e.g. 100000 for the large-scatter spike)",
    )
    parser.add_argument("--seed", type=int, default=0, help="Random seed for synthetic data")
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
    schema["_tests_dir"] = str(tests_dir)
    with open(tests_dir / "joins.yaml") as f:
        joins = yaml.safe_load(f)["joins"]

    db_file = tempfile.NamedTemporaryFile(prefix="ddv-testdb-", suffix=".sqlite", delete=False)
    db_file.close()
    if args.rows > 0:
        populate_synthetic(schema, db_file.name, args.rows, args.seed)
    else:
        create_database(schema, db_file.name)
    engine = sqlalchemy.create_engine("sqlite:///" + db_file.name)
    database = ConsDbSchema(schema=schema, engine=engine, join_templates=joins)

    os.makedirs(args.user_path, exist_ok=True)
    data_center = DataCenter(schemas={"testdb": database}, user_path=args.user_path)

    schema.pop("_tests_dir", None)
    logging.getLogger(__name__).info(
        "testdb ready at %s (%s rows); connecting to ws://%s:%s%s", db_file.name, args.rows or 10, args.address, args.port, args.path
    )
    Worker(address=args.address, port=args.port, data_center=data_center, path=args.path).run()


if __name__ == "__main__":
    main()
