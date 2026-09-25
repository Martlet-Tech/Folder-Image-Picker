import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "FolderImagePicker";
const CELL_SIZES = [88, 112, 144, 192];
const DEFAULT_CELL = 112;

const CSS = `
.fip-root{display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;
  font-family:system-ui,'Segoe UI',sans-serif;font-size:12px;color:#ddd;background:#1e1e1e;
  border:1px solid #444;border-radius:6px;padding:8px;overflow:hidden}
.fip-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fip-btn{background:#333;border:1px solid #555;color:#ddd;border-radius:4px;padding:4px 9px;
  cursor:pointer;font-size:11px;white-space:nowrap;line-height:1.5}
.fip-btn:hover{background:#3f3f3f;border-color:#6a6a6a}
.fip-btn:active{background:#2a2a2a}
.fip-btn.on{background:#2d5c8a;border-color:#4a8bc2;color:#fff}
.fip-path{flex:1;min-width:0;background:#141414;border:1px solid #3a3a3a;border-radius:4px;
  padding:4px 7px;color:#8fd18f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:Consolas,monospace;font-size:11px}
.fip-path.empty{color:#777;font-style:italic}
.fip-crumbs{display:flex;gap:4px;align-items:center;flex-wrap:wrap;min-height:18px}
.fip-crumb{background:#2a2a2a;border:1px solid #444;border-radius:3px;padding:2px 7px;
  cursor:pointer;color:#9ecbff;font-size:11px}
.fip-crumb:hover{background:#353535;text-decoration:underline}
.fip-sep{color:#666}
.fip-chips{display:flex;gap:5px;flex-wrap:wrap;max-height:70px;overflow-y:auto}
.fip-chip{background:#2a2a2a;border:1px solid #464646;border-radius:3px;padding:3px 8px;
  cursor:pointer;font-size:11px;color:#e0c07a;display:flex;align-items:center;gap:4px}
.fip-chip:hover{background:#383838;border-color:#6a6a6a}
.fip-grid{flex:1;overflow-y:auto;display:flex;flex-wrap:wrap;gap:7px;align-content:start;
  padding:2px;min-height:120px}
.fip-cell{position:relative;flex:0 0 auto;width:var(--fip-cell,112px);height:var(--fip-cell,112px);
  border:2px solid transparent;border-radius:5px;
  background:#141414;cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center}
.fip-cell:hover{border-color:#6a9fd4}
.fip-cell.sel{border-color:#4caf50;box-shadow:0 0 0 1px #4caf50 inset}
.fip-cell img{width:100%;height:100%;object-fit:cover;display:block}
.fip-cell .nm{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.85));
  color:#fff;font-size:9px;padding:8px 3px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fip-cell .tick{position:absolute;top:3px;right:3px;background:#4caf50;color:#fff;border-radius:50%;
  width:16px;height:16px;font-size:11px;line-height:16px;text-align:center;font-weight:bold}
.fip-empty{width:100%;text-align:center;color:#777;padding:24px 8px;font-style:italic}
.fip-status{color:#888;font-size:10px;display:flex;justify-content:space-between;gap:8px}
.fip-sel{color:#4caf50;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function setWidgetValue(node, name, value) {
  const w = getWidget(node, name);
  if (!w) return;
  w.value = value;
  if (w.callback) w.callback(value);
}

class PickerUI {
  constructor(node) {
    this.node = node;
    this.rel = "";
    this.recursive = false;
    this.loading = false;
    this.cellSize = DEFAULT_CELL;
    this._token = 0;
    this.build();
  }

  get folder() {
    return getWidget(this.node, "folder")?.value || "";
  }

  set folder(v) {
    setWidgetValue(this.node, "folder", v);
  }

  get selected() {
    return getWidget(this.node, "selected_image")?.value || "";
  }

  set selected(v) {
    setWidgetValue(this.node, "selected_image", v);
  }

  build() {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "fip-root";

    const bar = document.createElement("div");
    bar.className = "fip-bar";

    this.pickBtn = document.createElement("button");
    this.pickBtn.className = "fip-btn";
    this.pickBtn.textContent = "📁 Choose Folder";
    this.pickBtn.onclick = () => this.pickFolder();

    this.refreshBtn = document.createElement("button");
    this.refreshBtn.className = "fip-btn";
    this.refreshBtn.textContent = "⟳";
    this.refreshBtn.title = "Refresh";
    this.refreshBtn.onclick = () => this.load();

    this.recBtn = document.createElement("button");
    this.recBtn.className = "fip-btn";
    this.recBtn.textContent = "Subfolders";
    this.recBtn.title = "Also list images inside subfolders";
    this.recBtn.onclick = () => {
      this.recursive = !this.recursive;
      this.recBtn.classList.toggle("on", this.recursive);
      this.load();
    };

    this.sizeBtn = document.createElement("button");
    this.sizeBtn.className = "fip-btn";
    this.sizeBtn.title = "Cycle thumbnail size";
    this.sizeBtn.onclick = () => this.cycleCellSize();

    this.pathEl = document.createElement("div");
    this.pathEl.className = "fip-path empty";
    this.pathEl.textContent = "No folder selected";

    bar.append(this.pickBtn, this.refreshBtn, this.recBtn, this.sizeBtn, this.pathEl);

    this.crumbsEl = document.createElement("div");
    this.crumbsEl.className = "fip-crumbs";

    this.chipsEl = document.createElement("div");
    this.chipsEl.className = "fip-chips";

    this.gridEl = document.createElement("div");
    this.gridEl.className = "fip-grid";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "fip-status";
    this.countEl = document.createElement("span");
    this.selEl = document.createElement("span");
    this.selEl.className = "fip-sel";
    this.statusEl.append(this.countEl, this.selEl);

    this.root.append(bar, this.crumbsEl, this.chipsEl, this.gridEl, this.statusEl);

    this.widget = this.node.addDOMWidget("folderpicker", "div", this.root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => 260,
      getValue: () => "",
      setValue: () => {},
    });

    this.applyCellSize();
    this.renderCrumbs();
    this.renderSelection();
    if (this.folder) this.load();
  }

  applyCellSize() {
    this.root.style.setProperty("--fip-cell", `${this.cellSize}px`);
    this.sizeBtn.textContent = `${this.cellSize}px`;
  }

  cycleCellSize() {
    const idx = CELL_SIZES.indexOf(this.cellSize);
    this.cellSize = CELL_SIZES[(idx + 1) % CELL_SIZES.length];
    this.applyCellSize();
  }

  async pickFolder() {
    this.pickBtn.disabled = true;
    const old = this.pickBtn.textContent;
    this.pickBtn.textContent = "…";
    try {
      const res = await api.fetchApi("/folderpicker/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: this.folder || "" }),
      });
      const data = await res.json();
      if (data.path) {
        this.folder = data.path;
        this.rel = "";
        await this.load();
      }
    } catch (e) {
      console.error("FolderImagePicker: pick failed", e);
    } finally {
      this.pickBtn.disabled = false;
      this.pickBtn.textContent = old;
    }
  }

  async load() {
    const folder = this.folder;
    this.pathEl.textContent = folder || "No folder selected";
    this.pathEl.classList.toggle("empty", !folder);
    this.pathEl.title = folder;
    if (!folder) {
      this.gridEl.innerHTML = '<div class="fip-empty">Click "📁 Choose Folder" to pick a directory</div>';
      this.crumbsEl.innerHTML = "";
      this.chipsEl.innerHTML = "";
      this.countEl.textContent = "";
      return;
    }

    const token = ++this._token;
    this.loading = true;
    this.countEl.textContent = "Loading…";

    try {
      const q = new URLSearchParams({
        folder,
        rel: this.rel,
        recursive: this.recursive ? "1" : "0",
      });
      const res = await api.fetchApi(`/folderpicker/list?${q}`);
      const data = await res.json();
      if (token !== this._token) return;
      if (data.error) {
        this.gridEl.innerHTML = `<div class="fip-empty">Failed to load: ${data.error}</div>`;
        this.countEl.textContent = "";
        return;
      }
      this.render(data);
    } catch (e) {
      if (token !== this._token) return;
      this.gridEl.innerHTML = '<div class="fip-empty">Failed to load directory</div>';
      this.countEl.textContent = "";
      console.error("FolderImagePicker: list failed", e);
    } finally {
      if (token === this._token) this.loading = false;
    }
  }

  render(data) {
    this.renderCrumbs();
    this.renderChips(data.folders || []);
    this.renderGrid(data.images || []);
    this.countEl.textContent = `${data.count} image${data.count === 1 ? "" : "s"}`;
    this.renderSelection();
  }

  renderCrumbs() {
    const parts = this.rel ? this.rel.split("/").filter(Boolean) : [];
    this.crumbsEl.innerHTML = "";
    const mk = (label, rel) => {
      const b = document.createElement("span");
      b.className = "fip-crumb";
      b.textContent = label;
      b.onclick = () => {
        this.rel = rel;
        this.load();
      };
      return b;
    };
    this.crumbsEl.append(mk("🏠 Root", ""));
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      const sep = document.createElement("span");
      sep.className = "fip-sep";
      sep.textContent = "›";
      this.crumbsEl.append(sep, mk(p, acc));
    }
  }

  renderChips(folders) {
    this.chipsEl.innerHTML = "";
    if (!folders.length) {
      this.chipsEl.style.display = "none";
      return;
    }
    this.chipsEl.style.display = "flex";
    for (const f of folders) {
      const c = document.createElement("div");
      c.className = "fip-chip";
      const short = f.includes("/") ? f.split("/").pop() : f;
      const depth = f.split("/").length;
      c.textContent = `📂 ${short}`;
      if (depth > 1) {
        c.title = f;
      }
      c.onclick = () => {
        this.rel = f;
        this.load();
      };
      this.chipsEl.append(c);
    }
  }

  renderGrid(images) {
    this.gridEl.innerHTML = "";
    if (!images.length) {
      this.gridEl.innerHTML = '<div class="fip-empty">No images in this folder</div>';
      return;
    }
    const folder = this.folder;
    const frag = document.createDocumentFragment();
    for (const img of images) {
      const cell = document.createElement("div");
      cell.className = "fip-cell";
      cell.dataset.rel = img.rel;
      cell.title = `${img.rel}\n${(img.size / 1024).toFixed(0)} KB`;

      const el = document.createElement("img");
      el.loading = "lazy";
      el.decoding = "async";
      const q = new URLSearchParams({ folder, rel: img.rel });
      el.src = api.apiURL(`/folderpicker/thumb?${q}`);
      el.onerror = () => {
        el.remove();
        cell.style.color = "#666";
        cell.style.fontSize = "9px";
        cell.textContent = "×";
      };

      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = img.name;

      cell.append(el, nm);
      if (img.rel === this.selected) {
        cell.classList.add("sel");
        const t = document.createElement("div");
        t.className = "tick";
        t.textContent = "✓";
        cell.append(t);
      }

      cell.onclick = () => {
        if (this.selected === img.rel) {
          this.selected = "";
        } else {
          this.selected = img.rel;
        }
        this.renderSelection();
      };

      frag.append(cell);
    }
    this.gridEl.append(frag);
  }

  renderSelection() {
    const sel = this.selected;
    for (const cell of this.gridEl.querySelectorAll(".fip-cell")) {
      const on = cell.dataset.rel === sel;
      cell.classList.toggle("sel", on);
      const old = cell.querySelector(".tick");
      if (on && !old) {
        const t = document.createElement("div");
        t.className = "tick";
        t.textContent = "✓";
        cell.append(t);
      } else if (!on && old) {
        old.remove();
      }
    }
    this.selEl.textContent = sel ? `Selected: ${sel}` : "";
    this.selEl.title = sel;
  }
}

app.registerExtension({
  name: "FolderImagePicker.Extension",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);

      for (const name of ["folder", "selected_image"]) {
        const w = getWidget(this, name);
        if (w) {
          w.computeSize = () => [0, -4];
          w.hidden = true;
        }
      }

      if (this.size[0] < 420) this.size[0] = 420;
      if (this.size[1] < 520) this.size[1] = 520;

      this.pickerUI = new PickerUI(this);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      if (this.pickerUI) {
        this.pickerUI.rel = "";
        this.pickerUI.renderCrumbs();
        this.pickerUI.renderSelection();
        if (this.pickerUI.folder) this.pickerUI.load();
      }
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.pickerUI = null;
      return onRemoved?.apply(this, arguments);
    };
  },
});
