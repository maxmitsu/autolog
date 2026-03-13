const CLIENT_ID = "485276099955-j1lh6aretg8i901km60m32kauroqaosu.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "autolog-data.json";
const EMPTY_DATA = { cars: [], logs: [] };

const TYPES = [
  { id:"oil", label:"Cambio de Aceite", icon:"🛢️", interval:5000, color:"#F59E0B", months:6 },
  { id:"filter", label:"Cambio de Filtro", icon:"🔧", interval:10000, color:"#6366F1", months:12 },
  { id:"tires", label:"Rotación de Gomas", icon:"⚙️", interval:8000, color:"#10B981" },
  { id:"brakes", label:"Revisión de Frenos", icon:"🔴", interval:20000, color:"#EF4444", months:12 },
  { id:"transmission", label:"Aceite Transmisión", icon:"⚡", interval:30000, color:"#8B5CF6" },
  { id:"coolant", label:"Líquido Refrigerante", icon:"💧", interval:40000, color:"#0EA5E9" },
  { id:"battery", label:"Batería", icon:"🔋", interval:50000, color:"#F97316" },
  { id:"alignment", label:"Alineación", icon:"📐", interval:15000, color:"#EC4899" },
  { id:"ac", label:"Sistema A/C", icon:"❄️", interval:25000, color:"#06B6D4" },
  { id:"fuel", label:"Gasolina", icon:"⛽", interval:null, color:"#22C55E" },
  { id:"cabin_filter", label:"Filtro de Cabina", icon:"🌬️", interval:12000, color:"#38BDF8", months:9 },
  { id:"air_filter", label:"Filtro de Aire", icon:"🫧", interval:15000, color:"#60A5FA", months:12 },
  { id:"spark_plugs", label:"Bujías", icon:"✨", interval:60000, color:"#FBBF24" },
  { id:"wipers", label:"Limpiaparabrisas", icon:"🌧️", interval:12000, color:"#93C5FD", months:9 },
  { id:"inspection", label:"Inspección General", icon:"🔍", interval:10000, color:"#A78BFA", months:12 },
  { id:"other", label:"Otro", icon:"📝", interval:null, color:"#78716C" }
];

function getRecommendedDefaults(typeId) {
  const defaults = {
    oil: { interval: 5000, months: 6 },
    filter: { interval: 10000, months: 12 },
    tires: { interval: 8000, months: 8 },
    brakes: { interval: 20000, months: 12 },
    transmission: { interval: 30000, months: 24 },
    coolant: { interval: 40000, months: 24 },
    battery: { interval: 50000, months: 36 },
    alignment: { interval: 15000, months: 12 },
    ac: { interval: 25000, months: 12 },
    cabin_filter: { interval: 12000, months: 9 },
    air_filter: { interval: 15000, months: 12 },
    spark_plugs: { interval: 60000, months: 36 },
    wipers: { interval: 12000, months: 9 },
    inspection: { interval: 10000, months: 12 },
  };
  return defaults[typeId] || { interval: null, months: null };
}

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
  backupListOpen: false,
  selectedCar: null,
  filterCar: "all",
  filterType: "all",
  form: {},
  editingCarId: null,
  editingLogId: null,
  toast: null,
};

