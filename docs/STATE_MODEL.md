# State Model

Project layout:

```text
data/<project>/
  raw top-level input files
  scrubdata/
    project.json
    datasets/<dataset_id>.json
    analyses/<analysis_id>/
      analysis.json
      analysis.py
      spec.json
      summary.json
      outputs/<artifact files>
    steps/<step_id>/
      step.json
      transform.py
      spec.json
      summary.json
    outputs/<dataset_id>/<artifact files>
```

Core objects:

- `project.json`
  Tracks `root_dataset_id` and `current_dataset_id`.
- dataset manifest
  A dataset is a bundle of artifacts. Each artifact has a `logical_name`, storage path, content type, size, and `metadata`.
- analysis record
  Records exploratory execution against a dataset. Does not create a new dataset.
- step record
  Records a persistent transform from `parent_dataset_id` to `output_dataset_id`.

Valid DAG rules:

- The initial dataset is built from the top-level non-hidden files in `data/<project>/`.
- Raw files stay immutable.
- A step always creates a new dataset manifest.
- A step must remove at least one artifact or produce at least one output artifact.
- Unchanged artifacts are reused by reference from the parent dataset.
- Output artifacts replace artifacts with the same `logical_name`.
- App-specific fields do not belong in the core schema. Put them in:
  - `artifact.metadata`
  - `step.parameters`
  - `step.summary`
  - analysis outputs

Head semantics:

- `current_dataset_id` is only the active head pointer.
- Older datasets remain in the DAG.
- `undo` moves the head to the parent dataset. It does not delete descendants.
