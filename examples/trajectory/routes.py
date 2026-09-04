import textwrap
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.execution import create_step
from app.state import ProjectStateError, get_dataset_artifact
from app.web import get_project_dir, json_error, parse_json_body, validate_path_part

from .summary import build_trajectory_summary


DELETE_CHECKED_SCRIPT = textwrap.dedent(
    """
    import csv
    import json
    import os
    from pathlib import Path


    def normalize_header(header):
        return str(header or "").lower().replace("-", "").replace("_", "").replace(":", "").replace(" ", "")


    def find_column(normalized_map, aliases):
        for alias in aliases:
            if alias in normalized_map:
                return normalized_map[alias]
        return None


    def detect_individual_column(fieldnames):
        normalized = {normalize_header(name): name for name in fieldnames}
        return find_column(normalized, [
            "individual",
            "individualid",
            "individuallocalidentifier",
            "animalid",
            "trackid",
            "taglocalidentifier",
            "id",
        ])


    def main():
        spec_path = Path(os.environ["SCRUBDATA_SPEC_PATH"])
        summary_path = Path(os.environ["SCRUBDATA_SUMMARY_PATH"])
        spec = json.loads(spec_path.read_text())
        params = dict(spec["step"].get("parameters") or {})
        target_artifact = str(params.get("target_artifact") or "").strip()
        selected = sorted({str(item).strip() for item in params.get("individuals", []) if str(item).strip()})
        reason = str(params.get("reason") or "").strip()
        if not target_artifact:
            raise SystemExit("Missing target artifact")
        if not selected:
            raise SystemExit("No individuals selected")

        source = None
        for artifact in spec.get("input_artifacts", []):
            if artifact.get("logical_name") == target_artifact:
                source = artifact
                break
        if source is None:
            raise SystemExit("Target artifact was not provided as an input")

        output = None
        for artifact in spec.get("output_artifacts", []):
            if artifact.get("logical_name") == target_artifact:
                output = artifact
                break
        if output is None:
            raise SystemExit("Target artifact was not declared as an output")

        selected_set = set(selected)
        removed_rows = 0
        retained_rows = 0
        removed_individuals = set()
        seen_rows = 0

        with Path(source["path"]).open("r", newline="", encoding="utf-8") as input_handle:
            reader = csv.DictReader(input_handle)
            fieldnames = list(reader.fieldnames or [])
            if not fieldnames:
                raise SystemExit("CSV did not contain a header row")
            individual_column = detect_individual_column(fieldnames)
            if not individual_column:
                raise SystemExit("CSV is missing an individual identifier column")

            output_path = Path(output["path"])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with output_path.open("w", newline="", encoding="utf-8") as output_handle:
                writer = csv.DictWriter(output_handle, fieldnames=fieldnames)
                writer.writeheader()
                for row in reader:
                    seen_rows += 1
                    individual = str(row.get(individual_column, "")).strip()
                    if individual and individual in selected_set:
                        removed_rows += 1
                        removed_individuals.add(individual)
                        continue
                    writer.writerow(row)
                    retained_rows += 1

        summary = {
            "app": "trajectory",
            "action": "delete_checked",
            "target_artifact": target_artifact,
            "requested_individuals": selected,
            "deleted_individuals": sorted(removed_individuals),
            "missing_individuals": sorted(selected_set - removed_individuals),
            "input_rows": seen_rows,
            "retained_rows": retained_rows,
            "removed_rows": removed_rows,
            "reason": reason,
        }
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\\n")


    if __name__ == "__main__":
        main()
    """
).strip() + "\n"


def _validate_individuals(value: object) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Invalid individuals list")
    cleaned = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError("Invalid individuals list")
        name = " ".join(item.strip().split())
        if not name:
            raise ValueError("Invalid individuals list")
        cleaned.append(name)
    unique = sorted(set(cleaned))
    if not unique:
        raise ValueError("At least one checked individual is required")
    return unique


def _validate_reason(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Reason is required")
    reason = " ".join(value.strip().split())
    if not reason:
        raise ValueError("Reason is required")
    if len(reason) > 240:
        raise ValueError("Reason is too long")
    return reason


def register_trajectory_routes(app: FastAPI, *, data_root: Path):
    data_root = data_root.resolve()

    @app.get("/api/project/{project_name}/apps/trajectory/dataset/{dataset_id}/summary")
    async def get_trajectory_summary(
        project_name: str,
        dataset_id: str,
        logical_name: str,
        include_fixes: int = 0,
    ):
        try:
            project_dir = get_project_dir(data_root, project_name)
            _, artifact_path = get_dataset_artifact(project_dir, dataset_id, logical_name)
            return JSONResponse(build_trajectory_summary(artifact_path, include_fixes=bool(include_fixes)))
        except (ValueError, ProjectStateError) as exc:
            return json_error(str(exc), 404)

    @app.post("/api/project/{project_name}/apps/trajectory/actions/delete-checked")
    async def post_delete_checked(project_name: str, request: Request):
        body = await parse_json_body(request)
        if body is None:
            return json_error("Invalid JSON body", 400)

        try:
            project_dir = get_project_dir(data_root, project_name)
            dataset_id = validate_path_part(body.get("dataset_id"), label="dataset")
            logical_name = validate_path_part(body.get("logical_name"), label="artifact")
            individuals = _validate_individuals(body.get("individuals"))
            reason = _validate_reason(body.get("reason"))
            user = body.get("user")

            payload = {
                "user": user,
                "title": f"Delete {len(individuals)} checked individual(s) from {logical_name}",
                "kind": "python",
                "script": DELETE_CHECKED_SCRIPT,
                "parameters": {
                    "app": "trajectory",
                    "action": "delete_checked",
                    "target_artifact": logical_name,
                    "individuals": individuals,
                    "reason": reason,
                },
                "parent_dataset_id": dataset_id,
                "input_artifacts": [logical_name],
                "output_artifacts": [logical_name],
                "set_as_head": True,
            }
            return JSONResponse(create_step(project_dir, payload))
        except (ValueError, ProjectStateError) as exc:
            return json_error(str(exc), 400)
