# Scrubdata Agent Guide

Default behavior:

- Extend the starter app at `server.py` and `static/`.
- Use `examples/trajectory/` only as a reference or when the user explicitly wants a separate app.
- Keep `app/` generic.

Project model:

- A project lives under `data/<project>/`.
- Top-level non-hidden files are the raw inputs and become the initial dataset.
- Scrubdata state lives under `data/<project>/scrubdata/`.
- A dataset is a bundle of artifacts addressed by `logical_name`.

Valid DAG rules:

- Never mutate raw files in `data/<project>/`.
- Never write lineage state outside `scrubdata/`.
- Use an `analysis` for exploratory work.
- Use a `step` only for a persistent change.
- Every analysis and step must persist `user`, script, spec, and summary.
- A step must create a new dataset node.
- Reuse unchanged artifacts by reference; only materialize changed or new artifacts.
- Keep app-specific meaning in `artifact.metadata`, `step.parameters`, `step.summary`, or analysis outputs.

Where to put code:

- Generic lineage or execution behavior: `app/`
- Starter app routes: `server.py`
- Starter app UI: `static/`
- Reference app code: `examples/<app>/`

Backend wiring:

- Frontends should call the generic `/api/...` routes directly when possible.
- If the UI needs a domain-specific summary or named action, add an app-owned route in the starter app or example app.
- App-owned routes should translate persistent work into `create_analysis(...)` or `create_step(...)`, not modify lineage files directly.
