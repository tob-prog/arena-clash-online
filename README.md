# Arena Clash Online 1v1

Dieses Paket enthält Spiel + WebSocket-Server in einem einzigen Node-Dienst.

## Lokal testen
npm install
npm start

Danach im Browser:
http://localhost:3000

## Online hosten
Du brauchst einen Hosting-Dienst, der Node.js + WebSockets unterstützt.
Lade diesen Ordner bzw. ein Git-Repository mit diesen Dateien hoch.
Startbefehl: npm start
Port: wird automatisch aus `process.env.PORT` gelesen.

Danach öffnen beide Spieler dieselbe öffentliche URL.
Spieler 1: Raum erstellen -> Code schicken.
Spieler 2: Code eingeben -> Raum beitreten.

## Hinweise zum Prototyp
- 2 Spieler pro Raum
- Bewegung/Blickrichtung werden regelmäßig synchronisiert
- Schüsse, HP, Respawn und Super-Abilities werden übertragen
- Trefferprüfung ist noch nicht server-authoritativ; für einen privaten Test ist das ausreichend
- Die Three.js-Bibliothek wird weiterhin über CDN geladen, daher brauchen beide Browser Internetzugriff
