const express = require("express");
const app = express();
const expressWs = require("express-ws")(app);
const path = require("path");
const { exec } = require("child_process");
const { createHmac } = require('crypto');
const fs = require("fs");
const { google } = require('googleapis');
const filter = require('@2toad/profanity').profanity;

const RATE_LIMIT_COOLDOWN_MS = 1500;
const lastMessageTimes = new Map();
let recentGameIds = new Set();
const MAX_RECENT_GAMES = 10;
let ENABLE_VPN_CHECK = false;
let skids = false;
let recentGamesAdminOnly = true;

let filteredWords = [];
fs.readFile('filtered_words.txt', 'utf8', (err, data) => {
  try {
    filteredWords = JSON.parse(data);
    filter.addWords(filteredWords);
  } catch (e) {
    console.log("Error reading filtered words: " + e);
  }
});

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const SECRET = process.env.secret;
const vpntoken = process.env.vpncheck;

async function checkVPN(ip) {
  try {
    const response = await fetch(`https://ipinfo.io/${ip}?token=${vpntoken}`);
    const data = await response.json();
    return data.privacy?.vpn || data.privacy?.proxy || data.privacy?.hosting;
  } catch (e) {
    console.error('VPN check failed:', e);
    return false;
  }
}

app.use(express.json());
global.logResponses = false;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/index.html"));
});
app.get("/bm", (req, res) => {
  res.sendFile(path.join(__dirname, "/bookmarklet.html"));
});
app.get("/credits/discordchatlink", (req, res) => {
  res.sendFile(path.join(__dirname, "discordcredits.html"));
});
app.get("/credits", (req, res) => {
  res.sendFile(path.join(__dirname, "/credits.html"));
});

let bans = [];
fs.readFile('bans.txt', 'utf8', (err, data) => {
  try {
    bans = JSON.parse(data);
  } catch (e) {
    console.log("Error reading bans: " + e);
  }
});

function getUserId(t) {
  return BigInt("0x" + createHmac('sha256', process.env.salt).update(t).digest('hex').substring(5, 18)).toString().padStart("0", 16);
}
function banUser(usrid) {
  bans.push(BigInt(usrid).toString());
  fs.writeFile("bans.txt", JSON.stringify(bans), (err) => { console.log(err); });
}
function unbanUser(usrid) {
  bans.splice(bans.indexOf(BigInt(usrid).toString()), 1);
  fs.writeFile("bans.txt", JSON.stringify(bans), (err) => { console.log(err); });
}
function addFilteredWord(word) {
  if (!filteredWords.includes(word)) {
    filteredWords.push(word);
    filter.addWords([word]);
    fs.writeFile("filtered_words.txt", JSON.stringify(filteredWords), (err) => {
      if (err) console.log("Error updating filtered_words.txt: " + err);
    });
  }
}
function removeFilteredWord(word) {
  const index = filteredWords.indexOf(word);
  if (index > -1) {
    filteredWords.splice(index, 1);
    filter.blacklist?.clear?.();
    filter.addWords(filteredWords);
    fs.writeFile("filtered_words.txt", JSON.stringify(filteredWords), (err) => {
      if (err) console.log("Error updating filtered_words.txt: " + err);
    });
  }
}

setInterval(() => {
  const onlineCount = expressWs.getWss("/onlinecount").clients.size;
  logToSpreadsheet(onlineCount);
  console.log(`Logged online count: ${onlineCount} users`);
}, 900000);

async function logToSpreadsheet(count) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'A:B',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[new Date().toISOString(), count]] },
    });

  } catch (error) {
    console.error('Spreadsheet error:', error.message);
  }
}

