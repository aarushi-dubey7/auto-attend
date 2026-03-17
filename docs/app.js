const REQUIRED_SERVICE_UUID = "0000181c-0000-1000-8000-00805f9b34fb";
const DEFAULT_SUPABASE_URL = "https://owwgynnsjwcltoxmkcfl.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_P8f4keTbxpm8M5JnjQOYVA_EBjPDKWG";

const el = {
  capabilityStatus: document.querySelector("#capabilityStatus"),
  studentEmail: document.querySelector("#studentEmail"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseKey: document.querySelector("#supabaseKey"),
  scheduleTable: document.querySelector("#scheduleTable"),
  roomsTable: document.querySelector("#roomsTable"),
  attendanceTable: document.querySelector("#attendanceTable"),
  checkInBtn: document.querySelector("#checkInBtn"),
  resultBanner: document.querySelector("#resultBanner"),
  eventLog: document.querySelector("#eventLog"),
};

const STORAGE_KEY = "auto-attend-checkin-config";

function nowStamp() {
  return new Date().toISOString();
}

function currentLocalTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function appendLog(message, level = "neutral") {
  const item = document.createElement("li");
  item.className = level === "error" ? "error" : level === "ok" ? "ok" : "";
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.eventLog.prepend(item);

  while (el.eventLog.children.length > 80) {
    el.eventLog.removeChild(el.eventLog.lastChild);
  }
}

function setBanner(message, level = "neutral") {
  el.resultBanner.textContent = message;
  el.resultBanner.className = `result-banner ${level}`;
}

function setCapabilityStatus(message, level = "neutral") {
  el.capabilityStatus.textContent = message;
  el.capabilityStatus.className = `status-pill ${level}`;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensureBrowserSupport() {
  if (!window.isSecureContext) {
    setCapabilityStatus("Not secure context. Use HTTPS or localhost.", "error");
    throw new Error("Web Bluetooth requires HTTPS or localhost");
  }

  if (!("bluetooth" in navigator)) {
    setCapabilityStatus("Web Bluetooth unsupported in this browser.", "error");
    throw new Error("Web Bluetooth API unavailable");
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setCapabilityStatus("Supabase client library failed to load.", "error");
    throw new Error("Supabase JS not loaded");
  }

  setCapabilityStatus("Browser supports secure Web Bluetooth flow.", "ok");
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    if (saved.supabaseUrl) {
      el.supabaseUrl.value = saved.supabaseUrl;
    }
    if (saved.supabaseKey) {
      el.supabaseKey.value = saved.supabaseKey;
    }
    if (saved.scheduleTable) {
      el.scheduleTable.value = saved.scheduleTable;
    }
    if (saved.roomsTable) {
      el.roomsTable.value = saved.roomsTable;
    }
    if (saved.attendanceTable) {
      el.attendanceTable.value = saved.attendanceTable;
    }
    if (saved.studentEmail) {
      el.studentEmail.value = saved.studentEmail;
    }
  } catch (error) {
    appendLog(`Could not restore saved config: ${error.message}`, "error");
  }
}

function saveConfig() {
  const payload = {
    supabaseUrl: el.supabaseUrl.value.trim(),
    supabaseKey: el.supabaseKey.value.trim(),
    scheduleTable: el.scheduleTable.value.trim() || "schedule",
    roomsTable: el.roomsTable.value.trim() || "rooms",
    attendanceTable: el.attendanceTable.value.trim() || "attendance_log",
    studentEmail: normalizeEmail(el.studentEmail.value),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function buildSupabaseClient(url, key) {
  return window.supabase.createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function requestTeacherDevice() {
  appendLog(`Opening BLE selector for service UUID ${REQUIRED_SERVICE_UUID}...`);
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [REQUIRED_SERVICE_UUID] }],
    optionalServices: [REQUIRED_SERVICE_UUID],
  });
}

