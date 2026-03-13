const CLIENT_ID = "485276099955-j1lh6aretg8i901km60m32kauroqaosu.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "autolog-data.json";
const EMPTY_DATA = { cars: [], logs: [] };

const TYPES = [
  { id:"oil", label:"Cambio de Aceite", icon:"🛢️", interval:5000, color:"#F59E0B" },
  { id:"filter", label:"Cambio de Filtro", icon:"🔧", interval:10000, color:"#6366F1" },
  { id:"tires", label:"Rotación de Gomas", icon:"⚙️", interval:8000, color:"#10B981" },
  { id:"brakes", label:"Revisión de Frenos", icon:"🔴", interval:20000, color:"#EF4444" },
  { id:"transmission", label:"Aceite Transmisión", icon:"⚡", interval:30000, color:"#8B5CF6" },
  { id:"coolant", label:"Líquido Refrigerante", icon:"💧", interval:40000, color:"#0EA5E9" },
  { id:"battery", label:"Batería", icon:"🔋", interval:50000, color:"#F97316" },
  { id:"alignment", label:"Alineación", icon:"📐", interval:15000, color:"#EC4899" },
  { id:"ac", label:"Sistema A/C", icon:"❄️", interval:25000, color:"#06B6D4" },
  { id:"other", label:"Otro", icon:"📝", interval:null, color:"#78716C" }
];

const state = {
  authState: "idle", // idle | loading | authed | error
  storageMode: "local", // local | drive
  syncState: "idle", // idle | saving | saved | error | conflict
  needsReconnect: false,
  userInfo: null,
  data: loadLocal(),
  fileId: null,
  remoteModifiedTime: null,
  lastSync: null,
  view: "dashboard",
  selectedCar: null,
  filterCar: "all",
  filterType: "all",
  form: {},
  toast: null,
};

const mem = {
  token: null,
  tokenClient: null,
  saveTimer: null,
  toastTimer: null,
};

