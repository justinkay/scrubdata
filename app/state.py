import json
import mimetypes
import uuid
from datetime import UTC, datetime
from pathlib import Path


META_DIR_NAME = "scrubdata"


class ProjectStateError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise ProjectStateError(f"Missing file: {path.name}") from exc
    except json.JSONDecodeError as exc:
        raise ProjectStateError(f"Invalid JSON: {path.name}") from exc


def save_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def normalize_user(user: object) -> str:
    if not isinstance(user, str):
        raise ProjectStateError("Missing user")
    normalized = " ".join(user.strip().split())
    if not normalized:
        raise ProjectStateError("Missing user")
    if len(normalized) > 80:
        raise ProjectStateError("User name is too long")
    return normalized


def normalize_artifact_entry(entry: dict) -> dict:
    normalized = dict(entry)
    normalized["metadata"] = dict(normalized.get("metadata") or {})
    return normalized


def normalize_dataset(dataset: dict) -> dict:
    normalized = dict(dataset)
    normalized["artifacts"] = [
        normalize_artifact_entry(artifact)
        for artifact in dataset.get("artifacts", [])
    ]
    return normalized


def project_paths(project_dir: Path) -> dict[str, Path]:
    meta_dir = project_dir / META_DIR_NAME
    return {
        "meta": meta_dir,
        "project": meta_dir / "project.json",
        "datasets": meta_dir / "datasets",
        "analyses": meta_dir / "analyses",
        "steps": meta_dir / "steps",
        "outputs": meta_dir / "outputs",
    }


def media_type_for_path(path: Path) -> str:
    media_type, _ = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


def iter_source_files(project_dir: Path):
    for candidate in sorted(project_dir.iterdir()):
        if candidate.name.startswith("."):
            continue
        if not candidate.is_file():
            continue
        yield candidate


def artifact_entry_for_path(project_dir: Path, source_path: Path) -> dict:
    return normalize_artifact_entry(
        {
            "logical_name": source_path.name,
            "path": source_path.name,
            "storage_type": "raw",
            "size": source_path.stat().st_size,
            "content_type": media_type_for_path(source_path),
            "metadata": {},
        }
    )


