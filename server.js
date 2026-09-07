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
        alive: true,
        money: 0,
        spawnProtectedUntil: 0
      });

      ws.roomCode = code;

      send(ws, {
        type: "room_created",
        room: code,
        playerId: ws.playerId,
        slot: 0,
        money: 0
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
        alive: true,
        money: 0,
        spawnProtectedUntil: Date.now() + 3000
      });

      ws.roomCode = code;


      // ======================================================
      // SPAWNPUNKTE
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

        money: 0,

        spawn: spawn1,

        opponentSpawn: spawn0
      });


      // ======================================================
      // MATCH START
      // ======================================================

      if (existing) {

        existing.spawnProtectedUntil =
          Date.now() + 3000;


        send(existing.ws, {
          type: "opponent_joined",
          playerId: ws.playerId,
          opponentSpawn: spawn1
        });


        send(existing.ws, {
          type: "match_start",
          opponentId: ws.playerId,
          slot: 0,
          spawn: spawn0,
          opponentSpawn: spawn1
        });


        send(ws, {
          type: "match_start",
          opponentId: existing.id,
          slot: 1,
          spawn: spawn1,
          opponentSpawn: spawn0
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
          playerId: ws.playerId,
          state: msg.state
        },
        ws
      );

      return;
    }


    // ========================================================
    // LEGACY SHOOT
    // ========================================================

    if (msg.type === "shoot") {
      return;
    }


    // ========================================================
    // ABILITY
    // ========================================================

    if (msg.type === "ability") {

      broadcastRoom(
        room,
        {
          type: "remote_ability",
          playerId: ws.playerId,
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

      const attacker = room.players.find(
        p => p.ws === ws
      );

      const target = room.players.find(
        p => p.id === msg.targetId
      );

      if (!attacker || !target) {
        return;
      }

      if (attacker.id === target.id) {
        return;
      }

      if (!target.alive) {
        return;
      }


      // ======================================================
      // SPAWNSCHUTZ
      // ======================================================

      if (
        (target.spawnProtectedUntil || 0) >
        Date.now()
      ) {
        return;
      }


      // ======================================================
      // DAMAGE VALIDIEREN
      // ======================================================

      const damage = Math.max(
        0,
        Math.min(
          200,
          Number(msg.damage) || 0
        )
      );

      if (damage <= 0) {
        return;
      }


      const oldHp = target.hp;


      // ======================================================
      // HP REDUZIEREN
      // ======================================================

      target.hp = Math.max(
        0,
        target.hp - damage
      );


      if (target.hp <= 0) {
        target.alive = false;
      }


      // ======================================================
      // DAMAGE AN BEIDE CLIENTS
      // ======================================================

      broadcastRoom(room, {
        type: "damage",
        targetId: target.id,
        hp: target.hp,
        damage,
        alive: target.alive
      });


      // ======================================================
      // KILL + GELD
      // ======================================================

      if (
        oldHp > 0 &&
        target.hp === 0
      ) {

        const reward = 100;

        attacker.money =
          (attacker.money || 0) +
          reward;


        broadcastRoom(room, {
          type: "kill",
          killerId: attacker.id,
          targetId: target.id,
          reward,
          money: attacker.money
        });


        send(attacker.ws, {
          type: "money",
          money: attacker.money
        });
      }

      return;
    }


    // ========================================================
    // SHOP PURCHASE
    // ========================================================

    if (msg.type === "buy_item") {

      const buyer =
        room.players.find(
          p => p.ws === ws
        );

      if (!buyer) {
        return;
      }


      const prices = {
        medkit: 75,
        adrenaline: 100,
        overdrive: 125,
        ammo: 60
      };


      const itemId =
        String(msg.itemId || "");


      const price =
        prices[itemId];


      // ======================================================
      // UNBEKANNTES ITEM
      // ======================================================

      if (!price) {

        return send(ws, {
          type: "purchase_failed",
          message: "Unbekanntes Item.",
          money: buyer.money || 0
        });
      }


      // ======================================================
      // NICHT GENUG GELD
      // ======================================================

      if (
        (buyer.money || 0) <
        price
      ) {

        return send(ws, {
          type: "purchase_failed",
          message:
            `Zu wenig Geld – benötigt $${price}.`,
          money: buyer.money || 0
        });
      }


      // ======================================================
      // GELD ABZIEHEN
      // ======================================================

      buyer.money -= price;


      // ======================================================
      // KAUF BESTÄTIGEN
      // ======================================================

      send(ws, {
        type: "item_purchased",
        itemId,
        price,
        money: buyer.money
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


      // ======================================================
      // PLAYER RESET
      // ======================================================

      player.hp = 100;
      player.alive = true;


      // ======================================================
      // 3 SEKUNDEN SPAWNSCHUTZ
      // ======================================================

      player.spawnProtectedUntil =
        Date.now() + 3000;


      // ======================================================
      // SPAWNPUNKT
      // ======================================================

      const slot =
        room.players.findIndex(
          p =>
            p.id ===
            player.id
        );


      const position =
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


      // ======================================================
      // RESPAWN AN BEIDE CLIENTS
      // ======================================================

      broadcastRoom(room, {
        type: "respawn",
        playerId: player.id,
        position
      });

      return;
    }
  });


  // ==========================================================
  // DISCONNECT
  // ==========================================================

  ws.on(
    "close",
    () => {
      removePlayer(ws);
    }
  );
});


// ============================================================
// SERVER START
// ============================================================

server.listen(PORT, () => {

  console.log(
    `Arena Clash Online läuft auf Port ${PORT}`
  );
});
