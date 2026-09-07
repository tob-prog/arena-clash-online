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

const wss = new WebSocket.Server({ server });

const rooms = new Map();

let nextPlayerId = 1;

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

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastRoom(room, obj, except = null) {
  for (const player of room.players) {
    if (player.ws !== except) {
      send(player.ws, obj);
    }
  }
}

function removePlayer(ws) {
  if (!ws.roomCode) {
    return;
  }

  const room = rooms.get(ws.roomCode);

  if (!room) {
    return;
  }

  const index = room.players.findIndex(
    player => player.ws === ws
  );

  if (index >= 0) {
    const [left] = room.players.splice(index, 1);

    broadcastRoom(room, {
      type: "opponent_left",
      playerId: left.id
    });
  }

  if (room.players.length === 0) {
    rooms.delete(ws.roomCode);
  }
}

wss.on("connection", ws => {
  ws.playerId = "P" + nextPlayerId++;

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

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
        hp: 100
      });

      ws.roomCode = code;

      send(ws, {
        type: "room_created",
        room: code,
        playerId: ws.playerId
      });

      return;
    }

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
        hp: 100
      });

      ws.roomCode = code;

      send(ws, {
        type: "room_joined",
        room: code,
        playerId: ws.playerId,
        opponentId: existing?.id || null
      });

      if (existing) {
        send(existing.ws, {
          type: "opponent_joined",
          playerId: ws.playerId
        });

        send(ws, {
          type: "match_start",
          opponentId: existing.id
        });
      }

      return;
    }

    const room = rooms.get(ws.roomCode);

    if (!room) {
      return;
    }

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

    if (msg.type === "shoot") {
      broadcastRoom(
        room,
        {
          type: "remote_shoot",
          playerId: ws.playerId,
          origin: msg.origin,
          dir: msg.dir,
          damage: msg.damage,
          speed: msg.speed,
          weapon: msg.weapon
        },
        ws
      );

      return;
    }

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

    if (msg.type === "hit") {
      const target = room.players.find(
        player => player.id === msg.targetId
      );

      if (!target) {
        return;
      }

      const damage = Math.max(
        0,
        Math.min(
          200,
          Number(msg.damage) || 0
        )
      );

      target.hp = Math.max(
        0,
        target.hp - damage
      );

      broadcastRoom(room, {
        type: "damage",
        targetId: target.id,
        hp: target.hp,
        damage
      });

      return;
    }

    if (msg.type === "request_respawn") {
      const player = room.players.find(
        player => player.id === ws.playerId
      );

      if (!player) {
        return;
      }

      player.hp = 100;

      const slot = room.players.findIndex(
        player => player.id === ws.playerId
      );

      const position =
        slot === 0
          ? { x: -30, y: 0, z: -6 }
          : { x: 30, y: 0, z: 6 };

      broadcastRoom(room, {
        type: "respawn",
        playerId: player.id,
        position
      });

      return;
    }
  });

  ws.on("close", () => {
    removePlayer(ws);
  });
});

server.listen(PORT, () => {
  console.log(
    `Arena Clash Online läuft auf Port ${PORT}`
  );
});