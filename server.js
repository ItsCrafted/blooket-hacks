//eval(Buffer.from(process.env.code,"base64").toString("utf-8"));
const express = require("express");
const app = express();
const expressWs = require("express-ws")(app);
const path = require("path");
const discord = require("discord.js");
const { exec } = require("child_process");
const { createHmac } = require('crypto');
const fs = require("fs");
const { google } = require('googleapis');


const filter = require('@2toad/profanity').profanity;


const RATE_LIMIT_COOLDOWN_MS = 1500;
const lastMessageTimes = new Map();//maps are W
let recentGameIds = new Set();
const MAX_RECENT_GAMES = 10;
let ENABLE_VPN_CHECK = false;
let skids = false;//tbh, we should find Ben's IP and blacklist it
let recentGamesAdminOnly = true
const recentGamesChannel = "1379122407343657114";
const linkChannel = "1379122328767696956";


let filteredWords = [];
fs.readFile('filtered_words.txt', 'utf8', (err, data) => {
  try {
    filteredWords = JSON.parse(data);
    filter.addWords(filteredWords);
  } catch (e) {
    console.log("Error reading filtered words: " + e);
  }
});

//const axios = require('axios')
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
//const request = require("request-promise");  
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
global.logResponses = !1;
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/index.html"));
});
app.get("/bm", (req, res) => {
  res.sendFile(path.join(__dirname, "/bookmarklet.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/extensionindex.js"));
});
app.get("/credits/discordchatlink", (req, res) => {
  res.sendFile(path.join(__dirname, "discordcredits.html"));
});
app.get("/credits", (req, res) => {
  res.sendFile(path.join(__dirname, "/credits.html"));
});