function $(sel) { return document.querySelector(sel); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" });
}
function fmtTime(d) {
  return d ? d.toLocaleTimeString("es-PR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "";
}
function uid() { return Date.now() + Math.floor(Math.random() * 1000000); }
function setToast(msg, type="success") {
  state.toast = { msg, type };
  if (mem.toastTimer) clearTimeout(mem.toastTimer);
  mem.toastTimer = setTimeout(() => { state.toast = null; render(); }, 2800);
  render();
}
function ensureStateShape() {
  if (!state.data || typeof state.data !== "object") state.data = { cars: [], logs: [] };
  if (!Array.isArray(state.data.cars)) state.data.cars = [];
  if (!Array.isArray(state.data.logs)) state.data.logs = [];
  if (!state.view) state.view = "dashboard";
  if (!["dashboard", "addCar", "addLog", "history"].includes(state.view)) state.view = "dashboard";
}
function normalizeData(input) {
  const src = input && typeof input === "object" ? input : {};
  const cars = Array.isArray(src.cars) ? src.cars : [];
  const logs = Array.isArray(src.logs) ? src.logs : [];
  const safeCars = cars
    .filter(c => c && typeof c === "object")
    .map(c => ({
      id: Number.isFinite(Number(c.id)) ? Number(c.id) : uid(),
      name: typeof c.name === "string" ? c.name.slice(0, 100).trim() : "",
      year: typeof c.year === "string" || typeof c.year === "number" ? String(c.year).slice(0, 10) : "",
      plate: typeof c.plate === "string" ? c.plate.slice(0, 20).toUpperCase() : "",
      mi: Number.isFinite(Number(c.km ?? c.odo)) ? Math.max(0, parseInt(c.km ?? c.odo, 10)) : 0,
      color: typeof c.color === "string" ? c.color.slice(0, 40).trim() : ""
    }))
    .filter(c => c.name && c.year && c.plate);
  const carIds = new Set(safeCars.map(c => String(c.id)));
  const safeLogs = logs
    .filter(l => l && typeof l === "object")
    .map(l => ({
      id: Number.isFinite(Number(l.id)) ? Number(l.id) : uid(),
      carId: typeof l.carId === "string" || typeof l.carId === "number" ? String(l.carId) : "",
      type: typeof l.type === "string" ? l.type.slice(0, 30) : "",
      date: typeof l.date === "string" ? l.date.slice(0, 10) : "",
      mi: Number.isFinite(Number(l.km ?? l.odo)) ? Math.max(0, parseInt(l.km ?? l.odo, 10)) : 0,
      cost: typeof l.cost === "string" ? l.cost.slice(0, 30) : "",
      shop: typeof l.shop === "string" ? l.shop.slice(0, 80) : "",
      notes: typeof l.notes === "string" ? l.notes.slice(0, 500) : ""
    }))
    .filter(l => carIds.has(l.carId) && l.type && l.date);
  return { cars: safeCars, logs: safeLogs };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem("autolog_data");
    return raw ? normalizeData(JSON.parse(raw)) : structuredClone(EMPTY_DATA);
  } catch {
    return structuredClone(EMPTY_DATA);
  }
}
function persistLocal() {
  try { localStorage.setItem("autolog_data", JSON.stringify(state.data)); } catch {}
}
function setState(patch) {
  Object.assign(state, patch);
  render();
}
function getCarById(id) {
  return state.data.cars.find(c => String(c.id) === String(id));
}
function getTypeById(id) {
  return TYPES.find(t => t.id === id);
}
function getLastLog(carId, typeId) {
  return state.data.logs
    .filter(l => String(l.carId) === String(carId) && l.type === typeId)
    .sort((a,b) => new Date(b.date) - new Date(a.date))[0];
}
function getOverdueServices(car) {
  const overdue = [];
  TYPES.forEach(type => {
    if (!type.interval) return;
    const last = getLastLog(car.id, type.id);
    if (!last) return;
    const since = car.km - last.km;
    if (since >= type.interval) overdue.push({ type, miles: since, remaining: 0, last });
  });
  return overdue;
}
function getUpcomingServices(car) {
  const upcoming = [];
  TYPES.forEach(type => {
    if (!type.interval) return;
    const last = getLastLog(car.id, type.id);
    if (!last) return;
    const since = car.km - last.km;
    const remaining = type.interval - since;
    if (remaining > 0 && remaining <= Math.round(type.interval * 0.2)) {
      upcoming.push({ type, miles: since, remaining, last });
    }
  });
  upcoming.sort((a, b) => a.remaining - b.remaining);
  return upcoming;
}
function daysUntilNextService(car) {
  const recent = state.data.logs
    .filter(l => String(l.carId) === String(car.id))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  if (recent.length < 2) return null;

  let totalMiles = 0;
  let totalDays = 0;
  for (let i = 0; i < recent.length - 1; i++) {
    const newer = recent[i];
    const older = recent[i + 1];
    const mileDiff = Math.max(0, Number(newer.km) - Number(older.km));
    const dayDiff = Math.max(1, Math.round((new Date(newer.date) - new Date(older.date)) / 86400000));
    totalMiles += mileDiff;
    totalDays += dayDiff;
  }
  if (!totalMiles || !totalDays) return null;
  return totalMiles / totalDays;
}
function estimateNextService(car) {
  const upcoming = getUpcomingServices(car);
  if (!upcoming.length) return null;
  const next = upcoming[0];
  const avgMilesPerDay = daysUntilNextService(car);
  let eta = null;
  if (avgMilesPerDay && avgMilesPerDay > 0) {
    eta = Math.ceil(next.remaining / avgMilesPerDay);
  }
  return { ...next, eta };
}
function selectedDashboardCar() {
  ensureStateShape();
  return getCarById(state.selectedCar) || state.data.cars[0] || null;
}

