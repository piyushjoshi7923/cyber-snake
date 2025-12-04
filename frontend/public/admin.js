// ===============================
//   ADMIN DASHBOARD FRONTEND JS
// ===============================

console.log("admin.js v5 loaded");

const socket = io();

// DOM references
const leaderboardBody = document.querySelector("#leaderboardTable tbody");
const answersLogDiv = document.getElementById("answersLog");

const currentEventNameSpan = document.getElementById("currentEventName");
const eventsTableBody = document.querySelector("#eventsTable tbody");
const newEventNameInput = document.getElementById("newEventName");
const createEventBtn = document.getElementById("createEventBtn");

// History / export controls
const historyEventSelect = document.getElementById("historyEventSelect");
const viewHistoryBtn = document.getElementById("viewHistoryBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const historySearchInput = document.getElementById("historySearch");
const historyTableBody = document.querySelector("#historyTable tbody");

// Local cache for history
let historyRawPlayers = [];

// -------------------------------
//  Helper: Log text in Latest Answers
// -------------------------------
function addLog(text) {
  const p = document.createElement("p");
  p.textContent = text;
  answersLogDiv.prepend(p);
}

// -------------------------------
//  Helper: Render leaderboard
// -------------------------------
function renderLeaderboard(list) {
  leaderboardBody.innerHTML = "";

  list.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.rank}</td>
      <td>${p.name}</td>
      <td>${p.org}</td>
      <td>${p.designation}</td>
      <td>${p.score}</td>
      <td>${p.finished ? "Yes" : "No"}</td>
    `;
    leaderboardBody.appendChild(tr);
  });
}

// -------------------------------
//  Helper: Render All Events table + history dropdown
// -------------------------------
function renderEvents(data) {
  currentEventNameSpan.textContent =
    data.currentEventName || "(no active event)";

  // Events table
  eventsTableBody.innerHTML = "";
  (data.events || []).forEach((ev) => {
    const tr = document.createElement("tr");
    const createdStr = new Date(ev.created_at).toLocaleString();

    tr.innerHTML = `
      <td>${ev.id}</td>
      <td>${ev.name}</td>
      <td>${createdStr}</td>
      <td>
        <button data-id="${ev.id}"
                class="primary-btn"
                style="padding:2px 8px;font-size:0.8rem;">
          Delete
        </button>
      </td>
    `;
    eventsTableBody.appendChild(tr);
  });

  // Delete handlers – HTTP DELETE route
  eventsTableBody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-id"));
      if (!id) return;

      console.log("Delete button clicked for event", id);
      alert(`Deleting event ID ${id} (debug)`);

      if (
        !confirm(
          "Delete this event and all its players/answers from database?"
        )
      ) {
        return;
      }

      try {
        const resp = await fetch(`/api/events/${id}`, {
          method: "DELETE",
        });
        console.log("DELETE /api/events response status:", resp.status);
        let json = {};
        try {
          json = await resp.json();
        } catch (e) {
          console.error("Error parsing JSON from DELETE:", e);
        }

        if (resp.ok && json && json.ok) {
          addLog(`🗑️ Event ${id} deleted`);
          requestEventInfo(); // refresh UI
        } else {
          alert("Error deleting event (server). Check backend console.");
          addLog("❌ Error deleting event (server).");
        }
      } catch (e) {
        console.error(e);
        alert("Error deleting event (network).");
        addLog("❌ Error deleting event (network).");
      }
    });
  });

  // History dropdown
  historyEventSelect.innerHTML = "";
  (data.events || []).forEach((ev) => {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = `${ev.id} – ${ev.name}`;
    historyEventSelect.appendChild(opt);
  });
}

// -------------------------------
//  Request event info on load
// -------------------------------
function requestEventInfo() {
  socket.emit("getEventInfo", (data) => {
    if (data.error) {
      addLog("❌ Error loading event info.");
      return;
    }

    renderEvents(data);
    renderLeaderboard(data.leaderboard || []);
  });
}

// Initial load
requestEventInfo();

// -------------------------------
//  Create New Event
// -------------------------------
createEventBtn.addEventListener("click", () => {
  const name = newEventNameInput.value.trim();
  if (!name) {
    alert("Please enter a valid event name.");
    return;
  }

  socket.emit("createEvent", { name }, (res) => {
    if (res.error === "no_name") {
      alert("Event name cannot be empty.");
      return;
    }
    if (res.error) {
      alert("Error creating event.");
      return;
    }

    addLog(`✨ New event created: ${res.currentEventName}`);
    newEventNameInput.value = "";
    requestEventInfo();
  });
});

// -------------------------------
//  Event history viewer
// -------------------------------
function renderHistoryTable(players) {
  historyTableBody.innerHTML = "";
  players.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.org}</td>
      <td>${p.designation}</td>
      <td>${p.score}</td>
      <td>${p.finished ? "Yes" : "No"}</td>
    `;
    historyTableBody.appendChild(tr);
  });
}

viewHistoryBtn.addEventListener("click", () => {
  const eventId = Number(historyEventSelect.value);
  if (!eventId) {
    alert("No event selected.");
    return;
  }

  socket.emit("getEventResults", { eventId }, (res) => {
    if (res.error) {
      alert("Error loading event results.");
      addLog("❌ Error loading event results.");
      return;
    }

    historyRawPlayers = res.players || [];
    renderHistoryTable(historyRawPlayers);
    historySearchInput.value = "";
    addLog(`📄 Viewing history for event ${eventId}`);
  });
});

// Search in history table
historySearchInput.addEventListener("input", () => {
  const q = historySearchInput.value.trim().toLowerCase();
  if (!q) {
    renderHistoryTable(historyRawPlayers);
    return;
  }

  const filtered = historyRawPlayers.filter((p) => {
    return (
      p.name.toLowerCase().includes(q) ||
      p.org.toLowerCase().includes(q) ||
      p.designation.toLowerCase().includes(q)
    );
  });

  renderHistoryTable(filtered);
});

// -------------------------------
//  Download CSV / Excel
// -------------------------------
downloadCsvBtn.addEventListener("click", () => {
  const eventId = Number(historyEventSelect.value);
  if (!eventId) {
    alert("No event selected.");
    return;
  }

  window.location.href = `/api/events/${eventId}/export.csv`;
});

// -------------------------------
//  Live updates from backend
// -------------------------------
socket.on("adminUpdate", (payload) => {
  // Leaderboard refresh
  if (payload.leaderboard) {
    renderLeaderboard(payload.leaderboard);
  }

  // Event changed (new / delete / switch)
  if (payload.type === "eventChanged") {
    currentEventNameSpan.textContent =
      payload.currentEventName || "(no active event)";
    renderLeaderboard(payload.leaderboard || []);
    addLog("🔄 Event changed. Leaderboard reset.");
    requestEventInfo();
    return;
  }

  // Player joined
  if (payload.type === "playerRegistered") {
    const p = payload.player;
    addLog(`👤 Player joined: ${p.name} (${p.designation}, ${p.org})`);
  }

  // Answer logged
  if (payload.type === "answer") {
    const p = payload.player;
    const a = payload.lastAnswer;

    addLog(
      `Q${a.qIndex + 1} → ${p.name}: "${a.chosenOption}" · ${
        a.correct ? "✔ Correct" : "✖ Wrong"
      } · Score: ${p.score}`
    );
  }

  // Player finished
  if (payload.type === "finished") {
    const p = payload.player;
    addLog(`🏁 ${p.name} finished with score ${p.score}`);
  }
});