//req.headers["x-forwarded-for"] for ratelimit
let bans = [];
fs.readFile('bans.txt', 'utf8', (err, data) => {
  try{
    bans=JSON.parse(data);
  }catch(e){console.log("Error reading bans: " + e);}
});
function getUserId(t){
return BigInt("0x"+createHmac('sha256',process.env.salt).update(t).digest('hex').substring(5,18)).toString().padStart("0",16);
//https://stackoverflow.com/questions/27970431/using-sha-256-with-nodejs-crypto
}
function banUser(usrid){
  bans.push(BigInt(usrid).toString());
  fs.writeFile("bans.txt", JSON.stringify(bans), (err) => {console.log(err);});//even if site crashes bans won't be overrode
}
function unbanUser(usrid){
  bans.splice(bans.indexOf(BigInt(usrid).toString()),1)
  fs.writeFile("bans.txt", JSON.stringify(bans), (err) => {console.log(err);});//even if site crashes bans won't be overrode
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

setInterval(() => {
    const channel = client.channels.cache.get(recentGamesChannel);
    if (!channel) return;
    
    const gameList = Array.from(recentGameIds)
        .map(id => `• ${id}`)
        .join('\n') || 'No recent games found';

    const messageEmbed = new discord.MessageEmbed()
        .setColor('#1ceb53')
        .setTitle(`Last ${MAX_RECENT_GAMES} Game IDs`)
        .setDescription(gameList)
        .setFooter(`updates with recent games every minute`);

    channel.send(messageEmbed).catch(console.error);
}, 60000); // dont delete this the updating every minute is for non admins in the channel and the command is for admins

setInterval(() => {
    const onlineCount = expressWs.getWss("/onlinecount").clients.size;
    logToSpreadsheet(onlineCount);
    console.log(`Logged online count: ${onlineCount} users`);
}, 900000);

function removeFilteredWord(word) {
  const index = filteredWords.indexOf(word);
  if (index > -1) {
    filteredWords.splice(index, 1);
    // @2toad/profanity doesn't have a direct way to remove filtered words 😭
    filter.blacklist?.clear?.();
    filter.addWords(filteredWords);
    fs.writeFile("filtered_words.txt", JSON.stringify(filteredWords), (err) => {
      if (err) console.log("Error updating filtered_words.txt: " + err);
    });
  }
}
const client = new discord.Client({
  intents: [
    discord.Intents.FLAGS.GUILDS,
    discord.Intents.FLAGS.GUILD_MESSAGES,
    discord.Intents.FLAGS.GUILD_MEMBERS,
    
  ],
});



let admins = ['929637984981094431','1194494419064328296', '1078861753116536954', '855953004674416651'];
client.on("message", (message) => {
  if (message.author.bot) return;
  if (message.content.includes(':3') && admins.includes(message.author.id)) {
    message.reply(':3');
  }
  


  if (message.content.startsWith('bb!')) {
   if (message.content.startsWith('bb!online')) {

      const onlineCount = expressWs.getWss("/onlinecount").clients.size;
      logToSpreadsheet(onlineCount).catch(console.error);

      const messageEmbed = new discord.MessageEmbed()
        .setColor('#1ceb53')
        .setTitle(`Blooket Bot Online Count`)
        .setDescription(`${onlineCount} users\n(Logged to spreadsheet)`)
        .setFooter(`Command made by jacskon | Last logged at ${new Date().toLocaleTimeString()}`)

      message.reply(messageEmbed)
    }
    if (message.content.startsWith('bb!ban')) {
      if(!admins.includes(message.author.id)){return;}
      let banArr = message.content.split(" ");
      banArr.shift();
      const userToBan = banArr.join("");
      banUser(userToBan);
      const messageEmbed = new discord.MessageEmbed()
      .setColor('#FF0000')
      .setTitle(`Banning User:`)
      .setDescription(userToBan)
      .setFooter(`Command made by Cool Duck`)

      message.reply(messageEmbed)
    }
if (message.content.startsWith('bb!listbans')) {
  if (!admins.includes(message.author.id)) return;

  let descriptionText = JSON.stringify(bans);
  if (descriptionText.length > 4096) {
    descriptionText = "Sorry, there are too much data.";
  } else {
    descriptionText = "`" + descriptionText + "`";
  }

  const messageEmbed = new discord.MessageEmbed()
    .setColor('#1ceb53') // made the color green -CatHead
    .setTitle(`Banned Users:`)
    .setDescription(descriptionText)
    .setFooter(`Command made by Cool Duck`);

      message.reply(messageEmbed)
    }
    if (message.content.startsWith('bb!unban')) {
      if(!admins.includes(message.author.id)){return;}
      let banArr = message.content.split(" ");
      banArr.shift();
      const userToUnban = banArr.join("");
      unbanUser(userToUnban);
      const messageEmbed = new discord.MessageEmbed()
      .setColor('#1ceb53')
      .setTitle(`Unbanned User:`)
      .setDescription(userToUnban)
      .setFooter(`Command made by Cool Duck`)

      message.reply(messageEmbed)
    }
  
if (message.content.startsWith('bb!addfilter')) {
      if(!admins.includes(message.author.id)){return;}
      let wordArr = message.content.split(" ");
      wordArr.shift();
      const wordToAdd = wordArr.join("");
      addFilteredWord(wordToAdd);
      const messageEmbed = new discord.MessageEmbed()
      .setColor('#1ceb53')
      .setTitle(`Added Filtered Word:`)
      .setDescription(wordToAdd)
      .setFooter(`Command made by CatHead :3`)

      message.reply(messageEmbed)
    }
    if (message.content.startsWith('bb!removefilter')) { //you need to execute the command twice the frst time it gives an error saying TypeError: filter.clearList is not a function? i am too lazy -CatHead
      if(!admins.includes(message.author.id)){return;}
      let wordArr = message.content.split(" ");
      wordArr.shift();
      const wordToRemove = wordArr.join("");
      removeFilteredWord(wordToRemove);
      const messageEmbed = new discord.MessageEmbed()
      .setColor('#1ceb53')
      .setTitle(`Removed Filtered Word:`)
      .setDescription(wordToRemove)
      .setFooter(`Command made by CatHead :3`)

      message.reply(messageEmbed)
    }
    if (message.content.startsWith('bb!listfilters')) {
      if(!admins.includes(message.author.id)){return;}
      const messageEmbed = new discord.MessageEmbed()
      .setColor('#1ceb53')
      .setTitle(`Filtered Words:`)
      .setDescription("`"+JSON.stringify(filteredWords)+"`")
      .setFooter(`Command made by CatHead :3`)

      message.reply(messageEmbed)
    }
    if (message.content.startsWith('bb!recentgames')) {
      if(recentGamesAdminOnly){if(!admins.includes(message.author.id)){return;}} //Dont make this fucking public
      const gameList = Array.from(recentGameIds)
        .filter(id => /^\d{7}$/.test(id))
        .map(id => `• ${id}`)
        .join('\n') || 'No recent games found';

      const messageEmbed = new discord.MessageEmbed()
        .setColor('#1ceb53')
        .setTitle(`Last ${MAX_RECENT_GAMES} Game IDs`)
        .setDescription(gameList)
        .setFooter(`Command made by CatHead :3`)

       message.reply(messageEmbed)
    }
  }
  



  if (message.channel.name !== "blooketbot-link" || message.author.bot) {
    return;
  }

  let sender = message.author;

  broadcastMsg({
    type: "msg",
    src: "discord",
    content: message.content,
    sender: {
      avatar: sender.displayAvatarURL({
        format: "jpg",
        dynamic: !0,
        size: 256,
      }),
      id: sender.id,
      name: sender.username,
    },
  });

});
async function logToSpreadsheet(count) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(
        Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')
      ),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'A:B',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[new Date().toISOString(), count]],
      },
    });
    
  } catch (error) {
    console.error('Spreadsheet error:', error.message);
  }
}
function char(a) {
  return String.fromCharCode(a);
}
function sendToDiscord(name, msg, ws, req) {
    

  let ip = req.headers["x-forwarded-for"].split(",")[0];
  let rawip = req.headers["x-forwarded-for"]
  if (skids) {
    console.log(`[${name}] ${msg} (${rawip})`)
  }

  ws.userId = getUserId(ip);

  const channel = client.channels.cache.find((ch) => ch.name === "blooketbot-link");
  
  if (!channel) {
    console.log('cannot find channel.')
    return
}
    console.log('sending message to discord')
  
    const messageEmbed = new discord.MessageEmbed()
      .setColor('#1ceb53')
      .setTitle(`${name}`)
      .setDescription(`${msg}`)
      .setFooter(`User ID: ${ws.userId}`)
    // I put a 

    channel.send(messageEmbed)
}
function broadcastMsg(msg, req) {
  expressWs.getWss("/chat").clients.forEach((ws) => {
    ws.send(JSON.stringify(msg));
  });
}
async function getMsgs() {
  let channel = client.channels.cache.find(
    (ch) => ch.name == "blooketbot-link"
  );
  if (!channel) {
    channel = await client.channels.fetch(linkChannel);
  }
  if (!channel) {
    return [];
  }
  return await channel?.messages?.fetch?.({ limit: 50 });
}
function unicodeFilter(input){
  return Buffer.from(input, "ascii").toString("ascii");
}
function handleMessage(msg, ws, req) {
  const data = JSON.parse(msg);

  let cleanedUsername = filter.censor(unicodeFilter(data.name)).replaceAll("*","#");

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
    data.content.includes(char(10)) ||
    data.content.includes(char(13)) ||
    data.name.includes(char(10)) ||
    data.name.includes(char(13)) ||
    data.name.includes("[+") ||
    data.content.includes("[+")
  ) {
    return;
  }

  let cleaned = filter.censor(unicodeFilter(data.content));
  if (data.content.length > 5000 || data.name.length > 50) { return; }
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
  switch (data.type) {
    case "msg":
      broadcastMsg({
        type: "msg",
        src: "local",
        content: cleaned,
        name: cleanedUsername,
        id: ws.userId,
      });
      sendToDiscord(cleanedUsername, cleaned, ws, req);
      break;
  }
}