async function driveReq(url, opts={}) {
  const token = mem.token;
  if (!token) {
    const err = new Error("Missing access token");
    err.status = 401;
    throw err;
  }
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}
async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`);
  const data = await res.json();
  return data.files?.[0] || null;
}
async function getFileMeta(fileId) {
  return (await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,modifiedTime`)).json();
}
async function readFile(fileId) {
  return (await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).json();
}
async function createFile(content) {
  const meta = new Blob([JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] })], { type: "application/json" });
  const body = new Blob([JSON.stringify(content)], { type: "application/json" });
  const form = new FormData();
  form.append("metadata", meta);
  form.append("file", body);
  return (await driveReq("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime", {
    method: "POST",
    body: form
  })).json();
}
async function updateFile(fileId, content) {
  return (await driveReq(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content)
  })).json();
}
function handleDriveAuthError(msg="Drive desconectado. Vuelve a iniciar sesión.") {
  mem.token = null;
  state.needsReconnect = true;
  state.storageMode = "local";
  state.syncState = "error";
  state.fileId = null;
  state.remoteModifiedTime = null;
  state.authState = "error";
  setToast(msg, "error");
}
async function loadDrive() {
  try {
    state.syncState = "saving";
    render();
    const file = await findFile();
    if (file) {
      const content = normalizeData(await readFile(file.id));
      state.data = content;
      state.fileId = file.id;
      state.remoteModifiedTime = file.modifiedTime || null;
    } else {
      const created = await createFile(state.data);
      state.fileId = created.id;
      state.remoteModifiedTime = created.modifiedTime || null;
    }
    state.storageMode = "drive";
    state.syncState = "saved";
    state.lastSync = new Date();
    state.authState = "authed";
    persistLocal();
    render();
  } catch (e) {
    console.error(e);
    if (e?.status === 401) return handleDriveAuthError();
    state.syncState = "error";
    state.authState = "error";
    state.storageMode = "local";
    render();
    setToast("Error cargando datos desde Drive.", "error");
  }
}
async function saveDriveNow() {
  if (state.storageMode !== "drive" || !state.fileId) return;
  try {
    state.syncState = "saving";
    render();
    const meta = await getFileMeta(state.fileId);
    if (state.remoteModifiedTime && meta?.modifiedTime && meta.modifiedTime !== state.remoteModifiedTime) {
      state.syncState = "conflict";
      render();
      setToast("Se detectó un conflicto en Drive. Se cargará la copia más reciente.", "warn");
      await loadDrive();
      return;
    }
    const updated = await updateFile(state.fileId, normalizeData(state.data));
    state.remoteModifiedTime = updated.modifiedTime || state.remoteModifiedTime;
    state.syncState = "saved";
    state.lastSync = new Date();
    render();
  } catch (e) {
    console.error(e);
    if (e?.status === 401) return handleDriveAuthError();
    state.syncState = "error";
    render();
    setToast("No se pudo guardar en Drive.", "error");
  }
}
function queueSave() {
  persistLocal();
  if (mem.saveTimer) clearTimeout(mem.saveTimer);
  if (state.storageMode !== "drive" || !state.fileId) return;
  mem.saveTimer = setTimeout(() => { void saveDriveNow(); }, 1200);
}
function updateData(nextData) {
  state.data = normalizeData(nextData);
  queueSave();
  render();
}
function initGIS() {
  const poll = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(poll);
      mem.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
          if (resp.error) {
            state.authState = "error";
            render();
            return;
          }
          mem.token = resp.access_token;
          state.needsReconnect = false;
          try {
            const user = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${resp.access_token}` }
            }).then(r => r.json());
            state.userInfo = user;
          } catch {}
          state.authState = "loading";
          render();
          await loadDrive();
        }
      });
    }
  }, 250);
}
function signIn() {
  state.authState = "loading";
  render();
  mem.tokenClient?.requestAccessToken();
}
function signOut() {
  if (mem.saveTimer) clearTimeout(mem.saveTimer);
  if (mem.token) window.google?.accounts?.oauth2?.revoke(mem.token);
  mem.token = null;
  state.authState = "idle";
  state.storageMode = "local";
  state.syncState = "idle";
  state.needsReconnect = false;
  state.userInfo = null;
  state.fileId = null;
  state.remoteModifiedTime = null;
  state.lastSync = null;
  render();
  setToast("Sesión cerrada.", "success");
}

function addCar() {
  const f = state.form;
  if (!f.name || !f.year || !f.plate) return setToast("Completa nombre, año y tablilla.", "error");
  const car = {
    id: uid(),
    name: String(f.name).trim(),
    year: String(f.year).trim(),
    plate: String(f.plate).trim().toUpperCase(),
    mi: Number.isFinite(Number(f.km)) ? Math.max(0, parseInt(f.km, 10)) : 0,
    color: String(f.color || "").trim()
  };
  updateData({ ...state.data, cars: [...state.data.cars, car] });
  state.form = {};
  state.view = "dashboard";
  state.selectedCar = car.id;
  setToast("Vehículo añadido.", "success");
}
function addLog() {
  const f = state.form;
  if (!f.carId || !f.type || !f.date || f.km === undefined || f.km === "") return setToast("Completa vehículo, tipo, fecha y kilometraje.", "error");
  const log = {
    id: uid(),
    carId: String(f.carId),
    type: String(f.type),
    date: String(f.date),
    mi: Math.max(0, parseInt(f.km, 10)),
    cost: String(f.cost || "").trim(),
    shop: String(f.shop || "").trim(),
    notes: String(f.notes || "").trim()
  };
  const cars = state.data.cars.map(c => String(c.id) === String(f.carId) ? { ...c, mi: Math.max(c.km, log.km) } : c);
  updateData({ cars, logs: [log, ...state.data.logs] });
  state.form = {};
  state.view = "history";
  setToast("Mantenimiento registrado.", "success");
}
function deleteCar(id) {
  if (!confirm("¿Eliminar este vehículo y todos sus registros?")) return;
  updateData({
    cars: state.data.cars.filter(c => c.id !== id),
    logs: state.data.logs.filter(l => String(l.carId) !== String(id))
  });
  if (String(state.selectedCar) === String(id)) state.selectedCar = null;
  setToast("Vehículo eliminado.", "warn");
}
function deleteLog(id) {
  updateData({ ...state.data, logs: state.data.logs.filter(l => l.id !== id) });
  setToast("Registro eliminado.", "warn");
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `autolog-secure-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = normalizeData(JSON.parse(String(ev.target?.result || "{}")));
      updateData(parsed);
      setToast("Backup importado.", "success");
    } catch {
      setToast("Archivo inválido.", "error");
    }
  };
  reader.readAsText(file);
}