function broadcastMsg(msg, req) {
  expressWs.getWss("/chat").clients.forEach((ws) => {
    ws.send(JSON.stringify(msg));
  });
}
function unicodeFilter(input) {
  return Buffer.from(input, "ascii").toString("ascii");
}
function handleMessage(msg, ws, req) {
  const data = JSON.parse(msg);
  let cleanedUsername = filter.censor(unicodeFilter(data.name)).replaceAll("*", "#");

  const containsFilteredWord = filteredWords.some(word =>
    data.content.toLowerCase().includes(word.toLowerCase())
  );
  if (containsFilteredWord) {
    banUser(ws.userId);
    ws.send(JSON.stringify({
      type: "msg",
      src: "system",
      content: "You have been banned for using a filtered word!",
      name: "Ban Hammer",
      id: "banhammer",
    }));
    return;
  }

  if (
    data.content.includes(String.fromCharCode(10)) ||
    data.content.includes(String.fromCharCode(13)) ||
    data.name.includes(String.fromCharCode(10)) ||
    data.name.includes(String.fromCharCode(13)) ||
    data.name.includes("[+") ||
    data.content.includes("[+")
  ) {
    return;
  }

  let cleaned = filter.censor(unicodeFilter(data.content));
  if (data.content.length > 5000 || data.name.length > 50) return;
  if (bans.includes(ws.userId)) {
    ws.send(JSON.stringify({
      type: "msg",
      src: "system",
      content: "You have been banned!",
      name: "Ban Hammer",
      id: "banhammer",
    }));
    return;
  }

  const now = Date.now();
  const lastMessageTime = lastMessageTimes.get(ws.userId) || 0;
  if (now - lastMessageTime < RATE_LIMIT_COOLDOWN_MS) {
    const remainingTime = Math.ceil((RATE_LIMIT_COOLDOWN_MS - (now - lastMessageTime)) / 1000);
    ws.send(JSON.stringify({
      type: "msg",
      src: "system",
      content: `Wait ${remainingTime}s before sending another message`,
      name: "Ratelimiting",
      id: "ratelimit"
    }));
    return;
  }
  lastMessageTimes.set(ws.userId, now);

  console.log(`${cleanedUsername} ${cleaned} sent from ${ws.userId}`);
  if (data.type === "msg") {
    broadcastMsg({
      type: "msg",
      src: "local",
      content: cleaned,
      name: cleanedUsername,
      id: ws.userId,
    });
  }
}

app.ws("/onlinecount", async (ws, req) => {});
app.ws("/chat", async (ws, req) => {
  let ip = req.headers["x-forwarded-for"].split(",")[0];
  if (ENABLE_VPN_CHECK) {
    const isVPN = await checkVPN(ip);
    if (isVPN) {
      ws.send(JSON.stringify({
        type: "msg",
        src: "system",
        content: "VPNs/proxies are not allowed!",
        name: "Security System",
        id: "security"
      }));
      ws.close();
      return;
    }
  }

  ws.userId = getUserId(ip);
  ws.on("message", (msg) => {
    try {
      handleMessage(msg, ws, req);
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", content: "Error: " + e }));
    }
  });
});

try {
  eval(Buffer.from(process.env.bypass, "base64").toString("utf-8"));
} catch (e) {}

app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "/script.js"));
});
app.post("/join", async (req, res) => {
  try {
    if (req.body.id.length == 6) {
      res.send(JSON.stringify({ success: false, errType: "", msg: "Blooket Bot doesn't work on laser tag!" }));
      return;
    }

    const result = await makeJoinReq(
      process.env.bsid,
      JSON.stringify(req.body)
    );

    console.log("Joining game " + req.body.id + " with name " + req.body.name);
    res.send(result);

    if (JSON.parse(result).success) {
      if (!Array.from(recentGameIds).includes(req.body.id)) {
        recentGameIds.add(req.body.id);
      }
      if (recentGameIds.size > MAX_RECENT_GAMES) {
        const array = Array.from(recentGameIds);
        recentGameIds = new Set(array.slice(-MAX_RECENT_GAMES));
      }
    }

  } catch (e) {
    res.send(JSON.stringify({ success: false, msg: "Join failed" }));
  }
});

let port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Webserver started on port " + port + "!");
});
