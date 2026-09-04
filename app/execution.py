import json
import os
import subprocess
import sys
from pathlib import Path

from .state import (
    ProjectStateError,
    create_output_artifact_entry,
    dataset_summary,
    finalize_artifact_entry,
    get_dataset_artifact_entry,
    list_history,
    load_dataset,
    load_project_state,
    make_id,
    normalize_user,
    now_iso,
    project_paths,
    resolve_artifact_path,
    save_dataset,
    save_json,
    update_project_state,
)


SUPPORTED_SCRIPT_KINDS = {"python"}


def validate_script_kind(kind: object) -> str:
    if not isinstance(kind, str) or kind not in SUPPORTED_SCRIPT_KINDS:
        raise ProjectStateError("Unsupported script kind")
    return kind


def validate_script(script: object) -> str:
    if not isinstance(script, str) or not script.strip():
        raise ProjectStateError("Missing script")
    return script.rstrip() + "\n"


def validate_name(name: object, label: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ProjectStateError(f"Missing {label}")
    value = name.strip()
    if len(value) > 200:
        raise ProjectStateError(f"{label.capitalize()} is too long")
    return value


def validate_optional_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ProjectStateError("Invalid boolean value")
    return value


def validate_parameters(payload: object) -> dict:
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise ProjectStateError("Invalid parameters")
    return payload


def validate_artifact_names(raw_names: object, *, allow_empty: bool = False) -> list[str]:
    if raw_names is None and allow_empty:
        return []
    if not isinstance(raw_names, list):
        raise ProjectStateError("Invalid artifact list")
    names = []
    for item in raw_names:
        if not isinstance(item, str) or not item.strip():
            raise ProjectStateError("Invalid artifact list")
        name = item.strip()
        if Path(name).name != name or name in {".", ".."}:
            raise ProjectStateError("Invalid artifact name")
        names.append(name)
    if not allow_empty and not names:
        raise ProjectStateError("At least one artifact is required")
    if len(set(names)) != len(names):
        raise ProjectStateError("Artifact names must be unique")
    return names


def run_python_script(script_path: Path, spec_path: Path, summary_path: Path):
    env = os.environ.copy()
    env["SCRUBDATA_SPEC_PATH"] = str(spec_path.resolve())
    env["SCRUBDATA_SUMMARY_PATH"] = str(summary_path.resolve())
    proc = subprocess.run(
        [sys.executable, str(script_path.resolve())],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(script_path.parent.resolve()),
        check=False,
    )
    if proc.returncode != 0:
        raise ProjectStateError(proc.stderr.strip() or proc.stdout.strip() or "Script failed")

    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
    else:
        summary = {"stdout": proc.stdout.strip()}
        save_json(summary_path, summary)
    return summary


def _selected_artifacts(project_dir: Path, dataset: dict, requested_names: list[str]) -> list[dict]:
    if not requested_names:
        return [dict(artifact) for artifact in dataset.get("artifacts", [])]
    selected = []
    for logical_name in requested_names:
        selected.append(dict(get_dataset_artifact_entry(dataset, logical_name)))
    return selected


def _analysis_output_entries(analysis_dir: Path, output_artifacts: list[str]) -> list[dict]:
    outputs_dir = analysis_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for logical_name in output_artifacts:
        output_path = outputs_dir / logical_name
        entries.append({"logical_name": logical_name, "path": str(output_path.resolve())})
    return entries


def create_analysis(project_dir: Path, payload: dict) -> dict:
    project_dir = project_dir.resolve()
    user = normalize_user(payload.get("user"))
    title = validate_name(payload.get("title"), "title")
    kind = validate_script_kind(payload.get("kind"))
    script = validate_script(payload.get("script"))
    parameters = validate_parameters(payload.get("parameters"))
    requested_inputs = validate_artifact_names(payload.get("input_artifacts", []), allow_empty=True)
    requested_outputs = validate_artifact_names(payload.get("output_artifacts", []), allow_empty=True)

    project_state = load_project_state(project_dir)
    dataset_id = payload.get("dataset_id") or project_state["current_dataset_id"]
    dataset = load_dataset(project_dir, dataset_id)
    selected_artifacts = _selected_artifacts(project_dir, dataset, requested_inputs)

    analysis_id = make_id("analysis")
    analysis_dir = project_paths(project_dir)["analyses"] / analysis_id
    analysis_dir.mkdir(parents=True, exist_ok=True)
    script_path = analysis_dir / "analysis.py"
    spec_path = analysis_dir / "spec.json"
    summary_path = analysis_dir / "summary.json"
    output_entries = _analysis_output_entries(analysis_dir, requested_outputs)

    script_path.write_text(script)
    spec = {
        "mode": "analysis",
        "project_name": project_dir.name,
        "project_dir": str(project_dir),
        "dataset": dataset_summary(dataset),
        "input_artifacts": [
            {
                "logical_name": artifact["logical_name"],
                "path": str(resolve_artifact_path(project_dir, artifact)),
                "content_type": artifact.get("content_type"),
                "metadata": artifact.get("metadata", {}),
            }
            for artifact in selected_artifacts
        ],
        "output_artifacts": output_entries,
        "analysis": {
            "analysis_id": analysis_id,
            "title": title,
            "user": user,
            "parameters": parameters,
        },
    }
    save_json(spec_path, spec)
    summary = run_python_script(script_path, spec_path, summary_path)

    realized_outputs = []
    for output in output_entries:
        output_path = Path(output["path"])
        if output_path.exists() and output_path.is_file():
            realized_outputs.append(
                {
                    "logical_name": output["logical_name"],
                    "path": output_path.relative_to(project_dir).as_posix(),
                    "size": output_path.stat().st_size,
                }
            )

    record = {
        "analysis_id": analysis_id,
        "dataset_id": dataset_id,
        "user": user,
        "title": title,
        "kind": kind,
        "created_at": now_iso(),
        "script_path": script_path.relative_to(project_dir).as_posix(),
        "spec_path": spec_path.relative_to(project_dir).as_posix(),
        "summary_path": summary_path.relative_to(project_dir).as_posix(),
        "parameters": parameters,
        "input_artifacts": [artifact["logical_name"] for artifact in selected_artifacts],
        "output_artifacts": requested_outputs,
        "realized_output_artifacts": realized_outputs,
    }
    save_json(analysis_dir / "analysis.json", record)
    return {"analysis": record, "summary": summary}


def create_step(project_dir: Path, payload: dict) -> dict:
    project_dir = project_dir.resolve()
    user = normalize_user(payload.get("user"))
    title = validate_name(payload.get("title"), "title")
    kind = validate_script_kind(payload.get("kind"))
    script = validate_script(payload.get("script"))
    parameters = validate_parameters(payload.get("parameters"))
    set_as_head = validate_optional_bool(payload.get("set_as_head"), default=True)

    project_state = load_project_state(project_dir)
    parent_dataset_id = payload.get("parent_dataset_id") or project_state["current_dataset_id"]
    parent_dataset = load_dataset(project_dir, parent_dataset_id)
    parent_artifacts = {
        artifact["logical_name"]: dict(artifact)
        for artifact in parent_dataset.get("artifacts", [])
    }

    input_artifacts = validate_artifact_names(payload.get("input_artifacts", []), allow_empty=True)
    removed_artifacts = validate_artifact_names(payload.get("remove_artifacts", []), allow_empty=True)
    output_artifacts = validate_artifact_names(payload.get("output_artifacts", []), allow_empty=True)

    if not output_artifacts and not removed_artifacts:
        raise ProjectStateError("A step must remove artifacts or produce output artifacts")

    selected_inputs = _selected_artifacts(project_dir, parent_dataset, input_artifacts)
    for logical_name in removed_artifacts:
        if logical_name not in parent_artifacts:
            raise ProjectStateError("Unknown artifact")
    for logical_name in output_artifacts:
        if logical_name in removed_artifacts:
            raise ProjectStateError("An output artifact cannot also be removed")

    step_id = make_id("step")
    dataset_id = make_id("dataset")
    step_dir = project_paths(project_dir)["steps"] / step_id
    step_dir.mkdir(parents=True, exist_ok=True)
    script_path = step_dir / "transform.py"
    spec_path = step_dir / "spec.json"
    summary_path = step_dir / "summary.json"
    script_path.write_text(script)

    output_entries = []
    output_specs = []
    for logical_name in output_artifacts:
        entry, output_path = create_output_artifact_entry(project_dir, dataset_id, logical_name)
        output_entries.append(entry)
        output_specs.append(
            {
                "logical_name": logical_name,
                "path": str(output_path.resolve()),
            }
        )

    spec = {
        "mode": "step",
        "project_name": project_dir.name,
        "project_dir": str(project_dir),
        "parent_dataset": dataset_summary(parent_dataset),
        "input_artifacts": [
            {
                "logical_name": artifact["logical_name"],
                "path": str(resolve_artifact_path(project_dir, artifact)),
                "content_type": artifact.get("content_type"),
                "metadata": artifact.get("metadata", {}),
            }
            for artifact in selected_inputs
        ],
        "output_artifacts": output_specs,
        "step": {
            "step_id": step_id,
            "title": title,
            "user": user,
            "parameters": parameters,
            "remove_artifacts": removed_artifacts,
        },
    }
    save_json(spec_path, spec)
    summary = run_python_script(script_path, spec_path, summary_path)

    next_artifacts = dict(parent_artifacts)
    for logical_name in removed_artifacts:
        next_artifacts.pop(logical_name, None)
    for logical_name in output_artifacts:
        next_artifacts.pop(logical_name, None)
    for output_entry in output_entries:
        next_artifacts[output_entry["logical_name"]] = finalize_artifact_entry(project_dir, output_entry)

    dataset = {
        "dataset_id": dataset_id,
        "user": user,
        "created_at": now_iso(),
        "parent_dataset_id": parent_dataset_id,
        "note": title,
        "artifacts": sorted(next_artifacts.values(), key=lambda item: item["logical_name"]),
    }
    save_dataset(project_dir, dataset)
    if set_as_head:
        update_project_state(project_dir, {"current_dataset_id": dataset_id})

    step_record = {
        "step_id": step_id,
        "user": user,
        "title": title,
        "kind": kind,
        "created_at": now_iso(),
        "parent_dataset_id": parent_dataset_id,
        "output_dataset_id": dataset_id,
        "script_path": script_path.relative_to(project_dir).as_posix(),
        "spec_path": spec_path.relative_to(project_dir).as_posix(),
        "summary_path": summary_path.relative_to(project_dir).as_posix(),
        "parameters": parameters,
        "input_artifacts": [artifact["logical_name"] for artifact in selected_inputs],
        "output_artifacts": output_artifacts,
        "removed_artifacts": removed_artifacts,
        "set_as_head": set_as_head,
        "summary": summary,
    }
    save_json(step_dir / "step.json", step_record)
    return {
        "step": step_record,
        "dataset": dataset_summary(dataset),
        "history": list_history(project_dir),
    }


def set_current_head(project_dir: Path, dataset_id: str) -> dict:
    dataset = load_dataset(project_dir, dataset_id)
    update_project_state(project_dir, {"current_dataset_id": dataset["dataset_id"]})
    return dataset_summary(dataset)


def undo_to_parent(project_dir: Path) -> dict:
    project_state = load_project_state(project_dir)
    current_dataset = load_dataset(project_dir, project_state["current_dataset_id"])
    parent_dataset_id = current_dataset.get("parent_dataset_id")
    if not parent_dataset_id:
        raise ProjectStateError("Current head has no parent dataset")
    parent_dataset = load_dataset(project_dir, parent_dataset_id)
    update_project_state(project_dir, {"current_dataset_id": parent_dataset_id})
    return {
        "dataset": dataset_summary(parent_dataset),
        "history": list_history(project_dir),
    }
