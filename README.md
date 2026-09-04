# Scrubdata

Scrubdata is a small scaffold for local data apps backed by a reproducible dataset DAG.

The default workflow is:

1. Put input files in `data/<project>/`.
2. Run `python server.py`.
3. Ask Codex to extend the starter app in `server.py` and `static/`.
4. Use `examples/trajectory/` only as a reference.

Key rules:

- Top-level non-hidden files under `data/<project>/` become the initial dataset automatically.
- Raw input files are immutable.
- `analysis` records exploratory work and does not create a dataset.
- `step` creates a new dataset node.
- Domain logic belongs in the starter app or an example app, not in `app/`.

Repository layout:

```text
app/                  generic lineage, execution, preview, and HTTP internals
server.py             default starter app server
static/               default starter app frontend
examples/trajectory/  richer reference app
data/<project>/       project inputs plus scrubdata state
docs/                 minimal contracts for agents
```

Reference example:

```bash
python examples/trajectory/server.py
```

Contracts:

- [AGENTS.md](/Users/justinkay/scrubdata/AGENTS.md)
- [docs/ARCHITECTURE.md](/Users/justinkay/scrubdata/docs/ARCHITECTURE.md)
- [docs/STATE_MODEL.md](/Users/justinkay/scrubdata/docs/STATE_MODEL.md)
- [docs/EXECUTION_CONTRACT.md](/Users/justinkay/scrubdata/docs/EXECUTION_CONTRACT.md)
