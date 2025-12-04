// FRONTEND GAME LOGIC – canvas + quiz + socket.io
const socket = io();

// Player / quiz state
let playerId = null;
let currentScore = 0;
let currentQuestionIndex = 0;

// Current question options: [{id,text,correct,color}]
let currentOptions = [];
let nextOptionId = 1;

// Snake state
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const grid = 20;

let snake = [{ x: 1, y: 1 }];
let direction = "right";
let pendingGrowth = 0;
let targets = [];       // [{x,y,color,optionId}]
let canAnswer = false;  // true = current question abhi answer ho sakta hai

// Colours for 4 options (red, yellow, green, blue)
const OPTION_COLORS = ["#ff4d4d", "#ffd633", "#3ddc84", "#4d79ff"];

// ================= Questions =================
const QUESTIONS = [
  {
    question: "Which protocol indicates a secure website?",
    options: ["FTP", "HTTP", "HTTPS", "SSH"],
    correct: "HTTPS",
  },
  {
    question: "What is the main purpose of a firewall?",
    options: [
      "Store backup data",
      "Play media files",
      "Block/allow network traffic",
      "Change screen brightness",
    ],
    correct: "Block/allow network traffic",
  },
  {
    question: "Which is a strong password?",
    options: ["qwerty", "Welcome@123", "123456", "name123"],
    correct: "Welcome@123",
  },
  {
    question: "Phishing mainly tries to:",
    options: [
      "Improve Wi-Fi speed",
      "Steal info by tricking users",
      "Clean malware",
      "Damage hardware",
    ],
    correct: "Steal info by tricking users",
  },
  {
    question: "Before clicking an email link, you should check:",
    options: [
      "Background colour",
      "URL and sender address",
      "Font style",
      "Emoji count",
    ],
    correct: "URL and sender address",
  },
  {
    question: "Which is multi-factor authentication?",
    options: [
      "Password only",
      "OTP only",
      "Password + OTP",
      "Username only",
    ],
    correct: "Password + OTP",
  },
  {
    question: "Ransomware usually:",
    options: [
      "Installs printer drivers",
      "Encrypts data and demands money",
      "Increases battery life",
      "Defragments disks",
    ],
    correct: "Encrypts data and demands money",
  },
  {
    question: "What should never be shared publicly?",
    options: [
      "Company logo",
      "Canteen menu",
      "VPN / login passwords",
      "Festival photos",
    ],
    correct: "VPN / login passwords",
  },
];

// =============== Utility functions ===============
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min, maxInclusive) {
  return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
}

// =============== DOM Elements ===============
const currentEventNamePlayerSpan = document.getElementById(
  "currentEventNamePlayer"
);

const formDiv = document.getElementById("player-form");
const orgInput = document.getElementById("orgInput");
const nameInput = document.getElementById("nameInput");
const desigInput = document.getElementById("desigInput");
const startBtn = document.getElementById("startBtn");
const formError = document.getElementById("formError");

const gameArea = document.getElementById("game-area");
const qCountSpan = document.getElementById("qCount");
const scoreSpan = document.getElementById("score");
const questionText = document.getElementById("questionText");
const optionsDiv = document.getElementById("options");
const answerError = document.getElementById("answerError");
const feedback = document.getElementById("feedback");
const submitAnswerBtn = document.getElementById("submitAnswerBtn");

const finalScreen = document.getElementById("final-screen");
const finalScoreSpan = document.getElementById("finalScore");
const finalRankSpan = document.getElementById("finalRank");

// =============== Load current event name on page load ===============
socket.emit("getEventInfo", (data) => {
  if (data && !data.error && data.currentEventName) {
    currentEventNamePlayerSpan.textContent = data.currentEventName;
  } else {
    currentEventNamePlayerSpan.textContent = "(no active event)";
  }
});

// If admin changes / deletes event while front end open
socket.on("adminUpdate", (payload) => {
  if (payload.type === "eventChanged") {
    currentEventNamePlayerSpan.textContent =
      payload.currentEventName || "(no active event)";
  }
});

// =============== Player registration ===============
startBtn.addEventListener("click", () => {
  const org = orgInput.value.trim();
  const name = nameInput.value.trim();
  const desig = desigInput.value.trim();

  if (!org || !name || !desig) {
    formError.textContent = "Please fill all fields.";
    return;
  }
  formError.textContent = "";

  socket.emit(
    "registerPlayer",
    { org, name, designation: desig },
    (res) => {
      if (res.error === "no_event") {
        formError.textContent =
          "No active event is configured. Please contact the organiser.";
        return;
      }
      if (res.error === "already_played") {
        formError.textContent =
          "You have already attempted this event. Only first attempt is counted.";
        return;
      }
      if (res.error) {
        formError.textContent = "Server error. Please try again later.";
        return;
      }

      playerId = res.playerId;

      formDiv.classList.add("hidden");
      gameArea.classList.remove("hidden");

      startSnake();
      loadQuestion();
    }
  );
});

