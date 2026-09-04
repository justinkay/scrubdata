const BASEMAP_STYLES = {
  Positron: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  Voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  "Dark Matter": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

const PATH_ALPHA = 180;
const POINT_ALPHA = 210;
const STORAGE_VERSION = 2;

let assetPromise = null;

async function ensureAssetsLoaded() {
  if (assetPromise) {
    return assetPromise;
  }
  assetPromise = Promise.all([
    loadCss("/static/vendor/maplibre-gl/maplibre-gl.css"),
    loadScript("/static/vendor/maplibre-gl/maplibre-gl.js"),
    loadScript("/static/vendor/deckgl/deck.gl.min.js"),
    loadScript("/static/vendor/deckgl/deck.gl-mapbox.min.js"),
  ]);
  return assetPromise;
}

function loadCss(href) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[data-scrubdata-asset="${href}"]`);
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.scrubdataAsset = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-scrubdata-asset="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.scrubdataAsset = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

class TrajectoryExampleApp {
  constructor({ mountEl, storageKey, fetchJSON, requestJSON }) {
    this.mountEl = mountEl;
    this.storageKey = storageKey;
    this.fetchJSON = fetchJSON;
    this.requestJSON = requestJSON;
    this.uiState = this.loadUiState();
    this.projects = [];
    this.graph = null;
    this.allDatasets = [];
    this.datasets = [];
    this.stepByOutputDatasetId = new Map();
    this.currentProject = "";
    this.currentDatasetId = "";
    this.currentArtifact = "";
    this.currentDataset = null;
    this.currentArtifactEntry = null;
    this.data = null;
    this.currentTimeMs = 0;
    this.map = null;
    this.overlay = null;
    this.mapLoaded = false;
    this.loadRequestId = 0;
  }

  async init() {
    await ensureAssetsLoaded();
    this.renderShell();
    this.bindEvents();
    await this.loadProjects();
  }

  async destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.overlay = null;
      this.mapLoaded = false;
    }
  }

  loadUiState() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        throw new Error("missing");
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORAGE_VERSION) {
        throw new Error("stale");
      }
      return parsed;
    } catch {
      return {
        version: STORAGE_VERSION,
        project: "",
        datasetId: "",
        artifact: "",
        basemap: "Positron",
        showTrain: true,
        showTest: true,
        showPoints: false,
        selectedIndividuals: [],
      };
    }
  }

  saveUiState() {
    this.uiState = {
      version: STORAGE_VERSION,
      project: this.currentProject,
      datasetId: this.currentDatasetId,
      artifact: this.currentArtifact,
      basemap: this.refs.basemap.value,
      showTrain: this.refs.showTrain.checked,
      showTest: this.refs.showTest.checked,
      showPoints: this.refs.showPoints.checked,
      selectedIndividuals: this.getCheckedIndividuals(),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(this.uiState));
  }

  getUser() {
    return localStorage.getItem("scrubdata_user_name") || "";
  }

  setUser(user) {
    localStorage.setItem("scrubdata_user_name", user);
  }

  renderShell() {
    this.mountEl.innerHTML = `
      <style>
        .traj-root {
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
          height: 100%;
          min-height: 0;
          color: #e5edf7;
          font-family: "Segoe UI", sans-serif;
          background: linear-gradient(180deg, rgba(8, 17, 27, 0.96), rgba(5, 10, 18, 0.98));
        }
        .traj-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 14px;
          align-items: center;
          padding: 14px 16px 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(8, 17, 27, 0.8);
        }
        .traj-toolbar label,
        .traj-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #92a4bd;
        }
        .traj-toolbar select,
        .traj-toolbar button,
        .traj-modal input,
        .traj-modal textarea {
          font: inherit;
        }
        .traj-toolbar select,
        .traj-modal input,
        .traj-modal textarea {
          min-width: 150px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(15, 23, 42, 0.92);
          color: #e5edf7;
        }
        .traj-toolbar button,
        .traj-modal button {
          padding: 8px 12px;
          border: none;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.08);
          color: #e5edf7;
          cursor: pointer;
          font-size: 14px;
          white-space: nowrap;
        }
        .traj-toolbar button.traj-danger,
        .traj-modal button.traj-danger {
          background: rgba(220, 38, 38, 0.22);
          color: #ffe4e8;
        }
        .traj-toolbar button:disabled,
        .traj-modal button:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .traj-status {
          min-height: 24px;
          padding: 0 16px 10px;
          font-size: 12px;
          color: #92a4bd;
        }
        .traj-status.error,
        .traj-modal-status.error {
          color: #ffb3c2;
        }
        .traj-main {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
          gap: 12px;
          min-height: 0;
          padding: 0 16px 14px;
        }
        .traj-map-wrap,
        .traj-side {
          min-height: 0;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.03);
        }
        .traj-map-wrap {
          position: relative;
          background: #08111b;
        }
        .traj-map {
          width: 100%;
          height: 100%;
        }
        .traj-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          text-align: center;
          color: #d6deea;
          background: linear-gradient(180deg, rgba(8, 17, 27, 0.18), rgba(8, 17, 27, 0.8));
        }
        .traj-overlay.hidden {
          display: none;
        }
        .traj-overlay-card {
          max-width: 520px;
          padding: 18px 20px;
          border-radius: 16px;
          background: rgba(7, 11, 22, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .traj-overlay-card h3 {
          font-size: 16px;
          margin-bottom: 8px;
        }
        .traj-overlay-card p {
          font-size: 13px;
          line-height: 1.5;
        }
        .traj-side {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
        }
        .traj-side-head,
        .traj-slider-row {
          padding: 12px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .traj-side-head {
          font-size: 12px;
          color: #92a4bd;
        }
        .traj-individuals {
          overflow-y: auto;
          padding: 10px 12px;
        }
        .traj-individual {
          display: grid;
          gap: 6px;
          padding: 10px 12px;
          margin-bottom: 10px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.05);
          cursor: pointer;
        }
        .traj-name {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 12px;
          color: #eef4fb;
        }
        .traj-name-left {
          display: flex;
          gap: 8px;
          align-items: center;
          min-width: 0;
        }
        .traj-name-left input {
          margin: 0;
        }
        .traj-name-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .traj-name-species {
          color: #92a4bd;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .traj-species {
          font-size: 11px;
          color: #92a4bd;
        }
        .traj-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11px;
          color: #92a4bd;
        }
        .traj-track {
          position: relative;
          height: 10px;
          width: 100%;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          overflow: hidden;
        }
        .traj-bar {
          position: absolute;
          top: 0;
          height: 100%;
          border-radius: 999px;
        }
        .traj-slider-row {
          display: grid;
          gap: 10px;
          border-bottom: none;
        }
        .traj-slider {
          width: 100%;
        }
        .traj-time {
          font-size: 12px;
          color: #dbe5f0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .traj-modal {
          position: fixed;
          inset: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(2, 6, 12, 0.72);
          backdrop-filter: blur(8px);
        }
        .traj-modal.hidden {
          display: none;
        }
        .traj-modal-card {
          width: min(560px, 100%);
          border-radius: 18px;
          overflow: hidden;
          background: rgba(7, 11, 22, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
        }
        .traj-modal-head,
        .traj-modal-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .traj-modal-foot {
          border-bottom: none;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .traj-modal-body {
          display: grid;
          gap: 14px;
          padding: 16px;
        }
        .traj-modal-body label {
          display: grid;
          gap: 6px;
          font-size: 12px;
          color: #92a4bd;
        }
        .traj-modal textarea {
          min-height: 88px;
          resize: vertical;
        }
        .traj-selection-list {
          max-height: 140px;
          overflow: auto;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 12px;
          color: #dbe4ef;
          line-height: 1.5;
        }
        .traj-modal-status {
          font-size: 12px;
          color: #92a4bd;
        }
        @media (max-width: 980px) {
          .traj-main {
            grid-template-columns: 1fr;
            grid-template-rows: minmax(280px, 1fr) minmax(260px, 0.9fr);
          }
        }
      </style>
      <div class="traj-root">
        <div class="traj-toolbar">
          <label>Project <select data-role="project"></select></label>
          <label>Version <select data-role="dataset"></select></label>
          <label>Artifact <select data-role="artifact"></select></label>
          <label>Basemap <select data-role="basemap"></select></label>
          <label class="traj-toggle"><input type="checkbox" data-role="show-train"> Train</label>
          <label class="traj-toggle"><input type="checkbox" data-role="show-test"> Test</label>
          <label class="traj-toggle"><input type="checkbox" data-role="show-points"> Points</label>
          <button type="button" data-role="select-all">All</button>
          <button type="button" data-role="select-none">None</button>
          <button type="button" data-role="reset-view">Reset view</button>
          <button type="button" class="traj-danger" data-role="delete-checked">Delete checked</button>
          <button type="button" data-role="undo">Undo</button>
        </div>
        <div class="traj-status" data-role="status"></div>
        <div class="traj-main">
          <div class="traj-map-wrap">
            <div class="traj-map" data-role="map"></div>
            <div class="traj-overlay" data-role="overlay">
              <div class="traj-overlay-card">
                <h3>Example: Trajectories</h3>
                <p>This app keeps the original navigable map, scrollable individual list, and timeline slider while routing summary and mutation work through the trajectory example backend.</p>
              </div>
            </div>
          </div>
          <div class="traj-side">
            <div class="traj-side-head">Individuals and coverage</div>
            <div class="traj-individuals" data-role="individuals"></div>
            <div class="traj-slider-row">
              <input class="traj-slider" data-role="slider" type="range" min="0" max="0" value="0" step="1">
              <div class="traj-time" data-role="time"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="traj-modal hidden" data-role="delete-modal">
        <div class="traj-modal-card">
          <div class="traj-modal-head">
            <h3>Delete checked individuals</h3>
            <button type="button" data-role="delete-close">Close</button>
          </div>
          <div class="traj-modal-body">
            <div data-role="delete-meta"></div>
            <div class="traj-selection-list" data-role="delete-selection"></div>
            <label>User
              <input type="text" data-role="delete-user" placeholder="Name used for attribution">
            </label>
            <label>Reason
              <textarea data-role="delete-reason" placeholder="Why are you removing these individuals?"></textarea>
            </label>
            <div class="traj-modal-status" data-role="delete-status"></div>
          </div>
          <div class="traj-modal-foot">
            <span></span>
            <button type="button" class="traj-danger" data-role="delete-submit">Create step</button>
          </div>
        </div>
      </div>
    `;

    this.refs = {
      project: this.mountEl.querySelector('[data-role="project"]'),
      dataset: this.mountEl.querySelector('[data-role="dataset"]'),
      artifact: this.mountEl.querySelector('[data-role="artifact"]'),
      basemap: this.mountEl.querySelector('[data-role="basemap"]'),
      showTrain: this.mountEl.querySelector('[data-role="show-train"]'),
      showTest: this.mountEl.querySelector('[data-role="show-test"]'),
      showPoints: this.mountEl.querySelector('[data-role="show-points"]'),
      selectAll: this.mountEl.querySelector('[data-role="select-all"]'),
      selectNone: this.mountEl.querySelector('[data-role="select-none"]'),
      resetView: this.mountEl.querySelector('[data-role="reset-view"]'),
      undo: this.mountEl.querySelector('[data-role="undo"]'),
      deleteChecked: this.mountEl.querySelector('[data-role="delete-checked"]'),
      status: this.mountEl.querySelector('[data-role="status"]'),
      individuals: this.mountEl.querySelector('[data-role="individuals"]'),
      slider: this.mountEl.querySelector('[data-role="slider"]'),
      time: this.mountEl.querySelector('[data-role="time"]'),
      map: this.mountEl.querySelector('[data-role="map"]'),
      overlay: this.mountEl.querySelector('[data-role="overlay"]'),
      deleteModal: this.mountEl.querySelector('[data-role="delete-modal"]'),
      deleteMeta: this.mountEl.querySelector('[data-role="delete-meta"]'),
      deleteSelection: this.mountEl.querySelector('[data-role="delete-selection"]'),
      deleteUser: this.mountEl.querySelector('[data-role="delete-user"]'),
      deleteReason: this.mountEl.querySelector('[data-role="delete-reason"]'),
      deleteStatus: this.mountEl.querySelector('[data-role="delete-status"]'),
      deleteClose: this.mountEl.querySelector('[data-role="delete-close"]'),
      deleteSubmit: this.mountEl.querySelector('[data-role="delete-submit"]'),
    };

    for (const name of Object.keys(BASEMAP_STYLES)) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      this.refs.basemap.appendChild(option);
    }
    this.refs.basemap.value = this.uiState.basemap || "Positron";
    this.refs.showTrain.checked = this.uiState.showTrain !== false;
    this.refs.showTest.checked = this.uiState.showTest !== false;
    this.refs.showPoints.checked = this.uiState.showPoints === true;
    this.updateActionButtons();
  }

  bindEvents() {
    this.refs.project.addEventListener("change", async () => {
      this.currentProject = this.refs.project.value;
      await this.loadProject();
    });

    this.refs.dataset.addEventListener("change", async () => {
      this.currentDatasetId = this.refs.dataset.value;
      await this.loadDataset();
    });

    this.refs.artifact.addEventListener("change", async () => {
      this.currentArtifact = this.refs.artifact.value;
      this.refreshDatasetOptions(this.currentDatasetId);
      await this.loadArtifact();
    });

    this.refs.basemap.addEventListener("change", async () => {
      this.saveUiState();
      await this.rebuildMap(true);
    });

    this.refs.showTrain.addEventListener("change", () => this.handleVisibilityChange());
    this.refs.showTest.addEventListener("change", () => this.handleVisibilityChange());
    this.refs.showPoints.addEventListener("change", () => {
      this.saveUiState();
      this.renderLayers();
    });

    this.refs.selectAll.addEventListener("click", () => {
      if (!this.data) return;
      this.data.selectedIndividuals = new Set(this.data.individuals);
      this.saveUiState();
      this.renderIndividuals();
      this.renderLayers();
      this.updateActionButtons();
    });

    this.refs.selectNone.addEventListener("click", () => {
      if (!this.data) return;
      this.data.selectedIndividuals = new Set();
      this.saveUiState();
      this.renderIndividuals();
      this.renderLayers();
      this.updateActionButtons();
    });

    this.refs.resetView.addEventListener("click", () => this.resetView());
    this.refs.undo.addEventListener("click", async () => {
      await this.undoCurrentHead();
    });
    this.refs.deleteChecked.addEventListener("click", () => this.openDeleteModal());
    this.refs.slider.addEventListener("input", () => {
      this.currentTimeMs = Number(this.refs.slider.value) || 0;
      this.updateTimeLabel();
      this.renderLayers();
    });

    this.refs.deleteClose.addEventListener("click", () => this.closeDeleteModal());
    this.refs.deleteSubmit.addEventListener("click", async () => {
      await this.submitDeleteChecked();
    });
    this.refs.deleteModal.addEventListener("click", event => {
      if (event.target === this.refs.deleteModal) {
        this.closeDeleteModal();
      }
    });
  }

  handleVisibilityChange() {
    this.saveUiState();
    this.renderLayers();
    this.renderIndividuals();
  }

  async loadProjects() {
    this.setStatus("Loading projects...");
    let payload;
    try {
      payload = await this.fetchJSON("/api/projects");
    } catch (error) {
      this.setStatus(error.message, true);
      this.showOverlay("The project index could not be loaded.");
      return;
    }
    this.projects = Array.isArray(payload.projects) ? payload.projects : [];
    this.refs.project.innerHTML = "";
    for (const project of this.projects) {
      const option = document.createElement("option");
      option.value = project.name;
      option.textContent = project.name;
      this.refs.project.appendChild(option);
    }
    if (!this.projects.length) {
      this.showOverlay("No projects were found under data/{project}/.");
      this.setStatus("No projects found.", true);
      return;
    }
    const storedProject = this.uiState.project;
    this.currentProject = this.projects.some(project => project.name === storedProject)
      ? storedProject
      : this.projects[0].name;
    this.refs.project.value = this.currentProject;
    await this.loadProject();
  }

  async loadProject() {
    this.setStatus(`Loading graph for ${this.currentProject}...`);
    try {
      const [state, graph] = await Promise.all([
        this.fetchJSON(`/api/project/${encodeURIComponent(this.currentProject)}/state`),
        this.fetchJSON(`/api/project/${encodeURIComponent(this.currentProject)}/graph`),
      ]);
      this.graph = graph;
      this.allDatasets = [...(Array.isArray(graph.datasets) ? graph.datasets : [])]
        .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
      this.stepByOutputDatasetId = new Map(
        (Array.isArray(graph.steps) ? graph.steps : []).map(step => [step.output_dataset_id, step]),
      );
      const storedDataset = this.uiState.project === this.currentProject ? this.uiState.datasetId : "";
      const preferredDataset = this.allDatasets.some(dataset => dataset.dataset_id === this.currentDatasetId)
        ? this.currentDatasetId
        : "";
      this.refreshDatasetOptions(preferredDataset || (
        this.allDatasets.some(dataset => dataset.dataset_id === storedDataset)
          ? storedDataset
          : state.current_dataset.dataset_id
      ));
      await this.loadDataset();
    } catch (error) {
      this.setStatus(error.message, true);
      this.showOverlay(`Could not load ${this.currentProject}.`);
    }
  }

  refreshDatasetOptions(preferredDatasetId = this.currentDatasetId) {
    this.datasets = this.filteredDatasets(preferredDatasetId);
    this.refs.dataset.innerHTML = "";
    for (const dataset of this.datasets) {
      const option = document.createElement("option");
      option.value = dataset.dataset_id;
      option.textContent = formatDatasetLabel(dataset, this.graph?.current_dataset_id || "");
      this.refs.dataset.appendChild(option);
    }
    if (!this.datasets.length) {
      this.currentDatasetId = "";
      return;
    }
    const nextDatasetId = this.datasets.some(dataset => dataset.dataset_id === preferredDatasetId)
      ? preferredDatasetId
      : this.datasets[0].dataset_id;
    this.currentDatasetId = nextDatasetId;
    this.refs.dataset.value = nextDatasetId;
  }

  filteredDatasets(preferredDatasetId) {
    if (!this.currentArtifact) {
      return [...this.allDatasets];
    }
    return this.allDatasets.filter(dataset => this.datasetMatchesCurrentArtifact(dataset, preferredDatasetId));
  }

  datasetMatchesCurrentArtifact(dataset, preferredDatasetId) {
    if (!dataset) {
      return false;
    }
    if (!Array.isArray(dataset.artifact_names)) {
      return true;
    }
    const hasArtifact = dataset.artifact_names.includes(this.currentArtifact);
    if (!hasArtifact) {
      return false;
    }
    if (dataset.dataset_id === preferredDatasetId) {
      return true;
    }
    const producingStep = this.stepByOutputDatasetId.get(dataset.dataset_id);
    if (!producingStep) {
      return true;
    }
    return stepTouchesArtifact(producingStep, this.currentArtifact);
  }

  async loadDataset() {
    this.data = null;
    this.currentDataset = null;
    this.currentArtifactEntry = null;
    this.refs.individuals.innerHTML = "";
    this.renderLayers();
    this.updateActionButtons();
    this.setStatus(`Loading dataset ${this.currentDatasetId}...`);
    try {
      this.currentDataset = await this.fetchJSON(
        `/api/project/${encodeURIComponent(this.currentProject)}/dataset/${encodeURIComponent(this.currentDatasetId)}`,
      );
      this.updateActionButtons();
    } catch (error) {
      this.setStatus(error.message, true);
      this.showOverlay(`Could not load dataset ${this.currentDatasetId}.`);
      return;
    }
    const artifacts = Array.isArray(this.currentDataset.artifacts) ? this.currentDataset.artifacts : [];
    this.refs.artifact.innerHTML = "";
    for (const artifact of artifacts) {
      const option = document.createElement("option");
      option.value = artifact.logical_name;
      option.textContent = artifact.logical_name;
      this.refs.artifact.appendChild(option);
    }
    if (!artifacts.length) {
      this.currentArtifact = "";
      this.updateActionButtons();
      this.showOverlay(`Dataset ${this.currentDatasetId} does not contain artifacts.`);
      this.setStatus("Selected dataset has no artifacts.", true);
      return;
    }
    const storedArtifact =
      this.uiState.project === this.currentProject && this.uiState.datasetId === this.currentDatasetId
        ? this.uiState.artifact
        : "";
    this.currentArtifact = artifacts.some(artifact => artifact.logical_name === storedArtifact)
      ? storedArtifact
      : artifacts[0].logical_name;
    this.refs.artifact.value = this.currentArtifact;
    this.refreshDatasetOptions(this.currentDatasetId);
    await this.loadArtifact();
  }

  async loadArtifact() {
    const requestId = ++this.loadRequestId;
    this.currentArtifactEntry = (this.currentDataset?.artifacts || []).find(
      artifact => artifact.logical_name === this.currentArtifact,
    ) || null;
    if (!this.currentArtifactEntry) {
      return;
    }
    this.saveUiState();
    this.setStatus(`Loading ${this.currentArtifact} from ${this.currentDatasetId}...`);
    try {
      const summary = await this.fetchJSON(
        `/api/project/${encodeURIComponent(this.currentProject)}/apps/trajectory/dataset/${encodeURIComponent(this.currentDatasetId)}/summary?${new URLSearchParams({ logical_name: this.currentArtifact }).toString()}`,
      );
      if (requestId !== this.loadRequestId) {
        return;
      }
      this.data = buildDatasetFromSummary(summary);
      this.currentTimeMs = this.data.minTimeMs;
      this.refs.slider.min = String(this.data.minTimeMs);
      this.refs.slider.max = String(this.data.maxTimeMs);
      this.refs.slider.value = String(this.currentTimeMs);
      this.data.selectedIndividuals = new Set(this.data.individuals);

      this.renderIndividuals();
      this.updateTimeLabel();
      this.hideOverlay();
      await this.rebuildMap(false);
      this.resetView();
      this.updateActionButtons();
      this.setStatus(
        `Loaded ${formatCount(this.data.totalRows)} fixes across ${formatCount(this.data.individuals.length)} individuals from ${this.currentArtifact}.`,
      );
    } catch (error) {
      if (requestId !== this.loadRequestId) {
        return;
      }
      this.data = null;
      this.renderIndividuals();
      this.renderLayers();
      this.updateActionButtons();
      this.setStatus(error.message, true);
      this.showOverlay(`Could not render ${this.currentArtifact}.`);
    }
  }

  renderIndividuals() {
    this.refs.individuals.innerHTML = "";
    if (!this.data) {
      return;
    }
    for (const individual of this.data.individuals) {
      const stats = this.data.stats[individual];
      const coverage = this.data.coverageByIndividual[individual] || {};
      const isSelected = this.data.selectedIndividuals.has(individual);
      const card = document.createElement("div");
      card.className = "traj-individual";
      card.style.opacity = isSelected ? "1" : "0.34";

      const header = htmlElement(`
        <div class="traj-name">
          <div class="traj-name-left">
            <input type="checkbox" ${isSelected ? "checked" : ""}>
            <span class="traj-name-label">${escapeHtml(individual)}</span>
            ${this.data.speciesByIndividual[individual] ? `<span class="traj-name-species">• ${escapeHtml(this.data.speciesByIndividual[individual])}</span>` : ""}
          </div>
          <span>${escapeHtml(formatCount(stats.rowCount))}</span>
        </div>
      `);
      const checkbox = header.querySelector("input");
      const applySelection = shouldSelect => {
        if (!this.data) return;
        if (shouldSelect) {
          this.data.selectedIndividuals.add(individual);
        } else {
          this.data.selectedIndividuals.delete(individual);
        }
        this.saveUiState();
        this.renderIndividuals();
        this.renderLayers();
        this.updateActionButtons();
      };
      checkbox.addEventListener("click", event => {
        event.stopPropagation();
      });
      checkbox.addEventListener("change", () => {
        applySelection(checkbox.checked);
      });
      card.appendChild(header);
      card.appendChild(htmlElement(`
        <div class="traj-stats">
          <span>median fix ${escapeHtml(formatDuration(stats.medianFixS))}</span>
          <span>median step ${escapeHtml(formatMaybeNumber(stats.medianStepM, "m"))}</span>
          <span>q95 step ${escapeHtml(formatMaybeNumber(stats.p95StepM, "m"))}</span>
        </div>
      `));
      const track = document.createElement("div");
      track.className = "traj-track";
      for (const setName of visibleSets(this.refs.showTrain.checked, this.refs.showTest.checked)) {
        const bar = coverage[setName];
        if (!bar) {
          continue;
        }
        const bounds = rangeToPercent(this.data.minTimeMs, this.data.maxTimeMs, bar.startMs, bar.endMs);
        const el = document.createElement("div");
        el.className = "traj-bar";
        el.style.left = `${bounds.left}%`;
        el.style.width = `${bounds.width}%`;
        el.style.background = colorCss(this.data.palette[individual], setName, isSelected ? 0.88 : 0.25);
        track.appendChild(el);
      }
      card.appendChild(track);
      card.addEventListener("click", () => {
        applySelection(!isSelected);
      });
      this.refs.individuals.appendChild(card);
    }
  }

  async rebuildMap(forceStyleReload) {
    if (!this.data) {
      this.renderLayers();
      return;
    }
    const style = BASEMAP_STYLES[this.refs.basemap.value] || BASEMAP_STYLES.Positron;
    if (!this.map) {
      this.map = new maplibregl.Map({
        container: this.refs.map,
        style,
        center: [this.data.initialView.longitude, this.data.initialView.latitude],
        zoom: this.data.initialView.zoom,
        attributionControl: false,
      });
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      this.map.on("load", () => {
        this.mapLoaded = true;
        this.renderLayers();
      });
      this.overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
      this.map.addControl(this.overlay);
      return;
    }
    if (forceStyleReload) {
      this.mapLoaded = false;
      this.map.setStyle(style);
      this.map.once("style.load", () => {
        this.mapLoaded = true;
        this.renderLayers();
      });
      return;
    }
    this.renderLayers();
  }

  renderLayers() {
    if (!this.data || !this.mapLoaded || !this.overlay) {
      if (this.overlay) {
        this.overlay.setProps({ layers: [] });
      }
      return;
    }
    const pathData = [];
    const pointData = [];
    const cursorData = [];
    const visibleIndividuals = this.data.individuals.filter(individual => this.data.selectedIndividuals.has(individual));
    for (const individual of visibleIndividuals) {
      for (const setName of visibleSets(this.refs.showTrain.checked, this.refs.showTest.checked)) {
        const series = this.data.seriesByIndividual[individual]?.[setName];
        if (!series) {
          continue;
        }
        if (series.positions.length >= 2) {
          pathData.push({
            individual,
            setName,
            path: series.positions,
            color: splitColor(this.data.palette[individual], setName, PATH_ALPHA),
          });
        }
        if (this.refs.showPoints.checked) {
          pointData.push(...series.positions.map(position => ({
            individual,
            setName,
            position,
            color: splitColor(this.data.palette[individual], setName, POINT_ALPHA),
          })));
        }
        const cursorPosition = interpolateSeriesPosition(series, this.currentTimeMs);
        if (cursorPosition) {
          cursorData.push({
            individual,
            setName,
            position: cursorPosition,
          });
        }
      }
    }

    const layers = [
      new deck.PathLayer({
        id: "trajectory-paths",
        data: pathData,
        getPath: item => item.path,
        getColor: item => item.color,
        getWidth: 3,
        widthMinPixels: 2,
        pickable: false,
      }),
    ];

    if (this.refs.showPoints.checked) {
      layers.push(
        new deck.ScatterplotLayer({
          id: "trajectory-points",
          data: pointData,
          getPosition: item => item.position,
          getFillColor: item => item.color,
          getRadius: 36,
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          pickable: false,
        }),
      );
    }

    if (cursorData.length) {
      layers.push(
        new deck.ScatterplotLayer({
          id: "trajectory-cursor",
          data: cursorData,
          getPosition: item => item.position,
          getFillColor: [12, 12, 12, 255],
          getLineColor: [255, 255, 255, 235],
          getRadius: 64,
          radiusMinPixels: 4,
          radiusMaxPixels: 8,
          lineWidthMinPixels: 1.5,
          stroked: true,
          filled: true,
          pickable: false,
        }),
      );
    }
    this.overlay.setProps({ layers });
  }

  resetView() {
    if (!this.data || !this.map) {
      return;
    }
    this.map.jumpTo({
      center: [this.data.initialView.longitude, this.data.initialView.latitude],
      zoom: this.data.initialView.zoom,
      bearing: 0,
      pitch: 0,
    });
  }

  updateTimeLabel() {
    if (!this.data) {
      this.refs.time.textContent = "No timestamps";
      return;
    }
    this.refs.time.textContent = formatTimestamp(this.currentTimeMs);
  }

  getCheckedIndividuals() {
    if (!this.data || !(this.data.selectedIndividuals instanceof Set)) {
      return [];
    }
    return Array.from(this.data.selectedIndividuals).sort((left, right) => left.localeCompare(right));
  }

  updateActionButtons() {
    this.updateDeleteButton();
    this.updateUndoButton();
  }

  updateDeleteButton() {
    this.refs.deleteChecked.disabled = !this.data || this.getCheckedIndividuals().length === 0;
  }

  updateUndoButton() {
    const currentHeadDatasetId = this.graph?.current_dataset_id || "";
    const selectedIsCurrentHead = Boolean(currentHeadDatasetId) && this.currentDatasetId === currentHeadDatasetId;
    const canUndo = selectedIsCurrentHead && Boolean(this.currentDataset?.parent_dataset_id);
    this.refs.undo.disabled = !canUndo;
    if (!currentHeadDatasetId) {
      this.refs.undo.title = "Undo is available after a project version is loaded.";
      return;
    }
    if (!selectedIsCurrentHead) {
      this.refs.undo.title = "Undo applies to the current head version.";
      return;
    }
    if (!this.currentDataset?.parent_dataset_id) {
      this.refs.undo.title = "Current head has no parent dataset.";
      return;
    }
    this.refs.undo.title = "Undo to the parent dataset.";
  }

  async loadProjectAtDataset(datasetId) {
    this.currentDatasetId = datasetId;
    await this.loadProject();
  }

  openDeleteModal() {
    const checkedIndividuals = this.getCheckedIndividuals();
    if (!checkedIndividuals.length || !this.currentArtifact) {
      return;
    }
    this.refs.deleteMeta.innerHTML = `
      <div><strong>Project:</strong> ${escapeHtml(this.currentProject)}</div>
      <div><strong>Dataset:</strong> ${escapeHtml(this.currentDatasetId)}</div>
      <div><strong>Artifact:</strong> ${escapeHtml(this.currentArtifact)}</div>
      <div><strong>Checked:</strong> ${escapeHtml(formatCount(checkedIndividuals.length))} individual(s)</div>
    `;
    this.refs.deleteSelection.textContent = checkedIndividuals.join(", ");
    this.refs.deleteUser.value = this.getUser();
    this.refs.deleteReason.value = "";
    this.refs.deleteStatus.textContent = "";
    this.refs.deleteStatus.classList.remove("error");
    this.refs.deleteSubmit.disabled = false;
    this.refs.deleteClose.disabled = false;
    this.refs.deleteModal.classList.remove("hidden");
    this.refs.deleteReason.focus();
  }

  closeDeleteModal(force = false) {
    if (!force && this.refs.deleteSubmit.disabled) {
      return;
    }
    this.refs.deleteModal.classList.add("hidden");
    this.refs.deleteStatus.textContent = "";
    this.refs.deleteStatus.classList.remove("error");
  }

  async submitDeleteChecked() {
    const checkedIndividuals = this.getCheckedIndividuals();
    const user = this.refs.deleteUser.value.trim();
    const reason = this.refs.deleteReason.value.trim();
    if (!checkedIndividuals.length) {
      return;
    }
    if (!user) {
      this.refs.deleteStatus.textContent = "Attribution is required.";
      this.refs.deleteStatus.classList.add("error");
      this.refs.deleteUser.focus();
      return;
    }
    if (!reason) {
      this.refs.deleteStatus.textContent = "Reason is required.";
      this.refs.deleteStatus.classList.add("error");
      this.refs.deleteReason.focus();
      return;
    }

    this.refs.deleteSubmit.disabled = true;
    this.refs.deleteClose.disabled = true;
    this.refs.deleteStatus.textContent = `Deleting ${formatCount(checkedIndividuals.length)} checked individual(s)...`;
    this.refs.deleteStatus.classList.remove("error");
    this.setStatus(this.refs.deleteStatus.textContent);

    try {
      const result = await this.requestJSON(
        `/api/project/${encodeURIComponent(this.currentProject)}/apps/trajectory/actions/delete-checked`,
        {
          method: "POST",
          body: JSON.stringify({
            dataset_id: this.currentDatasetId,
            logical_name: this.currentArtifact,
            individuals: checkedIndividuals,
            user,
            reason,
          }),
        },
      );
      this.setUser(user);
      this.closeDeleteModal(true);
      await this.loadProjectAtDataset(result.dataset.dataset_id);
      this.setStatus(`Created ${result.step.title} in ${result.dataset.dataset_id}.`);
    } catch (error) {
      this.refs.deleteStatus.textContent = error.message;
      this.refs.deleteStatus.classList.add("error");
      this.refs.deleteSubmit.disabled = false;
      this.refs.deleteClose.disabled = false;
      this.setStatus(error.message, true);
    }
  }

  async undoCurrentHead() {
    if (this.refs.undo.disabled) {
      return;
    }

    this.refs.undo.disabled = true;
    this.setStatus(`Undoing ${this.currentDatasetId}...`);

    try {
      const result = await this.requestJSON(
        `/api/project/${encodeURIComponent(this.currentProject)}/undo`,
        { method: "POST" },
      );
      await this.loadProjectAtDataset(result.dataset.dataset_id);
      this.setStatus(`Undid to ${result.dataset.dataset_id}.`);
    } catch (error) {
      this.setStatus(error.message, true);
      this.updateUndoButton();
    }
  }

  setStatus(message, isError = false) {
    this.refs.status.textContent = message;
    this.refs.status.classList.toggle("error", isError);
  }

  showOverlay(message) {
    this.refs.overlay.classList.remove("hidden");
    this.refs.overlay.querySelector("p").textContent = message;
  }

  hideOverlay() {
    this.refs.overlay.classList.add("hidden");
  }
}

function buildDatasetFromSummary(summary) {
  const individuals = Array.isArray(summary.individuals)
    ? [...summary.individuals].sort((left, right) => left.localeCompare(right))
    : [];
  if (!individuals.length) {
    throw new Error("Dataset summary did not contain any individuals.");
  }

  const seriesByIndividual = {};
  const coverageByIndividual = {};
  const stats = {};
  const palette = {};

  Object.entries(summary.series_by_individual || {}).forEach(([individual, sets]) => {
    seriesByIndividual[individual] = {};
    Object.entries(sets || {}).forEach(([setName, series]) => {
      seriesByIndividual[individual][setName] = {
        times: Array.isArray(series?.times) ? series.times.map(value => Number(value) || 0) : [],
        positions: Array.isArray(series?.positions)
          ? series.positions.map(position => [Number(position?.[0]) || 0, Number(position?.[1]) || 0])
          : [],
      };
    });
  });

  Object.entries(summary.coverage_by_individual || {}).forEach(([individual, sets]) => {
    coverageByIndividual[individual] = {};
    Object.entries(sets || {}).forEach(([setName, coverage]) => {
      coverageByIndividual[individual][setName] = {
        startMs: Number(coverage?.start_ms) || 0,
        endMs: Number(coverage?.end_ms) || 0,
      };
    });
  });

  Object.entries(summary.stats || {}).forEach(([individual, item]) => {
    stats[individual] = {
      rowCount: Number(item?.row_count) || 0,
      medianFixS: finiteOrNull(item?.median_fix_s),
      medianStepM: finiteOrNull(item?.median_step_m),
      p95StepM: finiteOrNull(item?.p95_step_m),
    };
  });

  individuals.forEach((individual, index) => {
    if (!stats[individual]) {
      stats[individual] = {
        rowCount: 0,
        medianFixS: null,
        medianStepM: null,
        p95StepM: null,
      };
    }
    palette[individual] = hslToRgb((index * 137.508) % 360, 0.76, 0.54);
  });

  return {
    totalRows: Number(summary.total_rows) || 0,
    individuals,
    speciesByIndividual: summary.species_by_individual || {},
    seriesByIndividual,
    coverageByIndividual,
    stats,
    palette,
    minTimeMs: Number(summary.min_time_ms) || 0,
    maxTimeMs: Number(summary.max_time_ms) || 0,
    initialView: {
      longitude: Number(summary.initial_view?.longitude) || 0,
      latitude: Number(summary.initial_view?.latitude) || 0,
      zoom: Number(summary.initial_view?.zoom) || 1,
    },
    selectedIndividuals: new Set(individuals),
  };
}

function interpolateSeriesPosition(series, currentTimeMs) {
  if (!series || !Array.isArray(series.times) || !Array.isArray(series.positions) || !series.times.length) {
    return null;
  }
  if (currentTimeMs <= series.times[0]) {
    return series.positions[0];
  }
  const lastIndex = series.times.length - 1;
  if (currentTimeMs >= series.times[lastIndex]) {
    return series.positions[lastIndex];
  }

  for (let index = 1; index < series.times.length; index += 1) {
    const leftTime = series.times[index - 1];
    const rightTime = series.times[index];
    if (currentTimeMs > rightTime) {
      continue;
    }
    const leftPos = series.positions[index - 1];
    const rightPos = series.positions[index];
    const span = rightTime - leftTime;
    if (span <= 0) {
      return rightPos;
    }
    const ratio = (currentTimeMs - leftTime) / span;
    return [
      leftPos[0] + (rightPos[0] - leftPos[0]) * ratio,
      leftPos[1] + (rightPos[1] - leftPos[1]) * ratio,
    ];
  }
  return series.positions[lastIndex];
}

function visibleSets(showTrain, showTest) {
  const sets = [];
  if (showTrain) sets.push("train");
  if (showTest) sets.push("test");
  return sets;
}

function splitColor(baseColor, setName, alpha) {
  const factor = setName === "test" ? 0.7 : 1.12;
  return [
    clampColor(baseColor[0] * factor),
    clampColor(baseColor[1] * factor),
    clampColor(baseColor[2] * factor),
    alpha,
  ];
}

function colorCss(baseColor, setName, alpha) {
  const color = splitColor(baseColor, setName, Math.round(alpha * 255));
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let rgb = [0, 0, 0];
  if (hp >= 0 && hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map(value => Math.round((value + m) * 255));
}

function rangeToPercent(min, max, start, end) {
  const span = Math.max(1, max - min);
  const left = ((start - min) / span) * 100;
  const width = Math.max(0.8, ((end - start) / span) * 100);
  return { left, width };
}

function stepTouchesArtifact(step, logicalName) {
  if (!step) {
    return false;
  }
  const stepArtifacts = [
    ...(Array.isArray(step.input_artifacts) ? step.input_artifacts : []),
    ...(Array.isArray(step.output_artifacts) ? step.output_artifacts : []),
    ...(Array.isArray(step.removed_artifacts) ? step.removed_artifacts : []),
  ];
  return stepArtifacts.includes(logicalName);
}

function formatDatasetLabel(dataset, currentDatasetId) {
  const currentSuffix = dataset.dataset_id === currentDatasetId ? " (head)" : "";
  const note = dataset.note ? `${dataset.note} ` : "";
  return `${note}[${dataset.dataset_id}]${currentSuffix}`;
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value);
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown time";
}

function formatMaybeNumber(value, suffix) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${suffix}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "n/a";
  }
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  }
  if (seconds < 3600) {
    const minutes = seconds / 60;
    return `${minutes.toFixed(minutes >= 10 ? 1 : 2)} min`;
  }
  const hours = seconds / 3600;
  return `${hours.toFixed(hours >= 10 ? 1 : 2)} hr`;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlElement(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return response;
}

function showBootError(message) {
  const mountEl = document.getElementById("app");
  if (!mountEl) {
    return;
  }
  mountEl.innerHTML = `
    <div style="display:grid;place-items:center;height:100%;padding:24px;color:#ffb3c2;font-family:'Segoe UI',sans-serif;">
      <div style="max-width:560px;padding:20px 24px;border-radius:16px;background:rgba(7,11,22,0.92);border:1px solid rgba(255,255,255,0.08);">
        <h2 style="margin:0 0 8px;font-size:18px;">Trajectory app failed to load</h2>
        <p style="margin:0;font-size:13px;line-height:1.5;">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

async function main() {
  const mountEl = document.getElementById("app");
  if (!mountEl) {
    throw new Error("Missing #app mount element.");
  }

  const app = new TrajectoryExampleApp({
    mountEl,
    storageKey: "scrubdata.app.trajectory",
    fetchJSON: async url => {
      const response = await apiFetch(url);
      return response.json();
    },
    requestJSON: async (url, options = {}) => {
      const response = await apiFetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      return response.json();
    },
  });

  window.addEventListener("beforeunload", () => {
    void app.destroy();
  });

  await app.init();
}

main().catch(error => {
  showBootError(error instanceof Error ? error.message : String(error));
});