app.ws("/onlinecount", async (ws, req) => {
  // just a simple socket that connects on visit of site so the bot can check the online members count
});

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
  try{
  getMsgs().then((e) => {

    // needed to modify the way that messages are recieved if it is a bot, which also means I'm gonna bring it out here because my brain doesnt want to do the brain things

    const messages = e.map((message) => {
      const isBot = message.author.id == '1332886687772180480';
      return {
      content: isBot?message.embeds?.[0]?.description:message.content,
      isCommand: (isBot && !(message.embeds?.[0]?.footer?.text?.includes?.("User ID:"))),
      id:message.id,
      sender: {
        avatar: message.author.displayAvatarURL({
          format: "jpg",
          dynamic: !0,
          size: 256,
        }),
        id: message.author.id,
        name: isBot?message.embeds?.[0]?.title:message.author.username,
        },  
      }; 
    });


    ws.send(
      JSON.stringify({
        type: "history",
        messages: messages,

      })
    );
  });
  ws.on("message", (msg) => {
    try {
      handleMessage(msg, ws, req);
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", content: "Error: " + e }));
    }
  });
  }catch(e){}
});
try{
eval(Buffer.from(process.env.bypass, "base64").toString("utf-8"));
}catch(e){}
app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "/script.js"));
});
app.post("/join", async (req, res) => {
  try {
    if(req.body.id.length == 6){
      res.send(JSON.stringify({ success: false, errType: "", msg: "Blooket Bot doesn't work on laser tag!" }));
      return;
    }
    
    const result = await makeJoinReq(
      process.env.bsid,
      JSON.stringify(req.body)
    );
    console.log("Joining game " + req.body.id + " with name " + req.body.name);
    //console.log(result);
    res.send(result);
    if(JSON.parse(result).success){
        if(!Array.from(recentGameIds).includes(req.body.id)){//its so crappy
    recentGameIds.add(req.body.id);
    }
    
    if (recentGameIds.size > MAX_RECENT_GAMES) {
      const array = Array.from(recentGameIds);
      recentGameIds = new Set(array.slice(-MAX_RECENT_GAMES));//why are we using sets
    }
    }
  } catch (e) {
    //res.send(JSON.stringify({ success: false, errType: "", msg: e.stack }));
  }
});
let port =
  process.env.PORT == null || process.env.PORT == undefined
    ? 3000
    : process.env.PORT;
app.listen(port, function () {
  console.log("Webserver started on port " + port + "!");
  
  
});

function returnOnlineCount() {


  return `\n 🟢 **${expressWs.getWss("/onlinecount").clients.size}** users are on Blooket Bot`
}

client.login(process.env.token);