async function fetchRoomByBeacon(client, table) {
  const { data, error } = await client
    .from(table)
    .select("id, room_name, beacon_uuid")
    .eq("beacon_uuid", REQUIRED_SERVICE_UUID)
    .limit(1);

  if (error) {
    throw new Error(`Room lookup failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}

async function fetchSchedulePermission(client, table, studentEmail) {
  const timeNow = currentLocalTime();

  const { data, error } = await client
    .from(table)
    .select("id, student_email, room_beacon_id, start_time")
    .eq("student_email", studentEmail)
    .eq("room_beacon_id", REQUIRED_SERVICE_UUID)
    .lte("start_time", timeNow)
    .order("start_time", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Schedule lookup failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}

async function insertAttendance(client, table, studentEmail, roomName) {
  const payload = {
    student_email: studentEmail,
    room_name: roomName,
    status: "Present",
  };

  const { error } = await client.from(table).insert(payload);

  if (error) {
    throw new Error(`Attendance insert failed: ${error.message}`);
  }
}

async function runCheckIn() {
  ensureBrowserSupport();

  const studentEmail = normalizeEmail(el.studentEmail.value);
  const supabaseUrl = el.supabaseUrl.value.trim() || DEFAULT_SUPABASE_URL;
  const supabaseKey = el.supabaseKey.value.trim() || DEFAULT_SUPABASE_ANON_KEY;
  const scheduleTable = el.scheduleTable.value.trim() || "schedule";
  const roomsTable = el.roomsTable.value.trim() || "rooms";
  const attendanceTable = el.attendanceTable.value.trim() || "attendance_log";

  if (!isValidEmail(studentEmail)) {
    throw new Error("Enter a valid student email before check-in");
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Enter SUPABASE_URL and SUPABASE_ANON_KEY");
  }

  const client = buildSupabaseClient(supabaseUrl, supabaseKey);

  const teacherDevice = await requestTeacherDevice();
  appendLog(`BLE device selected: ${teacherDevice.name || "Unnamed"} (${teacherDevice.id})`, "ok");

  appendLog(`Verifying beacon registry in ${roomsTable}...`);
  const room = await fetchRoomByBeacon(client, roomsTable);
  if (!room) {
    setBanner("Beacon UUID not found in rooms registry.", "warn");
    appendLog("No matching row in rooms table for required beacon_uuid.", "error");
    return;
  }

  appendLog(`Beacon maps to ${room.room_name}. Checking schedule permissions...`, "ok");
  const schedule = await fetchSchedulePermission(client, scheduleTable, studentEmail);

  if (!schedule) {
    setBanner("No schedule match for this email and beacon at current time.", "warn");
    appendLog("Schedule row missing for student_email + room_beacon_id + start_time <= now.", "error");
    return;
  }

  appendLog(`Schedule match found (${schedule.id}). Inserting attendance_log row...`, "ok");
  await insertAttendance(client, attendanceTable, studentEmail, room.room_name);

  setBanner("Check in successful. attendance_log updated.", "ok");
  appendLog("Attendance row inserted successfully.", "ok");
  saveConfig();
}

async function onCheckInClick() {
  el.checkInBtn.disabled = true;
  setBanner("Running BLE check-in...", "neutral");

  try {
    await runCheckIn();
  } catch (error) {
    if (error?.name === "NotFoundError") {
      setBanner("Bluetooth device selection cancelled.", "warn");
      appendLog("BLE picker closed before selecting a device.", "error");
    } else {
      setBanner(error.message || "Check in failed", "error");
      appendLog(error.message || "Unknown error", "error");
    }
  } finally {
    el.checkInBtn.disabled = false;
  }
}

function start() {
  loadSavedConfig();

  el.supabaseUrl.value = DEFAULT_SUPABASE_URL;
  el.supabaseKey.value = DEFAULT_SUPABASE_ANON_KEY;

  try {
    ensureBrowserSupport();
    appendLog("App initialized. Ready for check-in.", "ok");
  } catch (error) {
    appendLog(error.message, "error");
  }

  el.checkInBtn.addEventListener("click", onCheckInClick);
}

start();