// =============== Snake rendering / movement ===============
function placeTargets() {
  targets = [];
  const maxX = canvas.width / grid - 2;
  const maxY = canvas.height / grid - 2;

  currentOptions.forEach((opt) => {
    let pos;
    let safe = false;

    while (!safe) {
      pos = {
        x: randInt(1, maxX),
        y: randInt(1, maxY),
      };
      const clashTarget = targets.some((t) => t.x === pos.x && t.y === pos.y);
      const clashSnake = snake.some((s) => s.x === pos.x && s.y === pos.y);
      if (!clashTarget && !clashSnake) safe = true;
    }

    targets.push({
      x: pos.x,
      y: pos.y,
      color: opt.color,
      optionId: opt.id,
    });
  });
}

// *** DRAW SCENE with wrap fix ***
function drawScene() {
  // 1) Clear background
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2) Draw coloured boxes (answer targets)
  targets.forEach((t) => {
    ctx.fillStyle = t.color;
    ctx.fillRect(t.x * grid, t.y * grid, grid, grid);
  });

  // 3) Draw snake – smooth tube + dots + head + tongue
  if (snake.length === 0) return;

  // ---- smooth green tube (body) ----
  const lineWidth = grid * 0.9; // thickness of snake
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#00cc44"; // main body colour
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  const tailIndex = snake.length - 1;
  let tail = snake[tailIndex];
  let prevX = tail.x * grid + grid / 2;
  let prevY = tail.y * grid + grid / 2;
  ctx.moveTo(prevX, prevY);

  for (let i = tailIndex - 1; i >= 0; i--) {
    const seg = snake[i];
    const sx = seg.x * grid + grid / 2;
    const sy = seg.y * grid + grid / 2;

    // If distance is large, treat as wrap → break line
    if (
      Math.abs(sx - prevX) > grid * 1.5 ||
      Math.abs(sy - prevY) > grid * 1.5
    ) {
      ctx.moveTo(sx, sy);
    } else {
      ctx.lineTo(sx, sy);
    }

    prevX = sx;
    prevY = sy;
  }
  ctx.stroke();
  ctx.restore();

  // ---- dark dots on body (every 2nd segment) ----
  ctx.fillStyle = "#004000"; // dark green / almost black
  const dotR = grid * 0.12;
  for (let i = 1; i < snake.length; i += 2) {
    const seg = snake[i];
    const cx = seg.x * grid + grid / 2;
    const cy = seg.y * grid + grid / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- head: brighter green circle ----
  const head = snake[0];
  const hx = head.x * grid + grid / 2;
  const hy = head.y * grid + grid / 2;
  const headR = grid * 0.45;

  ctx.fillStyle = "#00ff55";
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();

  // ---- eyes ----
  const eyeOffsetX = grid * 0.18;
  const eyeOffsetY = grid * 0.12;
  const eyeR = grid * 0.13;
  const pupilR = grid * 0.07;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(hx - eyeOffsetX, hy - eyeOffsetY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + eyeOffsetX, hy - eyeOffsetY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(hx - eyeOffsetX, hy - eyeOffsetY, pupilR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + eyeOffsetX, hy - eyeOffsetY, pupilR, 0, Math.PI * 2);
  ctx.fill();

  // ---- red tongue ----
  ctx.fillStyle = "#ff3333";
  const tongueLength = grid * 0.5;
  const tongueWidth = grid * 0.12;

  ctx.beginPath();
  if (direction === "right") {
    ctx.moveTo(hx + headR, hy);
    ctx.lineTo(hx + headR + tongueLength, hy - tongueWidth);
    ctx.lineTo(hx + headR + tongueLength, hy + tongueWidth);
  } else if (direction === "left") {
    ctx.moveTo(hx - headR, hy);
    ctx.lineTo(hx - headR - tongueLength, hy - tongueWidth);
    ctx.lineTo(hx - headR - tongueLength, hy + tongueWidth);
  } else if (direction === "up") {
    ctx.moveTo(hx, hy - headR);
    ctx.lineTo(hx - tongueWidth, hy - headR - tongueLength);
    ctx.lineTo(hx + tongueWidth, hy - headR - tongueLength);
  } else {
    // down
    ctx.moveTo(hx, hy + headR);
    ctx.lineTo(hx - tongueWidth, hy + headR + tongueLength);
    ctx.lineTo(hx + tongueWidth, hy + headR + tongueLength);
  }
  ctx.closePath();
  ctx.fill();
}

function updateSnake() {
  const head = { ...snake[0] };

  if (direction === "right") head.x++;
  if (direction === "left") head.x--;
  if (direction === "up") head.y--;
  if (direction === "down") head.y++;

  const maxX = canvas.width / grid;
  const maxY = canvas.height / grid;

  if (head.x < 0) head.x = maxX - 1;
  if (head.x >= maxX) head.x = 0;
  if (head.y < 0) head.y = maxY - 1;
  if (head.y >= maxY) head.y = 0;

  snake.unshift(head);

  // Check collision with coloured boxes → instant answer
  if (canAnswer) {
    for (const t of targets) {
      if (t.x === head.x && t.y === head.y) {
        handleAnswerFromTarget(t.optionId);
        break;
      }
    }
  }

  if (pendingGrowth > 0) {
    pendingGrowth--;
  } else {
    snake.pop();
  }

  drawScene();
}

function startSnake() {
  drawScene();
  // SPEED: slower → 200ms
  setInterval(updateSnake, 250);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && direction !== "down") direction = "up";
  if (e.key === "ArrowDown" && direction !== "up") direction = "down";
  if (e.key === "ArrowLeft" && direction !== "right") direction = "left";
  if (e.key === "ArrowRight" && direction !== "left") direction = "right";
});

