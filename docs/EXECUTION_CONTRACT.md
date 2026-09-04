# Execution Contract

Supported script kind:

- `python`

Generic create-analysis request:

```json
{
  "user": "agent user",
  "title": "Inspect artifact",
  "kind": "python",
  "script": "...python...",
  "dataset_id": "dataset_...",
  "parameters": {},
  "input_artifacts": ["input.csv"],
  "output_artifacts": ["summary.json"]
}
```

Generic create-step request:

```json
{
  "user": "agent user",
  "title": "Transform artifact",
  "kind": "python",
  "script": "...python...",
  "parent_dataset_id": "dataset_...",
  "parameters": {},
  "input_artifacts": ["input.csv"],
  "output_artifacts": ["cleaned.csv"],
  "remove_artifacts": [],
  "set_as_head": true
}
```

Request rules:

- `dataset_id` and `parent_dataset_id` default to the current head if omitted.
- `input_artifacts: []` means all artifacts in the source dataset.
- A step must have at least one `output_artifact` or `remove_artifact`.
- `output_artifacts` and `remove_artifacts` must not overlap.
- `user`, `title`, `kind`, and `script` are required.

Script environment:

- `SCRUBDATA_SPEC_PATH`
- `SCRUBDATA_SUMMARY_PATH`

Script responsibilities:

- Read the spec JSON from `SCRUBDATA_SPEC_PATH`.
- Write declared outputs to the declared paths.
- Write a machine-readable summary to `SCRUBDATA_SUMMARY_PATH`.
- Exit non-zero on failure.

Framework responsibilities:

- Persist script, spec, and summary files.
- Verify declared outputs exist before using them in a new dataset.
- Reuse unchanged parent artifacts by reference.
- Never mutate raw inputs.

Head actions:

- `POST /api/project/{project}/head` moves `current_dataset_id` to a chosen dataset.
- `POST /api/project/{project}/undo` moves `current_dataset_id` to the current head's parent.
- Neither action deletes datasets.