def ensure_project_state(project_dir: Path) -> dict:
    paths = project_paths(project_dir)
    for key in ("meta", "datasets", "analyses", "steps", "outputs"):
        paths[key].mkdir(parents=True, exist_ok=True)

    if paths["project"].exists():
        project_state = load_json(paths["project"])
        dataset_path = paths["datasets"] / f"{project_state['current_dataset_id']}.json"
        if not dataset_path.exists():
            raise ProjectStateError("Current dataset is missing")
        return project_state

    dataset_id = make_id("dataset")
    artifacts = [artifact_entry_for_path(project_dir, path) for path in iter_source_files(project_dir)]
    dataset = {
        "dataset_id": dataset_id,
        "user": "system",
        "created_at": now_iso(),
        "parent_dataset_id": None,
        "note": "Initial dataset from project inputs",
        "artifacts": artifacts,
    }
    project_state = {
        "project_name": project_dir.name,
        "root_dataset_id": dataset_id,
        "current_dataset_id": dataset_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    save_json(paths["datasets"] / f"{dataset_id}.json", dataset)
    save_json(paths["project"], project_state)
    return project_state


def load_project_state(project_dir: Path) -> dict:
    ensure_project_state(project_dir)
    return load_json(project_paths(project_dir)["project"])


def update_project_state(project_dir: Path, updates: dict):
    project_state = load_project_state(project_dir)
    project_state.update(updates)
    project_state["updated_at"] = now_iso()
    save_json(project_paths(project_dir)["project"], project_state)
    return project_state


def list_projects(data_root: Path) -> list[dict[str, object]]:
    projects = []
    if not data_root.exists():
        return projects

    for project_dir in sorted(data_root.iterdir()):
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue
        try:
            project_state = ensure_project_state(project_dir)
            dataset = load_dataset(project_dir, project_state["current_dataset_id"])
        except ProjectStateError:
            continue
        projects.append(
            {
                "name": project_dir.name,
                "current_dataset_id": dataset["dataset_id"],
                "artifact_count": len(dataset.get("artifacts", [])),
            }
        )
    return projects


def load_dataset(project_dir: Path, dataset_id: str) -> dict:
    path = project_paths(project_dir)["datasets"] / f"{dataset_id}.json"
    if not path.exists():
        raise ProjectStateError("Unknown dataset")
    return normalize_dataset(load_json(path))


def get_current_dataset(project_dir: Path) -> dict:
    project_state = load_project_state(project_dir)
    return load_dataset(project_dir, project_state["current_dataset_id"])


def save_dataset(project_dir: Path, dataset: dict):
    path = project_paths(project_dir)["datasets"] / f"{dataset['dataset_id']}.json"
    save_json(path, normalize_dataset(dataset))


def resolve_artifact_path(project_dir: Path, artifact_entry: dict) -> Path:
    path = (project_dir / artifact_entry["path"]).resolve()
    project_root = project_dir.resolve()
    if project_root not in path.parents and path != project_root:
        raise ProjectStateError("Invalid artifact path")
    if not path.exists() or not path.is_file():
        raise ProjectStateError(f"Missing artifact: {artifact_entry['logical_name']}")
    return path


def get_dataset_artifact_entry(dataset: dict, logical_name: str) -> dict:
    for artifact in dataset.get("artifacts", []):
        if artifact["logical_name"] == logical_name:
            return artifact
    raise ProjectStateError("Unknown artifact")


def get_dataset_artifact(project_dir: Path, dataset_id: str, logical_name: str) -> tuple[dict, Path]:
    dataset = load_dataset(project_dir, dataset_id)
    artifact = get_dataset_artifact_entry(dataset, logical_name)
    return artifact, resolve_artifact_path(project_dir, artifact)


def list_history(project_dir: Path) -> dict:
    paths = project_paths(project_dir)
    analyses = []
    if paths["analyses"].exists():
        for analysis_dir in sorted(paths["analyses"].iterdir()):
            record_path = analysis_dir / "analysis.json"
            if record_path.exists():
                analyses.append(load_json(record_path))

    steps = []
    if paths["steps"].exists():
        for step_dir in sorted(paths["steps"].iterdir()):
            record_path = step_dir / "step.json"
            if record_path.exists():
                steps.append(load_json(record_path))

    analyses.sort(key=lambda item: item.get("created_at", ""))
    steps.sort(key=lambda item: item.get("created_at", ""))
    return {"analyses": analyses, "steps": steps}


def list_datasets(project_dir: Path) -> list[dict]:
    datasets_dir = project_paths(project_dir)["datasets"]
    datasets = []
    if not datasets_dir.exists():
        return datasets
    for path in sorted(datasets_dir.glob("*.json")):
        datasets.append(normalize_dataset(load_json(path)))
    datasets.sort(key=lambda item: item.get("created_at", ""))
    return datasets


def dataset_summary(dataset: dict) -> dict:
    return {
        "dataset_id": dataset["dataset_id"],
        "user": dataset.get("user"),
        "created_at": dataset.get("created_at"),
        "parent_dataset_id": dataset.get("parent_dataset_id"),
        "note": dataset.get("note"),
        "artifact_count": len(dataset.get("artifacts", [])),
        "artifacts": dataset.get("artifacts", []),
    }


def project_state_payload(project_dir: Path) -> dict:
    project_state = load_project_state(project_dir)
    current_dataset = load_dataset(project_dir, project_state["current_dataset_id"])
    history = list_history(project_dir)
    return {
        "project": project_state,
        "current_dataset": dataset_summary(current_dataset),
        "history": history,
        "counts": {
            "datasets": len(list_datasets(project_dir)),
            "analyses": len(history["analyses"]),
            "steps": len(history["steps"]),
        },
    }


def graph_payload(project_dir: Path) -> dict:
    project_state = load_project_state(project_dir)
    datasets = list_datasets(project_dir)
    history = list_history(project_dir)
    nodes = [
        {
            "dataset_id": dataset["dataset_id"],
            "parent_dataset_id": dataset.get("parent_dataset_id"),
            "created_at": dataset.get("created_at"),
            "user": dataset.get("user"),
            "note": dataset.get("note"),
            "artifact_count": len(dataset.get("artifacts", [])),
            "artifact_names": [artifact.get("logical_name") for artifact in dataset.get("artifacts", [])],
        }
        for dataset in datasets
    ]
    edges = [
        {
            "step_id": step["step_id"],
            "parent_dataset_id": step["parent_dataset_id"],
            "output_dataset_id": step["output_dataset_id"],
            "title": step["title"],
            "user": step["user"],
            "created_at": step["created_at"],
            "input_artifacts": step.get("input_artifacts", []),
            "output_artifacts": step.get("output_artifacts", []),
            "removed_artifacts": step.get("removed_artifacts", []),
        }
        for step in history["steps"]
    ]
    return {
        "project_name": project_dir.name,
        "root_dataset_id": project_state["root_dataset_id"],
        "current_dataset_id": project_state["current_dataset_id"],
        "datasets": nodes,
        "steps": edges,
    }


def create_output_artifact_entry(project_dir: Path, dataset_id: str, logical_name: str) -> tuple[dict, Path]:
    output_dir = project_paths(project_dir)["outputs"] / dataset_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / logical_name
    relative_path = output_path.relative_to(project_dir).as_posix()
    entry = {
        "logical_name": logical_name,
        "path": relative_path,
        "storage_type": "output",
        "size": None,
        "content_type": media_type_for_path(output_path),
        "metadata": {},
    }
    return normalize_artifact_entry(entry), output_path


def finalize_artifact_entry(project_dir: Path, artifact_entry: dict) -> dict:
    resolved = resolve_artifact_path(project_dir, artifact_entry)
    updated = normalize_artifact_entry(artifact_entry)
    updated["size"] = resolved.stat().st_size
    updated["content_type"] = media_type_for_path(resolved)
    return updated
