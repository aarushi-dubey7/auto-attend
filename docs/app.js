const REQUIRED_SERVICE_UUID = "0000181c-0000-1000-8000-00805f9b34fb";

const el = {
  capabilityStatus: document.querySelector("#capabilityStatus"),
  studentEmail: document.querySelector("#studentEmail"),
  studentName: document.querySelector("#studentName"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseKey: document.querySelector("#supabaseKey"),
  scheduleTable: document.querySelector("#scheduleTable"),
  attendanceTable: document.querySelector("#attendanceTable"),
  checkInBtn: document.querySelector("#checkInBtn"),
  resultBanner: document.querySelector("#resultBanner"),
  eventLog: document.querySelector("#eventLog"),
};

const STORAGE_KEY = "auto-attend-checkin-config";

function nowStamp() {
  return new Date().toISOString();
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
    if (saved.attendanceTable) {
      el.attendanceTable.value = saved.attendanceTable;
    }
    if (saved.studentEmail) {
      el.studentEmail.value = saved.studentEmail;
    }
    if (saved.studentName) {
      el.studentName.value = saved.studentName;
    }
  } catch (error) {
    appendLog(`Could not restore saved config: ${error.message}`, "error");
  }
}

function saveConfig() {
  const payload = {
    supabaseUrl: el.supabaseUrl.value.trim(),
    supabaseKey: el.supabaseKey.value.trim(),
    scheduleTable: el.scheduleTable.value.trim() || "student_schedule",
    attendanceTable: el.attendanceTable.value.trim() || "attendance_log",
    studentEmail: normalizeEmail(el.studentEmail.value),
    studentName: el.studentName.value.trim(),
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

async function fetchCurrentSchedule(client, table, studentEmail) {
  const nowIso = nowStamp();

  const { data, error } = await client
    .from(table)
    .select("id, student_email, service_uuid, classroom_label, starts_at, ends_at")
    .eq("student_email", studentEmail)
    .eq("service_uuid", REQUIRED_SERVICE_UUID)
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Schedule lookup failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}

async function insertAttendance(client, table, schedule, studentEmail, studentName, device) {
  const payload = {
    schedule_id: schedule.id,
    student_email: studentEmail,
    student_name: studentName || null,
    service_uuid: REQUIRED_SERVICE_UUID,
    classroom_label: schedule.classroom_label || null,
    teacher_device_id: device.id || null,
    teacher_device_name: device.name || "Unknown BLE Device",
    checked_in_at: nowStamp(),
    source: "github-pages-web-bluetooth",
  };

  const { error } = await client.from(table).insert(payload);

  if (error) {
    throw new Error(`Attendance insert failed: ${error.message}`);
  }
}

async function runCheckIn() {
  ensureBrowserSupport();

  const studentEmail = normalizeEmail(el.studentEmail.value);
  const studentName = el.studentName.value.trim();
  const supabaseUrl = el.supabaseUrl.value.trim();
  const supabaseKey = el.supabaseKey.value.trim();
  const scheduleTable = el.scheduleTable.value.trim() || "student_schedule";
  const attendanceTable = el.attendanceTable.value.trim() || "attendance_log";

  if (!isValidEmail(studentEmail)) {
    throw new Error("Enter a valid student email before check-in");
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Enter SUPABASE_URL and publishable key");
  }

  const client = buildSupabaseClient(supabaseUrl, supabaseKey);

  const teacherDevice = await requestTeacherDevice();
  appendLog(`BLE device selected: ${teacherDevice.name || "Unnamed"} (${teacherDevice.id})`, "ok");

  appendLog(`Checking schedule for ${studentEmail} against UUID ${REQUIRED_SERVICE_UUID}...`);
  const schedule = await fetchCurrentSchedule(client, scheduleTable, studentEmail);

  if (!schedule) {
    setBanner("No active schedule match for this student and UUID.", "warn");
    appendLog("Supabase returned no active schedule row. Check table data or time window.", "error");
    return;
  }

  appendLog(`Schedule match found (${schedule.id}). Inserting attendance_log row...`, "ok");
  await insertAttendance(client, attendanceTable, schedule, studentEmail, studentName, teacherDevice);

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

  try {
    ensureBrowserSupport();
    appendLog("App initialized. Ready for check-in.", "ok");
  } catch (error) {
    appendLog(error.message, "error");
  }

  el.checkInBtn.addEventListener("click", onCheckInClick);
}

start();
