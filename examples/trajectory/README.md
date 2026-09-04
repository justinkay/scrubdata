# Trajectory Example

This is a richer reference app for Scrubdata. It is not the default starting point for a new user.

Use it when you want to study a more complete app built on top of the scaffold.

It adds:

- a server-side summary route for large trajectory CSVs
- a self-contained trajectory frontend served directly by the example app
- a concrete UI action, `Delete checked`, that creates a generic DAG step
- an `Undo` toolbar action that calls the generic core undo route

## Run

```bash
python examples/trajectory/server.py
```

## Routes

- `GET /api/project/{project}/apps/trajectory/dataset/{dataset_id}/summary`
- `POST /api/project/{project}/apps/trajectory/actions/delete-checked`

## Delete Checked Flow

1. The frontend gathers the checked individuals from the current file.
2. It posts the action request to the trajectory app route.
3. The app translates that request into a generic `create_step(...)` call.
4. The generated step script streams the CSV, removes the selected individuals, and writes a replacement artifact with the same `logical_name`.
5. The core execution harness records the script, spec, summary, outputs, step record, and new dataset node.

This is the main example pattern in the repo: app-specific UI and routes on top, generic persistence underneath.
