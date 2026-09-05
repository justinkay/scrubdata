# Scrub Data: A Framework for Reproducible Data Curation with AI Coding Agents

<p align="center">
<!-- <img width="1672" height="941" alt="scrubdatalogo" src="https://github.com/user-attachments/assets/6cbe85f4-746e-4041-a711-4a3b961dab4d" /> -->
<img width="650" alt="A logo for Scrub Data. It is a parody of the Scrub Daddy logo." src="https://github.com/user-attachments/assets/6cbe85f4-746e-4041-a711-4a3b961dab4d" />
</p>

**What is data curation?** Data curation involves collecting, cleaning, and joining raw data sources to a common format. Most real-world machine learning or data science projects involve data curation to some extent in order to get data ready for analysis.

**What are AI coding agents?** Agents like Codex, Claude Code, or Opencode wrap an LLM and allow it to execute _tool calls_: in addition to writing code, the LLM can invoke external programs a like a command-line interface or Python interpreter, giving it the ability to take actions on the user's behalf.

**Why did we create this repo?** We have been experimenting with using agents for data cleaning and curation, and they are pretty great. It is very quick to write a script that, for example, reads in a raw data file, parses and visualizes its contents, and makes modifications according to a natural language prompt. There are risks, however---because agents can modify files themselves, it may be impossible to trace or reproduce all the changes that they make. So we came up with a framework that adds a layer of reproducibility to data curation with coding agents. It works like this:

<p align="center">
<img width="85%" alt="scrubdata" src="https://github.com/user-attachments/assets/06b2b62e-04da-4b35-9f0d-eecd24d94a5f" />
</p>

Users interact with an AI agent to iteratively execute data curation operations and develop graphical interfaces to validate their changes (left). Dataset modifications are recorded in an executable data provenance graph, maintaining the full version history in a reproducible manner (right). These components are tied together by a lightweight web framework and REST API that separates agents and raw data, ensuring that the data graph remains well-formed while providing easy access patterns to frontend interfaces (center). Altogether, we call this framework Scrub Data.

# How to use it

Scrub Data is a small scaffold for local data apps backed by a reproducible dataset DAG.

The Scrub Data framework is implemented as a lightweight web application that is _designed to be modified by AI agents_ in response to user requests. This is an important design decision that is unique to agentic workflows—--the software itself is malleable and is meant to be customized by each individual user to suit their needs. You will clone this repository, and ask the agent to help you customize it in real time according to your visualization and curation needs.

Agents can perform data modifications, but are instructed to do so by submitting executable transformations through the API. The agents gather this context upon initialization so you don't have to worry about giving them instructions. Submitted transformations are logged in a directed acyclic graph that represents the full version history of a project and can be easily be used to reproduce any previous version of the dataset.

To begin working with the codebase: 

0. Clone this repository.
1. Put your raw data files in `data/<project>/`.
2. Launch an agent instance from your terminal from inside the codebase, for example by running `codex`, `claude code`, or `opencode`.
3. Launch the web application from another terminal window with `python server.py`, and direct your browser to the appropriate port on `localhost` (5420 by default).
4. Ask your agent to extend the starter app in `server.py` and `static/` according to your needs.

See `examples/trajectory/` for a reference starter app built for animal movement (GPS) data.

Repository layout:

```text
app/                  generic lineage, execution, preview, and HTTP internals
server.py             default starter app server
static/               default starter app frontend
examples/trajectory/  richer reference app
data/<project>/       project inputs plus scrubdata state
docs/                 minimal contracts for agents
```

These contracts provide instructions for how the agent should behave and what actions it should take:

- [AGENTS.md](/Users/justinkay/scrubdata/AGENTS.md)
- [docs/ARCHITECTURE.md](/Users/justinkay/scrubdata/docs/ARCHITECTURE.md)
- [docs/STATE_MODEL.md](/Users/justinkay/scrubdata/docs/STATE_MODEL.md)
- [docs/EXECUTION_CONTRACT.md](/Users/justinkay/scrubdata/docs/EXECUTION_CONTRACT.md)