const mem = {
  token: null,
  tokenClient: null,
  saveTimer: null,
  toastTimer: null,
  remotePollTimer: null,
  isReloadingRemote: false,
  deferredInstallPrompt: null,
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
function numFmt(value, locale="en-US") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(locale) : "0";
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
  if (!["dashboard","addCar","addLog","fuel","reminders","history","backups"].includes(state.view)) state.view = "dashboard";
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
      km: Number.isFinite(Number(c.km ?? c.odo ?? c.mi)) ? Math.max(0, parseInt(c.km ?? c.odo ?? c.mi, 10)) : 0,
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
      km: Number.isFinite(Number(l.km ?? l.odo ?? l.mi)) ? Math.max(0, parseInt(l.km ?? l.odo ?? l.mi, 10)) : 0,
      cost: typeof l.cost === "string" ? l.cost.slice(0, 30) : "",
      shop: typeof l.shop === "string" ? l.shop.slice(0, 80) : "",
      notes: typeof l.notes === "string" ? l.notes.slice(0, 500) : "",
      gallons: Number.isFinite(Number(l.gallons)) ? Math.max(0, Number(l.gallons)) : 0,
      pricePerGallon: Number.isFinite(Number(l.pricePerGallon)) ? Math.max(0, Number(l.pricePerGallon)) : 0,
      fullTank: l.fullTank !== false
    }))
    .filter(l => carIds.has(l.carId) && l.type && l.date);
  return { cars: safeCars, logs: safeLogs };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem("autolog_secure_data");
    return raw ? normalizeData(JSON.parse(raw)) : structuredClone(EMPTY_DATA);
  } catch {
    return structuredClone(EMPTY_DATA);
  }
}
function persistLocal() {
  try { localStorage.setItem("autolog_secure_data", JSON.stringify(state.data)); } catch {}
}
function persistConflictBackup(reason="backup") {
  try {
    const key = "autolog_backups";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.unshift({
      createdAt: new Date().toISOString(),
      reason,
      data: state.data
    });
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 10)));
  } catch {}
}
function getLocalBackups() {
  try {
    const raw = JSON.parse(localStorage.getItem("autolog_backups") || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function restoreBackupByIndex(index) {
  const backups = getLocalBackups();
  const item = backups[index];
  if (!item?.data) return setToast("No se pudo restaurar la copia.", "error");
  state.data = normalizeData(item.data);
  persistLocal();
  queueSave();
  state.backupListOpen = false;
  state.view = "dashboard";
  render();
  setToast("Copia restaurada.", "success");
}
function clearAllBackups() {
  try { localStorage.removeItem("autolog_backups"); } catch {}
  state.backupListOpen = false;
  render();
  setToast("Copias locales eliminadas.", "warn");
}
async function checkRemoteChanges({ reload = true } = {}) {
  if (state.storageMode !== "drive" || !state.fileId || !mem.token || mem.isReloadingRemote) return false;
  try {
    const meta = await getFileMeta(state.fileId);
    if (state.remoteModifiedTime && meta?.modifiedTime && meta.modifiedTime !== state.remoteModifiedTime) {
      if (reload) {
        mem.isReloadingRemote = true;
        persistConflictBackup("remote-change-detected");
        await loadDrive({ silent: true, keepAuthState: true, showToastMessage: "Se cargó una versión más reciente desde Drive." });
        mem.isReloadingRemote = false;
      }
      return true;
    }
  } catch (e) {
    if (e?.status === 401) handleDriveAuthError();
  }
  return false;
}
function stopDrivePolling() {
  if (mem.remotePollTimer) clearInterval(mem.remotePollTimer);
  mem.remotePollTimer = null;
}
function startDrivePolling() {
  stopDrivePolling();
  mem.remotePollTimer = setInterval(() => {
    void checkRemoteChanges({ reload: true });
  }, 45000);
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
function parseMoney(value) {
  const n = parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function getFuelLogs(carId) {
  return state.data.logs
    .filter(l => l.type === "fuel" && String(l.carId) === String(carId))
    .sort((a,b) => new Date(a.date) - new Date(b.date));
}
function calculateFuelStats(carId) {
  const fuelLogs = getFuelLogs(carId);
  if (fuelLogs.length < 2) return null;
  let totalGallons = 0;
  let totalCost = 0;
  let totalMiles = 0;
  for (let i = 1; i < fuelLogs.length; i++) {
    const prev = fuelLogs[i - 1];
    const curr = fuelLogs[i];
    if (!curr.gallons || !curr.fullTank) continue;
    const miles = Math.max(0, Number(curr.km) - Number(prev.km));
    if (!miles) continue;
    totalMiles += miles;
    totalGallons += Number(curr.gallons) || 0;
    totalCost += parseMoney(curr.cost) || ((Number(curr.gallons) || 0) * (Number(curr.pricePerGallon) || 0));
  }
  if (!totalGallons || !totalMiles) return null;
  return {
    mpg: totalMiles / totalGallons,
    costPerMile: totalCost / totalMiles,
    totalFuelCost: totalCost
  };
}
function getFuelMonthlyStats(carId) {
  const fuelLogs = getFuelLogs(carId);
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const monthly = fuelLogs.filter(log => {
    const d = new Date((log.date || "") + "T00:00:00");
    return !Number.isNaN(d.getTime()) && d.getMonth() === month && d.getFullYear() === year;
  });
  return {
    gallons: monthly.reduce((s,l) => s + (Number(l.gallons) || 0), 0),
    cost: monthly.reduce((s,l) => s + (parseMoney(l.cost) || ((Number(l.gallons)||0)*(Number(l.pricePerGallon)||0))), 0),
    count: monthly.length
  };
}
function getLatestFuelLog(carId) {
  const logs = getFuelLogs(carId);
  return logs.length ? logs[logs.length - 1] : null;
}
function getFuelChartData(carId) {
  const fuelLogs = getFuelLogs(carId).filter(l => l.gallons && l.fullTank);
  const points = [];
  for (let i = 1; i < fuelLogs.length; i++) {
    const prev = fuelLogs[i - 1];
    const curr = fuelLogs[i];
    const miles = Math.max(0, Number(curr.km) - Number(prev.km));
    const gallons = Number(curr.gallons) || 0;
    if (!miles || !gallons) continue;
    points.push({ date: curr.date, mpg: miles / gallons });
  }
  return points.slice(-8);
}
function getLastLog(carId, typeId) {
  return state.data.logs
    .filter(l => String(l.carId) === String(carId) && l.type === typeId)
    .sort((a,b) => new Date(b.date) - new Date(a.date))[0];
}
function addMonthsToDate(dateStr, months) {
  if (!dateStr || !months) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d;
}
function daysBetween(a, b) {
  return Math.ceil((a - b) / 86400000);
}
function getServiceReminderItems() {
  const today = new Date();
  const items = [];

  state.data.cars.forEach(car => {
    TYPES.filter(t => t.id !== "fuel" && t.id !== "other").forEach(type => {
      const rec = getRecommendedDefaults(type.id);
      if (!rec.months && !type.months) return;

      const months = type.months || rec.months;
      const last = getLastLog(car.id, type.id);
      if (!last?.date) {
        items.push({
          carId: car.id,
          carName: `${car.name} ${car.year}`,
          plate: car.plate,
          typeId: type.id,
          typeLabel: type.label,
          icon: type.icon,
          dueDate: null,
          daysLeft: null,
          status: "missing",
          note: "Sin registro previo"
        });
        return;
      }

      const due = addMonthsToDate(last.date, months);
      if (!due) return;
      const daysLeft = daysBetween(due, today);
      const status = daysLeft < 0 ? "overdue" : daysLeft <= 30 ? "soon" : "ok";

      items.push({
        carId: car.id,
        carName: `${car.name} ${car.year}`,
        plate: car.plate,
        typeId: type.id,
        typeLabel: type.label,
        icon: type.icon,
        dueDate: due,
        daysLeft,
        status,
        note: `Último: ${fmtDate(last.date)}`
      });
    });
  });

  const rank = { overdue: 0, soon: 1, missing: 2, ok: 3 };
  return items.sort((a, b) => {
    const diff = rank[a.status] - rank[b.status];
    if (diff !== 0) return diff;
    const ad = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    const bd = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });
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
function parseMoney(value) {
  const n = parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function getVehicleTotalCost(carId) {
  return state.data.logs
    .filter(l => String(l.carId) === String(carId))
    .reduce((sum, l) => sum + parseMoney(l.cost), 0);
}
function getVehicleYearCost(carId) {
  const year = new Date().getFullYear();
  return state.data.logs
    .filter(l => String(l.carId) === String(carId) && String(l.date || "").startsWith(String(year)))
    .reduce((sum, l) => sum + parseMoney(l.cost), 0);
}
function getDateBasedUpcomingServices(car) {
  const now = new Date();
  const serviceRules = [
    { id: "oil", months: 6, label: "Cambio de Aceite", icon: "🛢️" },
    { id: "filter", months: 12, label: "Cambio de Filtro", icon: "🔧" },
    { id: "tires", months: 6, label: "Rotación de Gomas", icon: "⚙️" },
    { id: "brakes", months: 12, label: "Revisión de Frenos", icon: "🔴" },
    { id: "coolant", months: 24, label: "Líquido Refrigerante", icon: "💧" },
    { id: "ac", months: 12, label: "Sistema A/C", icon: "❄️" },
  ];

  return serviceRules.map(rule => {
    const last = getLastLog(car.id, rule.id);
    if (!last?.date) return null;
    const due = new Date(last.date + "T00:00:00");
    due.setMonth(due.getMonth() + rule.months);
    const diffDays = Math.ceil((due - now) / 86400000);
    return { ...rule, last, due, diffDays };
  }).filter(Boolean).sort((a, b) => a.due - b.due).slice(0, 3);
}
function selectedDashboardCar() {
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
  stopDrivePolling();
  state.needsReconnect = true;
  state.storageMode = "local";
  state.syncState = "error";
  state.fileId = null;
  state.remoteModifiedTime = null;
  state.authState = "error";
  setToast(msg, "error");
}
async function loadDrive(options = {}) {
  const { silent = false, keepAuthState = false, showToastMessage = "" } = options;
  try {
    state.syncState = "saving";
    if (!silent) render();
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
    if (!keepAuthState) state.authState = "authed";
    persistLocal();
    startDrivePolling();
    render();
    if (showToastMessage) setToast(showToastMessage, "success");
  } catch (e) {
    console.error(e);
    if (e?.status === 401) return handleDriveAuthError();
    state.syncState = "error";
    state.authState = "error";
    state.storageMode = "local";
    stopDrivePolling();
    render();
    if (!silent) setToast("Error cargando datos desde Drive.", "error");
  }
}
async function saveDriveNow() {
  if (state.storageMode !== "drive" || !state.fileId) return;
  try {
    state.syncState = "saving";
    render();
    const remoteChanged = await checkRemoteChanges({ reload: false });
    if (remoteChanged) {
      state.syncState = "conflict";
      render();
      persistConflictBackup("save-conflict");
      setToast("Conflicto detectado. Se guardó una copia local y se cargará la versión más reciente de Drive.", "warn");
      await loadDrive({ silent: false, keepAuthState: true });
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
          await loadDrive({ silent: false, keepAuthState: false });
        }
      });
    }
  }, 250);
}
function signIn() {
  state.authState = "loading";
  render();
  mem.tokenClient?.requestAccessToken({ prompt: mem.token ? "" : "consent" });
}
function signOut() {
  if (mem.saveTimer) clearTimeout(mem.saveTimer);
  stopDrivePolling();
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

async function installPWA() {
  if (!mem.deferredInstallPrompt) {
    setToast("La opción de instalar no está disponible todavía.", "warn");
    return;
  }
  try {
    const promptEvent = mem.deferredInstallPrompt;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      setToast("App instalada.", "success");
    }
  } catch (e) {
    console.error(e);
    setToast("No se pudo abrir la instalación.", "error");
  } finally {
    mem.deferredInstallPrompt = null;
    render();
  }
}

function addCar() {
  const f = state.form;
  if (!f.name || !f.year || !f.plate) return setToast("Completa nombre, año y tablilla.", "error");
  const car = {
    id: uid(),
    name: String(f.name).trim(),
    year: String(f.year).trim(),
    plate: String(f.plate).trim().toUpperCase(),
    km: Number.isFinite(Number(f.km)) ? Math.max(0, parseInt(f.km, 10)) : 0,
    color: String(f.color || "").trim()
  };
  updateData({ ...state.data, cars: [...state.data.cars, car] });
  state.form = {};
  state.editingCarId = null;
  state.view = "dashboard";
  state.selectedCar = car.id;
  setToast("Vehículo añadido.", "success");
}
function startEditCar(id) {
  const car = getCarById(id);
  if (!car) return;
  state.editingCarId = id;
  state.form = {
    name: car.name || "",
    year: car.year || "",
    plate: car.plate || "",
    km: car.km || "",
    color: car.color || ""
  };
  state.view = "addCar";
  render();
}
function saveCarEdit() {
  const f = state.form;
  if (!state.editingCarId) return addCar();
  if (!f.name || !f.year || !f.plate) return setToast("Completa nombre, año y tablilla.", "error");
  const cars = state.data.cars.map(c => c.id === state.editingCarId ? {
    ...c,
    name: String(f.name).trim(),
    year: String(f.year).trim(),
    plate: String(f.plate).trim().toUpperCase(),
    km: Number.isFinite(Number(f.km)) ? Math.max(0, parseInt(f.km, 10)) : 0,
    color: String(f.color || "").trim()
  } : c);
  updateData({ ...state.data, cars });
  state.form = {};
  state.editingCarId = null;
  state.view = "dashboard";
  setToast("Vehículo actualizado.", "success");
}
function addLog() {
  const f = state.form;
  if (!f.carId || !f.type || !f.date || f.km === undefined || f.km === "") return setToast("Completa vehículo, tipo, fecha y kilometraje.", "error");
  const log = {
    id: uid(),
    carId: String(f.carId),
    type: String(f.type),
    date: String(f.date),
    km: Math.max(0, parseInt(f.km, 10)),
    cost: String(f.cost || "").trim(),
    shop: String(f.shop || "").trim(),
    notes: String(f.notes || "").trim()
  };
  const cars = state.data.cars.map(c => String(c.id) === String(f.carId) ? { ...c, km: Math.max(Number(c.km) || 0, Number(log.km) || 0) } : c);
  updateData({ cars, logs: [log, ...state.data.logs] });
  state.form = {};
  state.editingLogId = null;
  state.view = "history";
  setToast("Mantenimiento registrado.", "success");
}
function startEditLog(id) {
  const log = state.data.logs.find(l => l.id === id);
  if (!log) return;
  state.editingLogId = id;
  state.form = {
    carId: String(log.carId || ""),
    type: log.type || "",
    date: log.date || "",
    km: log.km || "",
    cost: log.cost || "",
    shop: log.shop || "",
    notes: log.notes || ""
  };
  state.view = log.type === "fuel" ? "fuel" : "addLog";
  render();
}
function saveLogEdit() {
  const f = state.form;
  if (!state.editingLogId) return addLog();
  if (!f.carId || !f.type || !f.date || f.km === undefined || f.km === "") return setToast("Completa vehículo, tipo, fecha y kilometraje.", "error");
  const logs = state.data.logs.map(l => l.id === state.editingLogId ? {
    ...l,
    carId: String(f.carId),
    type: String(f.type),
    date: String(f.date),
    km: Math.max(0, parseInt(f.km, 10)),
    cost: String(f.cost || "").trim(),
    shop: String(f.shop || "").trim(),
    notes: String(f.notes || "").trim()
  } : l);
  updateData({ ...state.data, logs });
  state.form = {};
  state.editingLogId = null;
  state.view = "history";
  setToast("Registro actualizado.", "success");
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
        <div class="small muted" style="margin-top:12px">Último: ${fmtDate(last.date)} · ${numFmt(last.km, "es-ES")} mi</div>
        ${type.interval ? `
          <div style="margin-top:8px" class="progress"><span style="width:${pct}%;background:${overdue ? "#ef4444" : dueSoon ? "#f59e0b" : type.color}"></span></div>
          <div class="small muted" style="margin-top:6px">${numFmt(since, "es-ES")} / ${numFmt(type.interval, "es-ES")} mi</div>
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
      <h1 style="text-align:center;margin:0 0 8px">AutoLog Secure</h1>
      <p class="muted" style="text-align:center;line-height:1.6;margin:0 0 24px">
        Registro de mantenimiento con modo local y sincronización en Google Drive.
      </p>
      ${state.authState === "error" ? `<div class="card" style="padding:12px 14px;border-color:#6f2626;background:#2a1010;color:#ffbaba;margin-bottom:18px">No se pudo conectar con Google Drive.</div>` : ""}
      <button id="sign-in-btn" class="btn btn-primary" style="width:100%;padding:14px 18px">Continuar con Google</button>
      <div style="display:flex;align-items:center;gap:12px;margin:18px 0;color:#666"><span style="height:1px;background:#252528;flex:1"></span><span class="small">o</span><span style="height:1px;background:#252528;flex:1"></span></div>
      <button id="local-btn" class="btn" style="width:100%">Usar sin cuenta</button>
      <p class="small muted" style="margin-top:18px;line-height:1.6">
        Registro de mantenimiento para tus vehículos con sincronización opcional en Google Drive.
      </p>
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
        ${mem.deferredInstallPrompt ? `<button id="install-app-btn" class="btn small btn-install">Instalar app</button>` : ""}
        <button id="backups-btn" class="btn small">Copias</button>
        ${state.storageMode === "drive" ? `<button id="sync-now-btn" class="btn small">Sincronizar</button>` : ""}
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
          <strong>AutoLog Secure</strong>
        </div>
        <div class="nav">
          ${navBtn("dashboard","Inicio")}
          ${navBtn("addCar","Nuevo")}
          ${navBtn("addLog","Registrar")}
          ${navBtn("fuel","Gasolina")}
          ${navBtn("reminders","Recordatorios")}
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
        <div class="small" style="margin-bottom:6px">• ${esc(o.type.label)} (${numFmt(o.miles, "en-US")} mi desde el último servicio)</div>
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
        Restan ${numFmt(next.remaining, "en-US")} mi
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
      <div class="small muted" style="margin-top:6px">${numFmt(latest.km, "en-US")} mi · ${esc(getTypeById(latest.type)?.label || latest.type)}</div>
    </div>
  `;
}
function renderRemindersView() {
  const items = getServiceReminderItems();
  const overdue = items.filter(i => i.status === "overdue");
  const soon = items.filter(i => i.status === "soon");
  const missing = items.filter(i => i.status === "missing");
  const ok = items.filter(i => i.status === "ok");

  const renderCard = (item) => `
    <div class="card reminder-card ${item.status}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="flex:1;min-width:220px">
          <div class="row" style="margin-bottom:6px">
            <strong>${esc(item.icon)} ${esc(item.typeLabel)}</strong>
            <span class="plate">${esc(item.plate)}</span>
          </div>
          <div class="small">${esc(item.carName)}</div>
          <div class="small muted" style="margin-top:6px">${esc(item.note || "")}</div>
          ${item.dueDate ? `<div class="small muted" style="margin-top:4px">Próximo: ${fmtDate(item.dueDate.toISOString().slice(0,10))}</div>` : ``}
        </div>
        <div class="reminder-badge ${item.status}">
          ${item.status === "overdue" ? `Vencido ${Math.abs(item.daysLeft)} d` :
            item.status === "soon" ? `En ${item.daysLeft} d` :
            item.status === "missing" ? "Sin datos" : "Al día"}
        </div>
      </div>
    </div>
  `;

  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:18px">
      <h2 style="margin:0">Recordatorios</h2>
      <div class="small muted">${numFmt(items.length, "en-US")} servicios evaluados</div>
    </div>

    <div class="reminder-summary">
      <div class="card stat-card">
        <div class="stat-label">Vencidos</div>
        <div class="stat-value">${numFmt(overdue.length, "en-US")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Próximos 30 días</div>
        <div class="stat-value">${numFmt(soon.length, "en-US")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Sin registro</div>
        <div class="stat-value">${numFmt(missing.length, "en-US")}</div>
      </div>
    </div>

    ${overdue.length ? `
      <div style="margin:20px 0 10px"><strong>Vencidos</strong></div>
      <div class="table">${overdue.map(renderCard).join("")}</div>
    ` : ``}

    ${soon.length ? `
      <div style="margin:20px 0 10px"><strong>Próximos</strong></div>
      <div class="table">${soon.map(renderCard).join("")}</div>
    ` : ``}

    ${missing.length ? `
      <div style="margin:20px 0 10px"><strong>Sin registro</strong></div>
      <div class="table">${missing.map(renderCard).join("")}</div>
    ` : ``}

    ${ok.length ? `
      <details class="card" style="padding:14px;margin-top:20px">
        <summary style="cursor:pointer"><strong>Ver servicios al día</strong> <span class="small muted">(${numFmt(ok.length, "en-US")})</span></summary>
        <div class="table" style="margin-top:12px">${ok.map(renderCard).join("")}</div>
      </details>
    ` : ``}
  `;
}

function renderBackupsView() {
  const backups = getLocalBackups();
  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:18px">
      <h2 style="margin:0">Copias locales automáticas</h2>
      <div class="row">
        <button class="btn" data-view="dashboard">Volver</button>
        ${backups.length ? `<button id="clear-backups-btn" class="btn btn-danger">Eliminar todas</button>` : ``}
      </div>
    </div>
    ${backups.length ? `
      <div class="table">
        ${backups.map((b, i) => `
          <div class="card entry">
            <div style="flex:1;min-width:220px">
              <div class="row" style="justify-content:space-between;align-items:center">
                <strong>Copia ${i + 1}</strong>
                <span class="small muted">${esc(new Date(b.createdAt).toLocaleString("es-PR"))}</span>
              </div>
              <div class="small muted" style="margin-top:8px">
                Motivo: ${esc(b.reason || "backup")} · ${numFmt(b.data?.cars?.length || 0, "en-US")} veh. · ${numFmt(b.data?.logs?.length || 0, "en-US")} registros
              </div>
            </div>
            <div class="row">
              <button class="btn" data-restore-backup="${i}">Restaurar</button>
            </div>
          </div>
        `).join("")}
      </div>
    ` : `
      <div class="card empty">
        No hay copias locales guardadas.
      </div>
    `}
  `;
}
function renderCostPanel(car) {
  const total = getVehicleTotalCost(car.id);
  const yearTotal = getVehicleYearCost(car.id);
  return `
    <div class="dashboard-duo">
      <div class="card stat-card">
        <div class="stat-label">💲 Costo acumulado</div>
        <div class="stat-value">$${numFmt(total, "en-US")}</div>
        <div class="small muted">Total registrado para este vehículo</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">📆 Costo este año</div>
        <div class="stat-value">$${numFmt(yearTotal, "en-US")}</div>
        <div class="small muted">Mantenimientos del año actual</div>
      </div>
    </div>
  `;
}
function renderDateUpcomingPanel(car) {
  const items = getDateBasedUpcomingServices(car);
  if (!items.length) return "";
  return `
    <div class="card" style="padding:18px;margin-bottom:20px">
      <div style="font-weight:700;margin-bottom:10px">📅 Próximos servicios por fecha</div>
      <div class="table">
        ${items.map(item => `
          <div class="date-row">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div><strong>${item.icon} ${esc(item.label)}</strong></div>
              <div class="small ${item.diffDays < 0 ? "danger-text" : "muted"}">
                ${item.diffDays < 0 ? `Vencido hace ${Math.abs(item.diffDays)} días` : `En ${item.diffDays} días`}
              </div>
            </div>
            <div class="small muted" style="margin-top:6px">
              Último: ${fmtDate(item.last.date)} · Próximo: ${fmtDate(item.due.toISOString().slice(0,10))}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderFuelDashboardPanel(car) {
  const stats = calculateFuelStats(car.id);
  const monthly = getFuelMonthlyStats(car.id);
  const latest = getLatestFuelLog(car.id);
  if (!stats && !monthly.count && !latest) return "";
  return `
    <div class="card fuel-panel">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:700">⛽ Combustible</div>
        <div class="small muted">${monthly.count ? `${monthly.count} registros este mes` : "Sin recargas este mes"}</div>
      </div>
      <div class="fuel-grid">
        <div class="fuel-box">
          <div class="stat-label">Gasto mensual</div>
          <div class="stat-value">$${numFmt(monthly.cost, "en-US")}</div>
        </div>
        <div class="fuel-box">
          <div class="stat-label">Galones este mes</div>
          <div class="stat-value">${numFmt(monthly.gallons, "en-US")}</div>
        </div>
        <div class="fuel-box">
          <div class="stat-label">MPG promedio</div>
          <div class="stat-value">${stats ? stats.mpg.toFixed(1) : "-"}</div>
        </div>
        <div class="fuel-box">
          <div class="stat-label">Costo por milla</div>
          <div class="stat-value">${stats ? `$${stats.costPerMile.toFixed(2)}` : "-"}</div>
        </div>
      </div>
      ${latest ? `<div class="fuel-latest small muted">Última recarga: ${fmtDate(latest.date)} · ${numFmt(latest.gallons || 0, "en-US")} gal · $${numFmt(latest.pricePerGallon || 0, "en-US")}/gal</div>` : ``}
    </div>
  `;
}

function saveFuelEntry() {
  const carId = state.selectedCar || state.data.cars[0]?.id;
  if (!carId) return setToast("Primero añade un vehículo.", "error");
  const date = $("#fuel-date")?.value || "";
  const km = $("#fuel-km")?.value || "";
  const gallons = $("#fuel-gallons")?.value || "";
  const pricePerGallon = $("#fuel-price")?.value || "";
  const cost = $("#fuel-cost")?.value || "";
  const notes = $("#fuel-notes")?.value || "";
  const fullTank = ($("#fuel-fullTank")?.value || "yes") === "yes";
  if (!date || !km || !gallons) return setToast("Completa fecha, millas y galones.", "error");

  const log = {
    id: state.editingLogId || uid(),
    carId: String(carId),
    type: "fuel",
    date: String(date),
    km: Math.max(0, parseInt(km, 10)),
    cost: String(cost || "").trim(),
    shop: "",
    notes: String(notes || "").trim(),
    gallons: Number.isFinite(Number(gallons)) ? Number(gallons) : 0,
    pricePerGallon: Number.isFinite(Number(pricePerGallon)) ? Number(pricePerGallon) : 0,
    fullTank
  };
  if (!log.cost && log.gallons && log.pricePerGallon) {
    log.cost = `$${(log.gallons * log.pricePerGallon).toFixed(2)}`;
  }
  const cars = state.data.cars.map(c => String(c.id) === String(carId) ? { ...c, km: Math.max(Number(c.km) || 0, Number(log.km) || 0) } : c);
  const logs = state.editingLogId
    ? state.data.logs.map(l => l.id === state.editingLogId ? { ...l, ...log } : l)
    : [log, ...state.data.logs];
  updateData({ cars, logs });
  state.editingLogId = null;
  state.view = "fuel";
  render();
  setToast(log.id === state.editingLogId ? "Recarga actualizada." : "Recarga registrada.", "success");
}

function renderFuelView() {
  if (!state.data.cars.length) {
    return `<div class="card empty"><p>Primero debes añadir un vehículo.</p><div style="margin-top:16px"><button class="btn btn-primary" data-view="addCar">Añadir vehículo</button></div></div>`;
  }
  const car = selectedDashboardCar();
  const fuelLogs = state.data.logs.filter(l => l.type === "fuel" && String(l.carId) === String(car?.id)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const chartData = getFuelChartData(car?.id);
  const maxMpg = Math.max(...chartData.map(p => p.mpg), 1);

  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:18px">
      <h2 style="margin:0">Gasolina</h2>
      <div class="row">
        ${state.data.cars.map(c => `<button class="btn ${String(car?.id) === String(c.id) ? "btn-primary" : ""}" data-select-car="${c.id}">${esc(c.name)} ${esc(c.year)}</button>`).join("")}
      </div>
    </div>

    <div class="card fuel-entry-card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:14px">
        <strong>Registrar recarga</strong>
        <span class="small muted">${esc(car?.name || "")}</span>
      </div>
      <div class="grid-3">
        ${field("Fecha *", `<input class="input" id="fuel-date" type="date" value="${esc(state.form.date || "")}">`)}
        ${field("Millas *", `<input class="input" id="fuel-km" type="number" value="${esc(state.form.km || car?.km || "")}">`)}
        ${field("Galones *", `<input class="input" id="fuel-gallons" type="number" step="0.01" value="${esc(state.form.gallons || "")}">`)}
      </div>
      <div class="grid-3">
        ${field("Precio por galón", `<input class="input" id="fuel-price" type="number" step="0.01" value="${esc(state.form.pricePerGallon || "")}">`)}
        ${field("Costo total", `<input class="input" id="fuel-cost" value="${esc(state.form.cost || "")}">`)}
        ${field("Tanque lleno", `<select class="select" id="fuel-fullTank"><option value="yes" ${state.form.fullTank !== false ? "selected" : ""}>Sí</option><option value="no" ${state.form.fullTank === false ? "selected" : ""}>No</option></select>`)}
      </div>
      ${field("Notas", `<textarea class="textarea" id="fuel-notes">${esc(state.form.notes || "")}</textarea>`)}
      <div style="margin-top:16px"><button id="save-fuel-btn" class="btn btn-primary">${state.editingLogId ? "Guardar cambios" : "Guardar recarga"}</button></div>
    </div>

    <div class="card fuel-chart-card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
        <strong>MPG reciente</strong>
        <span class="small muted">${chartData.length ? "Últimas recargas llenas" : "Aún no hay suficientes datos"}</span>
      </div>
      ${chartData.length ? `<div class="fuel-chart">${chartData.map(point => `<div class="fuel-bar-wrap"><div class="fuel-bar" style="height:${Math.max(16, (point.mpg / maxMpg) * 140)}px"></div><div class="fuel-bar-label">${point.mpg.toFixed(1)}</div><div class="fuel-bar-date">${esc(fmtDate(point.date))}</div></div>`).join("")}</div>` : `<div class="small muted">Registra al menos dos recargas con tanque lleno para ver el gráfico.</div>`}
    </div>

    ${renderFuelDashboardPanel(car)}

    <div class="row" style="justify-content:space-between;align-items:center;margin:20px 0 12px">
      <strong>Historial de combustible</strong>
      <span class="small muted">${numFmt(fuelLogs.length, "en-US")} registros</span>
    </div>

    ${fuelLogs.length ? `<div class="table">${fuelLogs.map(log => `<div class="card entry"><div style="flex:1;min-width:220px"><div class="row" style="justify-content:space-between;align-items:center"><strong>${fmtDate(log.date)}</strong><span class="small muted">${numFmt(log.km, "en-US")} mi</span></div><div class="small muted" style="margin-top:8px">⛽ ${numFmt(log.gallons || 0, "en-US")} gal · $${numFmt(log.pricePerGallon || 0, "en-US")}/gal ${log.fullTank ? "· tanque lleno" : ""}</div>${log.cost ? `<div class="small muted" style="margin-top:6px">Total: ${esc(log.cost)}</div>` : ""}${log.notes ? `<div class="small muted" style="margin-top:6px">📝 ${esc(log.notes)}</div>` : ""}</div><div class="row"><button class="btn btn-danger" data-delete-log="${log.id}">Eliminar</button></div></div>`).join("")}</div>` : `<div class="card empty">No hay recargas registradas todavía.</div>`}
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
    ${car ? renderDateUpcomingPanel(car) : ""}
    ${car ? renderCostPanel(car) : ""}
    ${car ? renderFuelDashboardPanel(car) : ""}
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
            <div class="km">${numFmt(car.km, "es-ES")} <span class="small muted">mi</span></div>
          </div>
        </div>
        <div class="row" style="margin-top:18px">
          <button class="btn btn-primary" id="quick-log-btn">Registrar mantenimiento</button>
          <button class="btn" id="edit-car-btn">Editar vehículo</button>
          <details class="danger-menu">
            <summary class="btn btn-danger subtle-danger">Más</summary>
            <div class="danger-pop">
              <button class="btn btn-danger" id="delete-car-btn">Eliminar vehículo</button>
            </div>
          </details>
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
      <h2>${state.editingCarId ? "Editar vehículo" : "Nuevo vehículo"}</h2>
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
            <button id="save-car-btn" class="btn btn-primary">${state.editingCarId ? "Guardar cambios" : "Añadir vehículo"}</button>
            <button id="cancel-car-btn" class="btn" data-view="dashboard">Cancelar</button>
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
      <h2>${state.editingLogId ? "Editar mantenimiento" : "Registrar mantenimiento"}</h2>
      <div class="card" style="padding:24px">
        <div class="col">
          ${field("Vehículo *", `<select class="select" id="log-carId">
            <option value="">Seleccionar…</option>
            ${state.data.cars.map(c => `<option value="${c.id}" ${String(f.carId || "") === String(c.id) ? "selected" : ""}>${esc(c.name)} ${esc(c.year)} — ${esc(c.plate)}</option>`).join("")}
          </select>`)}
          ${field("Tipo de mantenimiento *", `<select class="select" id="log-type">
            <option value="">Seleccionar…</option>
            ${TYPES.filter(t => t.id !== "fuel").map(t => `<option value="${t.id}" ${f.type === t.id ? "selected" : ""}>${esc(t.icon)} ${esc(t.label)}</option>`).join("")}
          </select>`)}
          ${f.type ? `<div class="small muted">Sugerido: ${(() => { const rec = getRecommendedDefaults(f.type); return `${rec.interval ? numFmt(rec.interval, "en-US") + " mi" : "sin intervalo"}${rec.months ? " o " + rec.months + " meses" : ""}`; })()}</div>` : ``}
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
            <button id="save-log-btn" class="btn btn-primary">${state.editingLogId ? "Guardar cambios" : "Guardar registro"}</button>
            <button id="cancel-log-btn" class="btn" data-view="history">Cancelar</button>
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
                    📅 ${fmtDate(log.date)} · 🛣️ ${numFmt(log.km, "es-ES")} mi
                    ${log.shop ? ` · 🔧 ${esc(log.shop)}` : ""}
                    ${log.cost ? ` · 💲 ${esc(log.cost)}` : ""}
                  </div>
                  ${log.type === "fuel" ? `<div class="small muted" style="margin-top:6px">⛽ ${numFmt(log.gallons || 0, "en-US")} gal · $${numFmt(log.pricePerGallon || 0, "en-US")}/gal ${log.fullTank ? "· tanque lleno" : ""}</div>` : ""}
                  ${log.notes ? `<div class="small muted" style="margin-top:6px">📝 ${esc(log.notes)}</div>` : ""}
                </div>
              </div>
              <div class="row">
                ${car ? `<span class="small muted">${esc(car.name)} ${esc(car.year)}</span>` : ""}
                <button class="btn" data-edit-log="${log.id}">Editar</button>
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
  let body = "";
  if (state.view === "dashboard") body = renderDashboard();
  if (state.view === "addCar") body = renderAddCar();
  if (state.view === "addLog") body = renderAddLog();
  if (state.view === "fuel") body = renderFuelView();
  if (state.view === "reminders") body = renderRemindersView();
  if (state.view === "history") body = renderHistory();
  if (state.view === "backups") body = renderBackupsView();
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
    app.innerHTML = `<div class="login"><div class="card login-card"><h2>Error cargando la app</h2><p class="muted">Se produjo un error al renderizar.</p><p class="small muted" style="word-break:break-word">${String(err && err.message ? err.message : err)}</p><div style="margin-top:16px"><button id="local-btn" class="btn" style="width:100%">Usar sin cuenta</button></div></div></div>`;
    bindEvents();
  }
}
function bindEvents() {
  $("#sign-in-btn")?.addEventListener("click", signIn);
  $("#local-btn")?.addEventListener("click", () => {
    stopDrivePolling();
    state.authState = "authed";
    state.storageMode = "local";
    render();
    setToast("Modo local activado.", "warn");
  });
  $("#install-app-btn")?.addEventListener("click", () => { void installPWA(); });
  $("#backups-btn")?.addEventListener("click", () => { state.view = "backups"; render(); });
  $("#reconnect-btn")?.addEventListener("click", signIn);
  $("#sync-now-btn")?.addEventListener("click", () => { void checkRemoteChanges({ reload: true }); void saveDriveNow(); });
  $("#sign-out-btn")?.addEventListener("click", signOut);
  $("#clear-backups-btn")?.addEventListener("click", clearAllBackups);
  document.querySelectorAll("[data-restore-backup]").forEach(el => el.addEventListener("click", () => {
    restoreBackupByIndex(Number(el.getAttribute("data-restore-backup")));
  }));
  $("#save-fuel-btn")?.addEventListener("click", saveFuelEntry);
  $("#fuel-gallons")?.addEventListener("input", () => {
    const gallons = Number($("#fuel-gallons")?.value || 0);
    const price = Number($("#fuel-price")?.value || 0);
    if (gallons && price) $("#fuel-cost").value = `$${(gallons * price).toFixed(2)}`;
  });
  $("#fuel-price")?.addEventListener("input", () => {
    const gallons = Number($("#fuel-gallons")?.value || 0);
    const price = Number($("#fuel-price")?.value || 0);
    if (gallons && price) $("#fuel-cost").value = `$${(gallons * price).toFixed(2)}`;
  });
  $("#export-btn")?.addEventListener("click", exportBackup);
  $("#import-input")?.addEventListener("change", e => importBackup(e.target.files?.[0]));
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => {
    state.view = el.getAttribute("data-view");
    if (state.view !== "addCar") state.editingCarId = null;
    if (state.view !== "addLog" && state.view !== "fuel") state.editingLogId = null;
    if (state.view !== "addCar" && state.view !== "addLog" && state.view !== "fuel") state.form = {};
    render();
  }));
  document.querySelectorAll("[data-select-car]").forEach(el => el.addEventListener("click", () => {
    state.selectedCar = Number(el.getAttribute("data-select-car"));
    render();
  }));
  $("#quick-log-btn")?.addEventListener("click", () => {
    const car = selectedDashboardCar();
    state.editingLogId = null;
    state.form = { carId: String(car?.id || "") };
    state.view = "addLog";
    render();
  });
  $("#edit-car-btn")?.addEventListener("click", () => {
    const car = selectedDashboardCar();
    if (car) startEditCar(car.id);
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
      km: $("#car-km")?.value || "",
      color: $("#car-color")?.value || "",
    };
    state.editingCarId ? saveCarEdit() : addCar();
  });
  $("#save-log-btn")?.addEventListener("click", () => {
    state.form = {
      carId: $("#log-carId")?.value || "",
      type: $("#log-type")?.value || "",
      date: $("#log-date")?.value || "",
      km: $("#log-km")?.value || "",
      cost: $("#log-cost")?.value || "",
      shop: $("#log-shop")?.value || "",
      notes: $("#log-notes")?.value || "",
    };
    state.editingLogId ? saveLogEdit() : addLog();
  });
  document.querySelectorAll("[data-edit-log]").forEach(el => el.addEventListener("click", () => {
    startEditLog(Number(el.getAttribute("data-edit-log")));
  }));
  $("#filter-car")?.addEventListener("change", e => { state.filterCar = e.target.value; render(); });
  $("#filter-type")?.addEventListener("change", e => { state.filterType = e.target.value; render(); });
  document.querySelectorAll("[data-delete-log]").forEach(el => el.addEventListener("click", () => {
    deleteLog(Number(el.getAttribute("data-delete-log")));
  }));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  mem.deferredInstallPrompt = event;
  render();
});

window.addEventListener("appinstalled", () => {
  mem.deferredInstallPrompt = null;
  render();
  setToast("AutoLog se instaló correctamente.", "success");
});

window.addEventListener("beforeunload", () => {
  if (mem.saveTimer) clearTimeout(mem.saveTimer);
});

render();
initGIS();
