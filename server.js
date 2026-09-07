const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split("?")[0];

  if (reqPath === "/") {
    reqPath = "/index.html";
  }

  const filePath = path.join(ROOT, reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath);

    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json"
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream"
    });

    res.end(data);
  });
});


// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({ server });

const rooms = new Map();

let nextPlayerId = 1;


// ============================================================
// ROOM CODE
// ============================================================

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return rooms.has(code)
    ? makeRoomCode()
    : code;
}


// ============================================================
// SEND
// ============================================================

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}


// ============================================================
// BROADCAST
// ============================================================

function broadcastRoom(room, obj, except = null) {
  for (const p of room.players) {
    if (p.ws !== except) {
      send(p.ws, obj);
    }
  }
}


// ============================================================
// REMOVE PLAYER
// ============================================================

function removePlayer(ws) {
  if (!ws.roomCode) {
    return;
  }

  const room = rooms.get(ws.roomCode);

  if (!room) {
    return;
  }

  const idx = room.players.findIndex(
    p => p.ws === ws
  );

  if (idx >= 0) {
    const [left] = room.players.splice(idx, 1);

    broadcastRoom(room, {
      type: "opponent_left",
      playerId: left.id
    });
  }

  if (room.players.length === 0) {
    rooms.delete(ws.roomCode);
  }
}


// ============================================================
// CONNECTION
// ============================================================

wss.on("connection", ws => {

  ws.playerId = "P" + nextPlayerId++;

  ws.on("message", raw => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }


    // ========================================================
    // CREATE ROOM
    // ========================================================

    if (msg.type === "create_room") {

      removePlayer(ws);

      const code = makeRoomCode();

      const room = {
        code,
        players: []
      };

      rooms.set(code, room);

      room.players.push({
        id: ws.playerId,
        name: msg.name || "Spieler",
        ws,
        hp: 100,
        spawnProtectedUntil: 0
      });

      ws.roomCode = code;

      send(ws, {
        type: "room_created",
        room: code,
        playerId: ws.playerId,
        slot: 0
      });

      return;
    }


    // ========================================================
    // JOIN ROOM
    // ========================================================

    if (msg.type === "join_room") {

      removePlayer(ws);

      const code = String(
        msg.room || ""
      ).toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Raum nicht gefunden."
        });
      }

      if (room.players.length >= 2) {
        return send(ws, {
          type: "error",
          message: "Raum ist bereits voll."
        });
      }

      const existing = room.players[0];

      room.players.push({
        id: ws.playerId,
        name: msg.name || "Spieler",
        ws,
        hp: 100,
        spawnProtectedUntil: Date.now() + 3000
      });

      ws.roomCode = code;


      // ======================================================
      // FESTE SPAWNPUNKTE
      // ======================================================

      const spawn0 = {
        x: -30,
        y: 0,
        z: -6
      };

      const spawn1 = {
        x: 30,
        y: 0,
        z: 6
      };


      // ======================================================
      // SPIELER 2 INFORMIEREN
      // ======================================================

      send(ws, {
        type: "room_joined",

        room: code,

        playerId: ws.playerId,

        opponentId:
          existing?.id || null,

        slot: 1,

        spawn: spawn1,

        opponentSpawn: spawn0
      });


      // ======================================================
      // MATCH STARTEN
      // ======================================================

      if (existing) {

        existing.spawnProtectedUntil =
          Date.now() + 3000;


        // Spieler 1 erfährt,
        // dass Spieler 2 verbunden ist

        send(existing.ws, {
          type: "opponent_joined",

          playerId:
            ws.playerId,

          opponentSpawn:
            spawn1
        });


        // ====================================================
        // SPIELER 1 START
        // ====================================================

        send(existing.ws, {
          type: "match_start",

          opponentId:
            ws.playerId,

          slot: 0,

          spawn:
            spawn0,

          opponentSpawn:
            spawn1
        });


        // ====================================================
        // SPIELER 2 START
        // ====================================================

        send(ws, {
          type: "match_start",

          opponentId:
            existing.id,

          slot: 1,

          spawn:
            spawn1,

          opponentSpawn:
            spawn0
        });
      }

      return;
    }


    // ========================================================
    // GET CURRENT ROOM
    // ========================================================

    const room = rooms.get(
      ws.roomCode
    );

    if (!room) {
      return;
    }


    // ========================================================
    // PLAYER STATE
    // ========================================================

    if (msg.type === "state") {

      broadcastRoom(
        room,
        {
          type: "state",

          playerId:
            ws.playerId,

          state:
            msg.state
        },
        ws
      );

      return;
    }


    // ========================================================
    // SHOOT
    // ========================================================

    if (msg.type === "shoot") {

      broadcastRoom(
        room,
        {
          type: "remote_shoot",

          playerId:
            ws.playerId,

          origin:
            msg.origin,

          dir:
            msg.dir,

          damage:
            msg.damage,

          speed:
            msg.speed,

          weapon:
            msg.weapon
        },
        ws
      );

      return;
    }


    // ========================================================
    // ABILITY
    // ========================================================

    if (msg.type === "ability") {

      broadcastRoom(
        room,
        {
          type:
            "remote_ability",

          playerId:
            ws.playerId,

          ...msg
        },
        ws
      );

      return;
    }


    // ========================================================
    // HIT
    // ========================================================

    if (msg.type === "hit") {

      const target =
        room.players.find(
          p =>
            p.id ===
            msg.targetId
        );

      if (!target) {
        return;
      }


      // ======================================================
      // 3 SEKUNDEN SPAWNSCHUTZ
      // ======================================================

      if (
        (target.spawnProtectedUntil || 0)
        >
        Date.now()
      ) {
        return;
      }


      const damage =
        Math.max(
          0,
          Math.min(
            200,
            Number(msg.damage) || 0
          )
        );


      target.hp =
        Math.max(
          0,
          target.hp - damage
        );


      broadcastRoom(room, {
        type:
          "damage",

        targetId:
          target.id,

        hp:
          target.hp,

        damage
      });

      return;
    }


    // ========================================================
    // RESPAWN
    // ========================================================

    if (
      msg.type ===
      "request_respawn"
    ) {

      const player =
        room.players.find(
          p =>
            p.id ===
            ws.playerId
        );

      if (!player) {
        return;
      }


      player.hp = 100;


      // 3 Sekunden Spawnschutz

      player.spawnProtectedUntil =
        Date.now() + 3000;


      const slot =
        room.players.findIndex(
          p =>
            p.id ===
            player.id
        );


      const pos =
        slot === 0

          ? {
              x: -30,
              y: 0,
              z: -6
            }

          : {
              x: 30,
              y: 0,
              z: 6
            };


      broadcastRoom(room, {
        type:
          "respawn",

        playerId:
          player.id,

        position:
          pos
      });

      return;
    }
  });


  // ==========================================================
  // DISCONNECT
  // ==========================================================

  ws.on(
    "close",
    () =>
      removePlayer(ws)
  );
});


// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(
    `Arena Clash Online läuft auf Port ${PORT}`
  );
});