document.getElementById("upBtn").onclick = () => (direction = "up");
document.getElementById("downBtn").onclick = () => (direction = "down");
document.getElementById("leftBtn").onclick = () => (direction = "left");
document.getElementById("rightBtn").onclick = () => (direction = "right");

// =============== Questions ===============
function loadQuestion() {
  if (currentQuestionIndex >= QUESTIONS.length) {
    finishQuiz();
    return;
  }

  const q = QUESTIONS[currentQuestionIndex];

  questionText.textContent = q.question;
  qCountSpan.textContent = currentQuestionIndex + 1;
  answerError.textContent = "";
  feedback.textContent = "";

  const shuffledTexts = shuffleArray(q.options);
  currentOptions = shuffledTexts.map((txt, idx) => ({
    id: nextOptionId++,
    text: txt,
    correct: txt === q.correct,
    color: OPTION_COLORS[idx],
  }));

  // Render options (reference only; no click)
  optionsDiv.innerHTML = "";
  currentOptions.forEach((opt) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.dataset.optionId = opt.id;

    const colorBox = document.createElement("span");
    colorBox.className = "color-box";
    colorBox.style.backgroundColor = opt.color;

    const textSpan = document.createElement("span");
    textSpan.className = "option-text";
    textSpan.textContent = opt.text;

    row.appendChild(colorBox);
    row.appendChild(textSpan);
    optionsDiv.appendChild(row);
  });

  placeTargets();
  drawScene();
  canAnswer = true;
}

// Snake ne jis colour ko hit kiya uska optionId yahan aata hai
function handleAnswerFromTarget(optionId) {
  if (!canAnswer) return;
  canAnswer = false;

  const opt = currentOptions.find((o) => o.id === optionId);
  if (!opt) return;

  const correct = opt.correct;

  // +5 / -2, negative allowed
  const delta = correct ? 5 : -2;
  currentScore += delta;
  scoreSpan.textContent = currentScore; // -2, -4 ... bhi dikhega

  if (correct) {
    feedback.style.color = "#00ff7f";
    feedback.textContent = "+5 (Correct answer!)";
  } else {
    feedback.style.color = "#ff5c5c";
    feedback.textContent = "-2 (Wrong answer)";
  }

  // Snake growth per question → thoda kam
  pendingGrowth += 1;

  socket.emit("answerQuestion", {
    playerId,
    qIndex: currentQuestionIndex,
    question: QUESTIONS[currentQuestionIndex].question,
    chosenOption: opt.text,
    correct,
    newScore: currentScore,
  });

  currentQuestionIndex++;
  loadQuestion();
}

// Submit button = global “finish”
submitAnswerBtn.addEventListener("click", () => {
  finishQuiz();
});

function finishQuiz() {
  if (gameArea.classList.contains("hidden")) return;

  gameArea.classList.add("hidden");

  socket.emit("finishQuiz", { playerId }, (res) => {
    finalScoreSpan.textContent = currentScore;
    finalRankSpan.textContent = res.rank ? `#${res.rank}` : "N/A";
    finalScreen.classList.remove("hidden");
  });
}
