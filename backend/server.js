// backend/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====================== DB SETUP ======================
const dbFile = path.join(__dirname, "cyber_snake.db");
const db = new sqlite3.Database(dbFile);

// In-memory state for CURRENT event only
let players = {}; // id -> {id,event_id,org,name,designation,score,finished,finishTime,answers[]}
let currentEventId = null;
let currentEventName = null;

db.serialize(() => {
  // events table (name + created_at)
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      org TEXT,
      name TEXT,
      designation TEXT,
      score INTEGER DEFAULT 0,
      finished INTEGER DEFAULT 0,
      finish_time INTEGER,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      player_id INTEGER,
      q_index INTEGER,
      question TEXT,
      chosen_option TEXT,
      correct INTEGER,
      created_at INTEGER
    )
  `);

  // On startup pick latest event or create Event 1
  db.get(
    `SELECT id, name FROM events ORDER BY id DESC LIMIT 1`,
    (err, row) => {
      if (err) {
        console.error("Error loading events:", err);
        return;
      }
      if (row) {
        currentEventId = row.id;
        currentEventName = row.name;
        console.log("Current event:", currentEventName, `(ID ${currentEventId})`);
      } else {
        const now = Date.now();
        db.run(
          `INSERT INTO events (name, created_at) VALUES (?, ?)`,
          ["Event 1", now],
          function (err2) {
            if (err2) {
              console.error("Error creating default event:", err2);
              return;
            }
            currentEventId = this.lastID;
            currentEventName = "Event 1";
            console.log("Created default event: Event 1 (ID", currentEventId, ")");
          }
        );
      }
    }
  );
});

// ====================== STATIC FRONT-END ======================
const publicPath = path.join(__dirname, "..", "frontend", "public");
app.use(express.static(publicPath));

// ====================== HELPER: LEADERBOARD (current event) ======================
function buildLeaderboard() {
  const list = Object.values(players);
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
    return 0;
  });

  return list.map((p, idx) => ({
    rank: idx + 1,
    name: p.name,
    org: p.org,
    designation: p.designation,
    score: p.score,
    finished: p.finished,
  }));
}

// ====================== CSV EXPORT (for Excel) ======================
app.get("/api/events/:eventId/export.csv", (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!eventId) {
    res.status(400).send("Invalid event id");
    return;
  }

  // 1) find event name
  db.get(
    `SELECT name FROM events WHERE id = ?`,
    [eventId],
    (errEvent, evRow) => {
      if (errEvent) {
        console.error("export get event error:", errEvent);
        res.status(500).send("DB error");
        return;
      }
      if (!evRow) {
        res.status(404).send("Event not found");
        return;
      }
      const eventName = evRow.name;

      // 2) players for this event
      db.all(
        `SELECT * FROM players WHERE event_id = ?`,
        [eventId],
        (err, playersRows) => {
          if (err) {
            console.error("export players error:", err);
            res.status(500).send("DB error");
            return;
          }

          // 3) answers for this event
          db.all(
            `SELECT * FROM answers WHERE event_id = ? ORDER BY player_id, q_index`,
            [eventId],
            (err2, answersRows) => {
              if (err2) {
                console.error("export answers error:", err2);
                res.status(500).send("DB error");
                return;
              }

              const answersByPlayer = {};
              answersRows.forEach((a) => {
                if (!answersByPlayer[a.player_id])
                  answersByPlayer[a.player_id] = [];
                answersByPlayer[a.player_id].push(a);
              });

              function esc(v) {
                if (v === null || v === undefined) return "";
                const s = String(v).replace(/"/g, '""');
                return `"${s}"`;
              }

              const lines = [];
              lines.push(
                [
                  "event_id",
                  "event_name",
                  "player_id",
                  "org",
                  "name",
                  "designation",
                  "question_no",
                  "question_text",
                  "chosen_option",
                  "correct(Yes/No)",
                  "score_delta(+5/-2)",
                  "cumulative_score",
                ].join(",")
              );

              playersRows.forEach((p) => {
                const ansList = (answersByPlayer[p.id] || []).sort(
                  (a, b) => a.q_index - b.q_index
                );
                let cumulative = 0;

                if (ansList.length === 0) {
                  lines.push(
                    [
                      esc(p.event_id),
                      esc(eventName),
                      esc(p.id),
                      esc(p.org),
                      esc(p.name),
                      esc(p.designation),
                      "",
                      "",
                      "",
                      "",
                      "",
                      esc(p.score),
                    ].join(",")
                  );
                } else {
                  ansList.forEach((a) => {
                    const delta = a.correct ? 5 : -2;
                    cumulative += delta;
                    lines.push(
                      [
                        esc(p.event_id),
                        esc(eventName),
                        esc(p.id),
                        esc(p.org),
                        esc(p.name),
                        esc(p.designation),
                        esc(a.q_index + 1),
                        esc(a.question),
                        esc(a.chosen_option),
                        esc(a.correct ? "Yes" : "No"),
                        esc(delta),
                        esc(cumulative),
                      ].join(",")
                    );
                  });
                }
              });

              const csv = lines.join("\r\n");
              res.setHeader("Content-Type", "text/csv");
              res.setHeader(
                "Content-Disposition",
                `attachment; filename="event_${eventId}_results.csv"`
              );
              res.send(csv);
            }
          );
        }
      );
    }
  );
});

// ====================== HTTP DELETE EVENT (simple & robust) ======================
app.delete("/api/events/:eventId", (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!eventId) {
    res.status(400).json({ error: "no_id" });
    return;
  }

  console.log("HTTP DELETE /api/events/", eventId);

  db.serialize(() => {
    db.run(
      `DELETE FROM answers WHERE event_id = ?`,
      [eventId],
      function (err1) {
        if (err1) {
          console.error("deleteEvent answers error:", err1);
          res.status(500).json({ error: "db_error" });
          return;
        }

        db.run(
          `DELETE FROM players WHERE event_id = ?`,
          [eventId],
          function (err2) {
            if (err2) {
              console.error("deleteEvent players error:", err2);
              res.status(500).json({ error: "db_error" });
              return;
            }

            db.run(
              `DELETE FROM events WHERE id = ?`,
              [eventId],
              function (err3) {
                if (err3) {
                  console.error("deleteEvent events error:", err3);
                  res.status(500).json({ error: "db_error" });
                  return;
                }

                // remove players in-memory for this event
                Object.keys(players).forEach((pid) => {
                  if (players[pid].event_id === eventId) {
                    delete players[pid];
                  }
                });

                // choose new current event (latest)
                db.all(
                  `SELECT id, name FROM events ORDER BY id DESC`,
                  (err4, rows) => {
                    if (err4) {
                      console.error(
                        "select events after delete error:",
                        err4
                      );
                    }
                    const events = rows || [];
                    if (events.length > 0) {
                      currentEventId = events[0].id;
                      currentEventName = events[0].name;
                    } else {
                      currentEventId = null;
                      currentEventName = null;
                    }

                    const leaderboard = buildLeaderboard();

                    io.emit("adminUpdate", {
                      type: "eventChanged",
                      currentEventId,
                      currentEventName,
                      leaderboard,
                    });

                    res.json({ ok: true });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// ====================== SOCKET.IO ======================
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // -------- getEventInfo (admin + player) --------
  socket.on("getEventInfo", (cb) => {
    db.all(
      `SELECT id, name, created_at FROM events ORDER BY id DESC`,
      (err, rows) => {
        if (err) {
          console.error("getEventInfo error:", err);
          cb({ error: "db_error" });
          return;
        }

        const events = rows || [];
        let currentRow = events.find((e) => e.id === currentEventId);

        if (!currentRow && events.length > 0) {
          currentRow = events[0];
          currentEventId = currentRow.id;
          currentEventName = currentRow.name;
        } else if (!currentRow && events.length === 0) {
          currentEventId = null;
          currentEventName = null;
        } else if (currentRow) {
          currentEventName = currentRow.name;
        }

        cb({
          currentEventId,
          currentEventName,
          events,
          leaderboard: buildLeaderboard(),
        });
      }
    );
  });

  // -------- createEvent (admin) --------
  socket.on("createEvent", (data, cb) => {
    const name = (data && data.name ? data.name : "").trim();
    if (!name) {
      cb({ error: "no_name" });
      return;
    }

    const now = Date.now();
    db.run(
      `INSERT INTO events (name, created_at) VALUES (?, ?)`,
      [name, now],
      function (err) {
        if (err) {
          console.error("createEvent error:", err);
          cb({ error: "db_error" });
          return;
        }

        currentEventId = this.lastID;
        currentEventName = name;
        players = {};

        const leaderboard = buildLeaderboard();
        cb({ ok: true, currentEventId, currentEventName });

        io.emit("adminUpdate", {
          type: "eventChanged",
          currentEventId,
          currentEventName,
          leaderboard,
        });
      }
    );
  });

  // -------- getEventResults (history viewer) --------
  socket.on("getEventResults", (data, cb) => {
    const eventId = Number(data && data.eventId);
    if (!eventId) {
      cb({ error: "no_id" });
      return;
    }

    db.all(
      `SELECT * FROM players WHERE event_id = ?`,
      [eventId],
      (err, playersRows) => {
        if (err) {
          console.error("getEventResults players error:", err);
          cb({ error: "db_error" });
          return;
        }

        db.all(
          `SELECT * FROM answers WHERE event_id = ? ORDER BY player_id, q_index`,
          [eventId],
          (err2, answersRows) => {
            if (err2) {
              console.error("getEventResults answers error:", err2);
              cb({ error: "db_error" });
              return;
            }

            cb({
              players: playersRows || [],
              answers: answersRows || [],
            });
          }
        );
      }
    );
  });

  // -------- registerPlayer --------
  socket.on("registerPlayer", (data, cb) => {
    if (!currentEventId) {
      cb({ error: "no_event" });
      return;
    }

    const org = data.org;
    const name = data.name;
    const designation = data.designation;

    db.get(
      `SELECT id FROM players
       WHERE event_id = ? AND org = ? AND name = ? AND designation = ?
       LIMIT 1`,
      [currentEventId, org, name, designation],
      (err, row) => {
        if (err) {
          console.error("DB check existing player error:", err);
          cb({ error: "db_error" });
          return;
        }

        if (row) {
          cb({ error: "already_played" });
          return;
        }

        const now = Date.now();
        db.run(
          `INSERT INTO players (event_id, org, name, designation, score, finished, finish_time, created_at)
           VALUES (?, ?, ?, ?, 0, 0, NULL, ?)`,
          [currentEventId, org, name, designation, now],
          function (err2) {
            if (err2) {
              console.error("DB insert player error:", err2);
              cb({ error: "db_error" });
              return;
            }

            const id = this.lastID;
            players[id] = {
              id,
              event_id: currentEventId,
              org,
              name,
              designation,
              score: 0,
              finished: false,
              finishTime: null,
              answers: [],
            };

            const leaderboard = buildLeaderboard();
            cb({ playerId: id, leaderboard });

            io.emit("adminUpdate", {
              type: "playerRegistered",
              player: players[id],
              leaderboard,
            });
          }
        );
      }
    );
  });

  // -------- answerQuestion --------
  socket.on("answerQuestion", (payload) => {
    const { playerId, qIndex, question, chosenOption, correct, newScore } =
      payload;

    const player = players[playerId];
    if (!player || player.finished) return;

    player.score = newScore;
    player.answers.push({ qIndex, question, chosenOption, correct });

    const now = Date.now();
    db.run(
      `INSERT INTO answers (event_id, player_id, q_index, question, chosen_option, correct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        currentEventId,
        playerId,
        qIndex,
        question,
        chosenOption,
        correct ? 1 : 0,
        now,
      ]
    );
    db.run(`UPDATE players SET score = ? WHERE id = ?`, [newScore, playerId]);

    const leaderboard = buildLeaderboard();
    io.emit("adminUpdate", {
      type: "answer",
      player,
      lastAnswer: { qIndex, question, chosenOption, correct },
      leaderboard,
    });
  });

  // -------- finishQuiz --------
  socket.on("finishQuiz", (payload, cb) => {
    const { playerId } = payload;
    const player = players[playerId];
    if (!player) return;

    if (!player.finished) {
      player.finished = true;
      player.finishTime = Date.now();
      db.run(
        `UPDATE players SET finished = 1, finish_time = ? WHERE id = ?`,
        [player.finishTime, playerId]
      );
    }

    const leaderboard = buildLeaderboard();
    const me = leaderboard.find(
      (p) => p.name === player.name && p.org === player.org
    );
    const rank = me ? me.rank : null;

    io.emit("adminUpdate", {
      type: "finished",
      player,
      leaderboard,
    });

    cb({ rank, leaderboard });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ====================== START SERVER ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