function serviceCard(car, type) {
  const last = getLastLog(car.id, type.id);
  const since = last ? car.km - last.km : null;
  const overdue = type.interval && since !== null && since >= type.interval;
  const dueSoon = type.interval && since !== null && since >= type.interval * .8 && !overdue;
  const pct = type.interval && since !== null ? Math.min(100, (since / type.interval) * 100) : 0;
  const badge = overdue ? `<span class="badge badge-danger">VENCIDO</span>` :
    dueSoon ? `<span class="badge badge-warn">PRÓXIMO</span>` :
    last ? `<span class="badge badge-ok">AL DÍA</span>` : "";
  return `
    <div class="service ${overdue ? "overdue" : dueSoon ? "warn" : ""}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:22px">${type.icon}</div>
          <div style="font-size:13px;font-weight:700;margin-top:4px">${esc(type.label)}</div>
        </div>
        ${badge}
      </div>
      ${last ? `
        <div class="small muted" style="margin-top:12px">Último: ${fmtDate(last.date)} · ${last.km.toLocaleString("es-ES")} mi</div>
        ${type.interval ? `
          <div style="margin-top:8px" class="progress"><span style="width:${pct}%;background:${overdue ? "#ef4444" : dueSoon ? "#f59e0b" : type.color}"></span></div>
          <div class="small muted" style="margin-top:6px">${since.toLocaleString("es-ES")} / ${type.interval.toLocaleString("es-ES")} mi</div>
        ` : ""}
      ` : `<div class="small muted" style="margin-top:12px">Sin registros aún</div>`}
    </div>`;
}
function renderLogin() {
  return `
  <div class="login">
    <div class="card login-card">
      <div style="display:grid;place-items:center;margin-bottom:18px">
        <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,#f59e0b,#f97316);display:grid;place-items:center;font-size:36px;color:#111">🚗</div>
      </div>
      <h1 style="text-align:center;margin:0 0 8px">AutoLog</h1>
      <button id="sign-in-btn" class="btn btn-primary" style="width:100%;padding:14px 18px">Continuar con Google</button>
      <div style="display:flex;align-items:center;gap:12px;margin:18px 0;color:#666"><span style="height:1px;background:#252528;flex:1"></span><span class="small">o</span><span style="height:1px;background:#252528;flex:1"></span></div>
      <button id="local-btn" class="btn" style="width:100%">Usar sin cuenta</button>
    </div>
  </div>`;
}
function renderHeader() {
  const syncColor =
    state.storageMode === "local" ? "#666" :
    state.syncState === "saved" ? "#10b981" :
    state.syncState === "saving" ? "#f59e0b" :
    state.syncState === "conflict" ? "#f97316" : "#ef4444";
  const syncLabel =
    state.storageMode === "local" && state.needsReconnect ? "Drive desconectado · reconexión requerida" :
    state.storageMode === "local" ? "Modo local" :
    state.syncState === "saved" ? `Drive sincronizado · ${fmtTime(state.lastSync)}` :
    state.syncState === "saving" ? "Guardando en Drive…" :
    state.syncState === "conflict" ? "Conflicto detectado en Drive" : "Error de sincronización con Drive";
  return `
    <div class="syncbar">
      <span class="syncdot" style="background:${syncColor}"></span>
      <span>${esc(syncLabel)}</span>
      ${state.userInfo?.email ? `<span class="muted">· ${esc(state.userInfo.email)}</span>` : ""}
      <span style="margin-left:auto" class="row">
        ${state.needsReconnect ? `<button id="reconnect-btn" class="btn small">Reconectar Drive</button>` : ""}
        <button id="export-btn" class="btn small">Exportar</button>
        <label class="btn small">Importar<input id="import-input" type="file" accept=".json" hidden></label>
        ${state.userInfo ? `<button id="sign-out-btn" class="btn small">Cerrar sesión</button>` : ""}
      </span>
    </div>
    <div class="header">
      <div class="header-inner">
        <div class="row" style="margin-right:8px">
          <div class="logo">🚗</div>
          <strong>AutoLog</strong>
        </div>
        <div class="nav">
          ${navBtn("dashboard","Inicio")}
          ${navBtn("addCar","Nuevo")}
          ${navBtn("addLog","Registrar")}
          ${navBtn("history","Historial")}
        </div>
        <div class="muted small" style="margin-left:auto">${state.data.cars.length} veh.</div>
      </div>
    </div>
  `;
}
function navBtn(view, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${esc(label)}</button>`;
}
function renderServiceAlerts(car) {
  const overdue = getOverdueServices(car);
  if (!overdue.length) return "";
  return `
    <div class="card" style="padding:18px;margin-bottom:20px;border-color:#7f2c2c;background:#1b1010">
      <div style="font-weight:700;margin-bottom:10px;color:#ef4444">⚠️ Servicios pendientes</div>
      ${overdue.map(o => `
        <div class="small" style="margin-bottom:6px">• ${esc(o.type.label)} (${o.miles.toLocaleString("en-US")} mi desde el último servicio)</div>
      `).join("")}
    </div>
  `;
}
function renderUpcomingPanel(car) {
  const next = estimateNextService(car);
  if (!next) return "";
  return `
    <div class="card" style="padding:18px;margin-bottom:20px;border-color:#5d4a16;background:#17140c">
      <div style="font-weight:700;margin-bottom:10px;color:#f59e0b">🛠️ Próximo servicio estimado</div>
      <div>${esc(next.type.label)}</div>
      <div class="small muted" style="margin-top:6px">
        Restan ${next.remaining.toLocaleString("en-US")} mi
        ${next.eta ? ` · aprox. ${next.eta} ${next.eta === 1 ? "día" : "días"}` : ""}
      </div>
    </div>
  `;
}
function renderReminderPanel(car) {
  const logs = state.data.logs
    .filter(l => String(l.carId) === String(car.id))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 1);

  if (!logs.length) return "";
  const latest = logs[0];
  return `
    <div class="card" style="padding:18px;margin-bottom:20px">
      <div style="font-weight:700;margin-bottom:10px">📅 Último mantenimiento registrado</div>
      <div>${fmtDate(latest.date)}</div>
      <div class="small muted" style="margin-top:6px">${Number(latest.km).toLocaleString("en-US")} mi · ${esc(getTypeById(latest.type)?.label || latest.type)}</div>
    </div>
  `;
}
function renderDashboard() {
  if (!state.data.cars.length) {
    return `
      <div class="card empty">
        <div style="font-size:54px">🚗</div>
        <h2>Sin vehículos registrados</h2>
        <p>Añade tu primer vehículo para comenzar.</p>
        <div style="margin-top:18px"><button class="btn btn-primary" data-view="addCar">Añadir vehículo</button></div>
      </div>
    `;
  }
  const car = selectedDashboardCar();
  return `
    <div class="row" style="margin-bottom:22px">
      <span class="muted small">Vehículo:</span>
      ${state.data.cars.map(c => `
        <button class="btn ${String(car?.id) === String(c.id) ? "btn-primary" : ""}" data-select-car="${c.id}">
          ${esc(c.name)} ${esc(c.year)}
        </button>
      `).join("")}
    </div>
    ${car ? renderServiceAlerts(car) : ""}
    ${car ? renderUpcomingPanel(car) : ""}
    ${car ? renderReminderPanel(car) : ""}
    ${car ? `
      <div class="card" style="padding:22px;margin-bottom:20px">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="row">
              <h2 style="margin:0">${esc(car.name)}</h2>
              <span class="badge" style="background:#1e1e22;color:#bbb">${esc(car.year)}</span>
              <span class="plate">${esc(car.plate)}</span>
            </div>
            <div class="muted small" style="margin-top:6px">${car.color ? `Color: ${esc(car.color)}` : ""}</div>
          </div>
          <div style="text-align:right">
            <div class="small muted">Millaje</div>
            <div class="km">${car.km.toLocaleString("es-ES")} <span class="small muted">km</span></div>
          </div>
        </div>
        <div class="row" style="margin-top:18px">
          <button class="btn btn-primary" id="quick-log-btn">Registrar mantenimiento</button>
          <button class="btn btn-danger" id="delete-car-btn">Eliminar vehículo</button>
        </div>
      </div>
      <div class="services">
        ${TYPES.filter(t => t.id !== "other").map(t => serviceCard(car, t)).join("")}
      </div>
    ` : ""}
  `;
}
function renderAddCar() {
  const f = state.form;
  return `
    <div style="max-width:560px">
      <h2>Nuevo vehículo</h2>
      <div class="card" style="padding:24px">
        <div class="col">
          ${field("Nombre / Modelo *", `<input class="input" id="car-name" value="${esc(f.name || "")}" />`)}
          <div class="grid-2">
            ${field("Año *", `<input class="input" id="car-year" type="number" value="${esc(f.year || "")}" />`)}
            ${field("Tablilla / Placa *", `<input class="input" id="car-plate" value="${esc(f.plate || "")}" />`)}
          </div>
          <div class="grid-2">
            ${field("Millas actuales", `<input class="input" id="car-km" type="number" value="${esc(f.km || "")}" />`)}
            ${field("Color", `<input class="input" id="car-color" value="${esc(f.color || "")}" />`)}
          </div>
          <div class="row">
            <button id="save-car-btn" class="btn btn-primary">Añadir vehículo</button>
            <button class="btn" data-view="dashboard">Cancelar</button>
          </div>
        </div>
      </div>
    </div>`;
}
function renderAddLog() {
  const f = state.form;
  if (!state.data.cars.length) {
    return `<div class="card empty"><p>Primero debes añadir un vehículo.</p><div style="margin-top:16px"><button class="btn btn-primary" data-view="addCar">Añadir vehículo</button></div></div>`;
  }
  return `
    <div style="max-width:620px">
      <h2>Registrar mantenimiento</h2>
      <div class="card" style="padding:24px">
        <div class="col">
          ${field("Vehículo *", `<select class="select" id="log-carId">
            <option value="">Seleccionar…</option>
            ${state.data.cars.map(c => `<option value="${c.id}" ${String(f.carId || "") === String(c.id) ? "selected" : ""}>${esc(c.name)} ${esc(c.year)} — ${esc(c.plate)}</option>`).join("")}
          </select>`)}
          ${field("Tipo de mantenimiento *", `<select class="select" id="log-type">
            <option value="">Seleccionar…</option>
            ${TYPES.map(t => `<option value="${t.id}" ${f.type === t.id ? "selected" : ""}>${esc(t.icon)} ${esc(t.label)}</option>`).join("")}
          </select>`)}
          <div class="grid-2">
            ${field("Fecha *", `<input class="input" id="log-date" type="date" value="${esc(f.date || "")}" />`)}
            ${field("Millaje *", `<input class="input" id="log-km" type="number" value="${esc(f.km || "")}" />`)}
          </div>
          <div class="grid-2">
            ${field("Costo", `<input class="input" id="log-cost" value="${esc(f.cost || "")}" />`)}
            ${field("Taller", `<input class="input" id="log-shop" value="${esc(f.shop || "")}" />`)}
          </div>
          ${field("Notas", `<textarea class="textarea" id="log-notes">${esc(f.notes || "")}</textarea>`)}
          <div class="row">
            <button id="save-log-btn" class="btn btn-primary">Guardar registro</button>
            <button class="btn" data-view="history">Cancelar</button>
          </div>
        </div>
      </div>
    </div>`;
}
function renderHistory() {
  const logs = state.data.logs.filter(l => {
    if (state.filterCar !== "all" && String(l.carId) !== String(state.filterCar)) return false;
    if (state.filterType !== "all" && l.type !== state.filterType) return false;
    return true;
  });
  const total = logs.reduce((sum, l) => {
    const n = parseFloat(String(l.cost || "").replace(/[^0-9.]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  return `
    <div class="row" style="justify-content:space-between;margin-bottom:18px">
      <h2 style="margin:0">Historial de mantenimiento</h2>
      <button class="btn btn-primary" data-view="addLog">Registrar</button>
    </div>
    <div class="row" style="margin-bottom:18px">
      <select class="select" id="filter-car" style="max-width:240px">
        <option value="all">Todos los vehículos</option>
        ${state.data.cars.map(c => `<option value="${c.id}" ${String(state.filterCar) === String(c.id) ? "selected" : ""}>${esc(c.name)} ${esc(c.year)}</option>`).join("")}
      </select>
      <select class="select" id="filter-type" style="max-width:240px">
        <option value="all">Todos los tipos</option>
        ${TYPES.map(t => `<option value="${t.id}" ${state.filterType === t.id ? "selected" : ""}>${esc(t.icon)} ${esc(t.label)}</option>`).join("")}
      </select>
    </div>
    ${logs.length ? `
      <div class="table">
        ${logs.map(log => {
          const car = getCarById(log.carId);
          const type = getTypeById(log.type);
          return `
            <div class="card entry">
              <div class="row" style="flex:1;align-items:flex-start">
                <div style="font-size:24px">${type?.icon || "📝"}</div>
                <div>
                  <div class="row">
                    <strong>${esc(type?.label || log.type)}</strong>
                    ${car ? `<span class="plate">${esc(car.plate)}</span>` : ""}
                  </div>
                  <div class="small muted" style="margin-top:6px">
                    📅 ${fmtDate(log.date)} · 🛣️ ${log.km.toLocaleString("es-ES")} mi
                    ${log.shop ? ` · 🔧 ${esc(log.shop)}` : ""}
                    ${log.cost ? ` · 💲 ${esc(log.cost)}` : ""}
                  </div>
                  ${log.notes ? `<div class="small muted" style="margin-top:6px">📝 ${esc(log.notes)}</div>` : ""}
                </div>
              </div>
              <div class="row">
                ${car ? `<span class="small muted">${esc(car.name)} ${esc(car.year)}</span>` : ""}
                <button class="btn btn-danger" data-delete-log="${log.id}">Eliminar</button>
              </div>
            </div>`;
        }).join("")}
      </div>
      <div class="small muted" style="text-align:right;margin-top:14px">
        ${logs.length} ${logs.length === 1 ? "registro" : "registros"} ${total ? `· Total: $${total.toFixed(2)}` : ""}
      </div>
    ` : `<div class="card empty">No hay registros aún.</div>`}
  `;
}
function field(label, control) {
  return `<label><span class="label">${esc(label)}</span>${control}</label>`;
}
function renderApp() {
  ensureStateShape();
  let body = "";
  if (state.view === "dashboard") body = renderDashboard();
  else if (state.view === "addCar") body = renderAddCar();
  else if (state.view === "addLog") body = renderAddLog();
  else if (state.view === "history") body = renderHistory();
  else body = renderDashboard();
  return `${renderHeader()}<div class="wrap">${body}</div>`;
}
function render() {
  const app = $("#app");
  if (!app) return;
  ensureStateShape();
  try {
    if (state.authState === "loading") {
      app.innerHTML = `<div class="login"><div class="card login-card"><h2>Cargando…</h2><p class="muted">Conectando con Google Drive.</p></div></div>`;
    } else if (state.authState === "idle" || state.authState === "error") {
      app.innerHTML = renderLogin();
    } else {
      app.innerHTML = renderApp();
    }
    if (state.toast) {
      const el = document.createElement("div");
      el.className = `toast ${state.toast.type}`;
      el.textContent = state.toast.msg;
      document.body.querySelectorAll(".toast").forEach(t => t.remove());
      document.body.appendChild(el);
    } else {
      document.body.querySelectorAll(".toast").forEach(t => t.remove());
    }
    bindEvents();
  } catch (err) {
    console.error("Render error:", err);
    const details = err && err.message ? String(err.message) : "Error desconocido";
    app.innerHTML = `<div class="login"><div class="card login-card"><h2>Error cargando la app</h2><p class="muted" style="margin-bottom:8px">La interfaz falló al renderizar.</p><p class="small muted" style="word-break:break-word">${details}</p><div style="margin-top:16px"><button id="local-btn" class="btn" style="width:100%">Usar sin cuenta</button></div></div></div>`;
    bindEvents();
  }
}
function bindEvents() {
  $("#sign-in-btn")?.addEventListener("click", signIn);
  $("#local-btn")?.addEventListener("click", () => {
    if (mem.saveTimer) clearTimeout(mem.saveTimer);
    ensureStateShape();
    state.authState = "authed";
    state.storageMode = "local";
    state.syncState = "idle";
    state.needsReconnect = false;
    state.fileId = null;
    state.remoteModifiedTime = null;
    state.view = "dashboard";
    state.form = {};
    state.filterCar = "all";
    state.filterType = "all";
    state.selectedCar = state.data.cars[0]?.id ?? null;
    render();
    setToast("Modo local activado.", "warn");
  });
  $("#reconnect-btn")?.addEventListener("click", signIn);
  $("#sign-out-btn")?.addEventListener("click", signOut);
  $("#export-btn")?.addEventListener("click", exportBackup);
  $("#import-input")?.addEventListener("change", e => importBackup(e.target.files?.[0]));
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => {
    state.view = el.getAttribute("data-view");
    render();
  }));
  document.querySelectorAll("[data-select-car]").forEach(el => el.addEventListener("click", () => {
    state.selectedCar = Number(el.getAttribute("data-select-car"));
    render();
  }));
  $("#quick-log-btn")?.addEventListener("click", () => {
    const car = selectedDashboardCar();
    state.form = { carId: String(car?.id || "") };
    state.view = "addLog";
    render();
  });
  $("#delete-car-btn")?.addEventListener("click", () => {
    const car = selectedDashboardCar();
    if (car) deleteCar(car.id);
  });
  $("#save-car-btn")?.addEventListener("click", () => {
    state.form = {
      name: $("#car-name")?.value || "",
      year: $("#car-year")?.value || "",
      plate: $("#car-plate")?.value || "",
      mi: $("#car-km")?.value || "",
      color: $("#car-color")?.value || "",
    };
    addCar();
  });
  $("#save-log-btn")?.addEventListener("click", () => {
    state.form = {
      carId: $("#log-carId")?.value || "",
      type: $("#log-type")?.value || "",
      date: $("#log-date")?.value || "",
      mi: $("#log-km")?.value || "",
      cost: $("#log-cost")?.value || "",
      shop: $("#log-shop")?.value || "",
      notes: $("#log-notes")?.value || "",
    };
    addLog();
  });
  $("#filter-car")?.addEventListener("change", e => { state.filterCar = e.target.value; render(); });
  $("#filter-type")?.addEventListener("change", e => { state.filterType = e.target.value; render(); });
  document.querySelectorAll("[data-delete-log]").forEach(el => el.addEventListener("click", () => {
    deleteLog(Number(el.getAttribute("data-delete-log")));
  }));
}

window.addEventListener("beforeunload", () => {
  if (mem.saveTimer) clearTimeout(mem.saveTimer);
});

render();
initGIS();
