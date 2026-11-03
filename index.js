const crypto = require('crypto');
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

const dns = require('dns');
// Bulut sunucularda (Render, Fly vb.) IPv6 kaynaklı Gateway donmasını önlemek için IPv4 önceliği
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const {
    Client, GatewayIntentBits, Partials, PermissionsBitField,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder,
    AttachmentBuilder, ChannelType, AuditLogEvent, ActivityType
} = require('discord.js');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, VoiceConnectionStatus, StreamType,
    entersState
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');
require('dotenv').config();

// Canlı Durum ve Tanı Kayıtları
const liveLogs = [];
function addLiveLog(msg) {
    const time = new Date().toLocaleTimeString('tr-TR');
    liveLogs.push(`[${time}] ${msg}`);
    if (liveLogs.length > 50) liveLogs.shift();
    console.log(`[BOT DIAGNOSTIC] ${msg}`);
}

const wsStatusMap = {
    0: 'READY (Aktif / Çevrimiçi)',
    1: 'CONNECTING (Bağlanıyor)',
    2: 'RECONNECTING (Yeniden Bağlanıyor)',
    3: 'IDLE (Boşta)',
    4: 'NEARLY (Hazırlanıyor)',
    5: 'DISCONNECTED (Bağlantı Kesik)',
    6: 'WAITING_FOR_GUILDS (Sunucular Bekleniyor)',
    7: 'IDENTIFYING (Kimlik Doğrulanıyor)',
    8: 'RESUMING (Devam Ettiriliyor)'
};

// Render vb. bulut sunucularda botun aktif kalması ve canlı durum izleme HTTP sunucusu
const serverPort = process.env.PORT ? process.env.PORT : 3000;
const server = http.createServer((req, res) => {
    const isBotReady = Boolean(client && client.isReady && client.isReady());
    const wsCode = client && client.ws ? client.ws.status : null;
    const wsText = wsStatusMap[wsCode] || (wsCode !== null ? `Kod: ${wsCode}` : 'Bilinmiyor');

    // Gelen istek ve UptimeRobot pingini kaydet
    const ua = req.headers['user-agent'] || 'Bilinmeyen UA';
    if (!req.url.includes('favicon')) {
        addLiveLog(`[HTTP Ping] ${req.method} ${req.url} - UA: ${ua.slice(0, 35)}`);
    }

    const statusData = {
        versiyon: 'v2.1.2',
        durum: isBotReady ? 'ONLINE (Çevrimiçi)' : 'BEKLENİYOR / KESİK',
        botIsmi: client && client.user ? client.user.tag : 'Giriş Yapılmadı',
        discordWebsocketDurumu: wsText,
        mongoDurumu: isMongoConnected ? 'BAĞLI (MongoDB Atlas Bulut)' : 'YEREL (JSON Fallback)',
        tokenTanimliMi: Boolean(process.env.TOKEN),
        canliGunlukler: liveLogs
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(statusData, null, 2));
});
server.on('error', (err) => {
    console.error('HTTP Sunucusu Hatası:', err.message);
});
server.listen(serverPort, () => {
    addLiveLog(`HTTP sunucusu ${serverPort} portunda dinlemede.`);
});

// Render uyku önleyici dahili otomatik ping döngüsü (Keep-Alive)
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://memur-husnu-v2.onrender.com';
setInterval(async () => {
    try {
        await fetch(RENDER_EXTERNAL_URL);
    } catch (e) { }
}, 8 * 60 * 1000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction]
});

// Shard ve Bağlantı Hata / Tanı Dinleyicileri
client.on('error', error => addLiveLog(`Discord İstemci Hatası: ${error.message}`));
client.on('shardError', (error, shardId) => addLiveLog(`[Shard ${shardId} Hatası]: ${error.message}`));
client.on('shardDisconnect', (event, shardId) => addLiveLog(`[Shard ${shardId} Kesildi]: Kod ${event.code} (${event.reason || 'Sebep Yok'})`));
client.on('shardReconnecting', shardId => addLiveLog(`[Shard ${shardId}] Yeniden bağlanılıyor...`));
client.on('debug', msg => {
    // Heartbeat ve gecikme mesajları logları doldurmasın
    if (msg.includes('Heartbeat') || msg.includes('Latency') || msg.includes('Swept')) return;
    addLiveLog(`[DEBUG] ${msg}`);
});

// ============================================================================
// MONGODB ATLAS BULUT VERİTABANI VE YEREL ÖNBELLEK SİSTEMİ
// ============================================================================
const { MongoClient } = require('mongodb');
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://myk33glstn_db_user:ZiggXTF2FK7FUtUv@cluster0.n8kybmj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

let mongoClient = null;
let mongoCollection = null;
let isMongoConnected = false;

const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));

let memoryDB = {};
try {
    memoryDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} catch (e) {
    memoryDB = {};
}

const getDB = () => memoryDB;

let mongoSyncTimeout = null;
async function pushToMongo(data) {
    if (!isMongoConnected || !mongoCollection) return;
    try {
        await mongoCollection.updateOne(
            { _id: 'server_database' },
            { $set: { data: data, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (err) {
        addLiveLog(`[MONGODB KAYIT HATASI]: ${err.message}`);
    }
}

const saveDB = (data) => {
    memoryDB = data;
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));
    } catch (e) { }

    if (mongoSyncTimeout) clearTimeout(mongoSyncTimeout);
    mongoSyncTimeout = setTimeout(() => {
        pushToMongo(memoryDB);
    }, 1000);
};

async function initMongoDB() {
    try {
        addLiveLog('MongoDB Atlas bağlantısı kuruluyor...');
        mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
        const db = mongoClient.db('memur_husnu');
        mongoCollection = db.collection('bot_data');
        isMongoConnected = true;
        addLiveLog('✅ [MONGODB]: Atlas bulut veritabanına başarıyla bağlanıldı!');

        const remoteDoc = await mongoCollection.findOne({ _id: 'server_database' });
        if (remoteDoc && remoteDoc.data && Object.keys(remoteDoc.data).length > 0) {
            memoryDB = remoteDoc.data;
            try {
                fs.writeFileSync(dbPath, JSON.stringify(memoryDB, null, 4));
            } catch (e) { }
            addLiveLog('✅ [MONGODB]: Buluttaki güncel veriler (XP, Papel, Roller) yerel hafızaya aktarıldı.');
        } else {
            await pushToMongo(memoryDB);
            addLiveLog('✅ [MONGODB]: İlk kurulum - Mevcut veriler MongoDB bulutuna yüklendi.');
        }
    } catch (err) {
        isMongoConnected = false;
        addLiveLog(`⚠️ [MONGODB BAĞLANTI HATASI]: ${err.message} (15 sn sonra tekrar denenecek)`);
        setTimeout(initMongoDB, 15000);
    }
}

// Graceful Shutdown (Render yeniden başlatmalarında veya kapanırken verilerin eksiksiz MongoDB'ye kaydedilmesi)
let isShuttingDown = false;
async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    addLiveLog(`[SHUTDOWN] ${signal} sinyali alındı. Veriler buluta aktarılıyor...`);
    for (const guildId of Array.from(radioPlayers.keys())) {
        try { stopRadio(guildId); } catch (e) { }
    }
    if (mongoSyncTimeout) {
        clearTimeout(mongoSyncTimeout);
        mongoSyncTimeout = null;
    }
    if (isMongoConnected && mongoCollection) {
        try {
            await pushToMongo(memoryDB);
            addLiveLog('✅ [SHUTDOWN] Tüm veriler başarıyla MongoDB Atlas bulutuna kaydedildi.');
        } catch (e) {
            console.error('[SHUTDOWN] Hata:', e.message);
        }
    }
    process.exit(0);
}
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Geçici Hafıza Haritaları (Spam, Davet, Ses Süresi ve Cooldown Takibi)
const spamMap = new Map();
const invitesCache = new Map();
const voiceTimerMap = new Map();
const vcCooldownMap = new Map();
const renameCooldownMap = new Map();

function ensureGuildDB(db, guildId) {
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].users) db[guildId].users = {};
    if (!db[guildId].tempRooms) db[guildId].tempRooms = {};
    if (!db[guildId].tickets) db[guildId].tickets = {};
    if (!db[guildId].ticketPanels) db[guildId].ticketPanels = {};
    if (!db[guildId].trackers) db[guildId].trackers = [];
    if (!db[guildId].customKufurler) db[guildId].customKufurler = [];
    if (!Array.isArray(db[guildId].botWhitelist)) db[guildId].botWhitelist = [];
    if (db[guildId].antiBot === undefined) db[guildId].antiBot = true;
    if (!db[guildId].levelRoles) db[guildId].levelRoles = {};
    if (!Array.isArray(db[guildId].marketRoles)) db[guildId].marketRoles = [];
    if (!Array.isArray(db[guildId].tempUserRoles)) db[guildId].tempUserRoles = [];
    if (db[guildId].xpEnabled === undefined) db[guildId].xpEnabled = true;
    if (db[guildId].gamesEnabled === undefined) db[guildId].gamesEnabled = true;
    if (db[guildId].kickKanal && !db[guildId].duyuruKanal) {
        db[guildId].duyuruKanal = db[guildId].kickKanal;
        delete db[guildId].kickKanal;
    }
    if (db[guildId].kickBot) {
        delete db[guildId].kickBot;
    }
}

// ============================================================================
// 7/24 KESİNTİSİZ CANLI TÜRKÇE RADYO SİSTEMİ (MÜZİK & HABER KATEGORİLERİ)
// ============================================================================
const RADIO_STATIONS = {
    muzik: [
        { id: 'cem_radyo', name: 'Cem Radyo', desc: 'Halk & Özgün Müzik (İstanbul 96.4)', emoji: '📻', url: 'https://erzincan.80.yayin.com.tr/stream' },
        { id: 'trt_fm', name: 'TRT FM', desc: 'Türkçe Pop & Karışık Müzik', emoji: '📻', url: 'https://rd-trtfm.medya.trt.com.tr/master_128.m3u8' },
        { id: 'trt_turku', name: 'TRT Türkü', desc: 'Türk Halk Müziği & Bozlak', emoji: '📻', url: 'https://rd-trtturku.medya.trt.com.tr/master_128.m3u8' },
        { id: 'power_turk', name: 'Power Türk', desc: 'Türkçe Pop & En Çok Dinlenenler', emoji: '🔥', url: 'https://listen.powerapp.com.tr/powerturk/mpeg/icecast.audio' },
        { id: 'power_fm', name: 'Power FM', desc: 'Yabancı Hit & Pop Müzik', emoji: '🎵', url: 'https://listen.powerapp.com.tr/powerfm/mpeg/icecast.audio' },
        { id: 'slow_turk', name: 'Slow Türk', desc: 'Duygusal & Türkçe Aşk Şarkıları', emoji: '❤️', url: 'https://radyo.duhnet.tv/slowturk' },
        { id: 'kral_pop', name: 'Kral Pop', desc: 'Türkçe Pop Müziğin Zirvesi', emoji: '👑', url: 'https://moondigitalmaster.radyotvonline.net/kralpop/playlist.m3u8' },
        { id: 'kral_fm', name: 'Kral FM', desc: 'İlaç Gibi Radyo (Arabesk & Damar)', emoji: '👑', url: 'https://moondigitalmaster.radyotvonline.net/kralfm/playlist.m3u8' },
        { id: 'alem_fm', name: 'Alem FM', desc: 'Cümle Alem Burada (Pop & Eğlence)', emoji: '🎉', url: 'https://turkmedya.radyotvonline.net/alemfmaac' },
        { id: 'pal_fm', name: 'Pal FM', desc: 'Müziğin Kalbi Burada Atıyor', emoji: '✨', url: 'https://moondigitaledge.radyotvonline.net/palfm/playlist.m3u8' },
        { id: 'radyo_viva', name: 'Radyo Viva', desc: 'Türkçe Pop & Nostalji Klasikleri', emoji: '🎶', url: 'https://moondigitaledge.radyotvonline.net/radyoviva/playlist.m3u8' }
    ],
    haber: [
        { id: 'trt_radyo1', name: 'TRT Radyo 1', desc: 'Haber, Kültür & Edebiyat', emoji: '📰', url: 'https://rd-trtradyo1.medya.trt.com.tr/master_128.m3u8' },
        { id: 'ntv_radyo', name: 'NTV Radyo', desc: 'Haberin Doğru Adresi & Gündem', emoji: '🎙️', url: 'http://ntvrdwmp.radyotvonline.com/' },
        { id: 'cnn_turk', name: 'CNN Türk Radyo', desc: 'İlk Bilen Siz Olun (Canlı Yayın)', emoji: '📺', url: 'https://moondigitaledge2.radyotvonline.net/cnnturk/playlist.m3u8' },
        { id: 'a_haber', name: 'A Haber Radyo', desc: 'Türkiye ve Dünya Gündemi', emoji: '🔴', url: 'https://trkvz-radyolar.ercdn.net/ahaberradyo/playlist.m3u8' },
        { id: 'haberturk', name: 'Habertürk Radyo', desc: 'Doğru Haber & Tarafsız Yorum', emoji: '📰', url: 'https://moondigitalmaster.radyotvonline.net/haberturkradyo/playlist.m3u8' },
        { id: 'a_spor', name: 'A Spor Radyo', desc: 'Canlı Maç Anlatımı & Spor Haberleri', emoji: '⚽', url: 'https://trkvz-radyolar.ercdn.net/asporradyo/playlist.m3u8' },
        { id: 'diyanet_radyo', name: 'Diyanet Radyo', desc: 'İyiliğin ve Doğruluğun Sesi', emoji: '🕌', url: 'https://eustr73.mediatriple.net/videoonlylive/mtikoimxnztxlive/broadcast_5e3c1171d7d2a.smil/playlist.m3u8' }
    ]
};

const radioPlayers = new Map();

function buildRadioView(guild, voiceChannelId, activeStation = null) {
    const radioData = radioPlayers.get(guild.id);
    const currentPlaying = activeStation || (radioData ? radioData.station : null);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: 'Memur Hüsnü — Canlı Radyo Yayını',
            iconURL: client.user ? client.user.displayAvatarURL({ dynamic: true }) : undefined
        })
        .setColor(currentPlaying ? 0x57f287 : 0x2b2d31)
        .setDescription(
            `### 📻 Canlı Radyo Kontrol Masası\n` +
            `*Bulunduğunuz ses odasında 7/24 kesintisiz canlı radyo dinleyebilirsiniz.*\n\n` +
            `> 🔊 **Bağlı Ses Odası:** ${voiceChannelId ? `<#${voiceChannelId}>` : '*Bağlı değil*'}\n` +
            `> 📡 **Şu An Çalan:** ${currentPlaying ? `**${currentPlaying.emoji} ${currentPlaying.name}**\n> 📝 *${currentPlaying.desc}*` : '*Henüz bir radyo istasyonu seçilmedi. Aşağıdaki menülerden seçim yapabilirsiniz.*'}\n` +
            `> ⚡ **Yayın Durumu:** ${currentPlaying ? '🟢 **Canlı Yayında (Çalıyor)**' : '⚪ **Beklemede**'}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Aşağıdaki menülerden **Müzik** veya **Haber & Spor** kategorisindeki hazır radyolardan dilediğinizi seçebilirsiniz:`
        )
        .setFooter({ text: 'Not: Ses odasında kimse kalmadığında bot yayını otomatik kapatır ve ayrılır.' })
        .setTimestamp();

    if (currentPlaying && client.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ dynamic: true }));
    }

    const musicOptions = RADIO_STATIONS.muzik.map(s => ({
        label: s.name,
        description: s.desc.slice(0, 100),
        value: s.id,
        emoji: s.emoji,
        default: Boolean(currentPlaying && currentPlaying.id === s.id)
    }));

    const newsOptions = RADIO_STATIONS.haber.map(s => ({
        label: s.name,
        description: s.desc.slice(0, 100),
        value: s.id,
        emoji: s.emoji,
        default: Boolean(currentPlaying && currentPlaying.id === s.id)
    }));

    const musicRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_radio_muzik')
            .setPlaceholder('🎵 Müzik Radyoları (Cem Radyo, TRT FM, Kral, Power...)')
            .addOptions(musicOptions)
    );

    const newsRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_radio_haber')
            .setPlaceholder('📰 Haber & Spor Radyoları (TRT 1, NTV, CNN Türk, A Spor...)')
            .addOptions(newsOptions)
    );

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_radio_stop')
            .setLabel('Radyoyu Kapat & Ayrıl')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️')
            .setDisabled(!Boolean(currentPlaying)),
        new ButtonBuilder()
            .setCustomId(`btn_radio_refresh_${voiceChannelId || 'none'}`)
            .setLabel('Yenile')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );

    return { embeds: [embed], components: [musicRow, newsRow, btnRow] };
}

async function playRadio(guild, voiceChannel, station) {
    const existing = radioPlayers.get(guild.id);
    if (existing) {
        if (existing.process) {
            try { existing.process.kill(); } catch (e) { }
        }
        if (existing.player) {
            existing.player.stop();
        }
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
        connection.destroy();
        throw new Error(`Ses kanalına bağlanılamadı: ${err.message}`);
    }

    const ffmpegProcess = spawn(ffmpegPath, [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', station.url,
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-ac', '2',
        '-ar', '48000',
        '-f', 's16le',
        'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const resource = createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
    const player = createAudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    player.on('error', error => {
        addLiveLog(`[RADYO HATASI] (${station.name}): ${error.message}`);
    });

    radioPlayers.set(guild.id, {
        connection,
        player,
        process: ffmpegProcess,
        station,
        channelId: voiceChannel.id
    });

    addLiveLog(`[RADYO BAŞLADI] ${station.name} -> ${guild.name} / ${voiceChannel.name}`);
}

function stopRadio(guildId) {
    const radio = radioPlayers.get(guildId);
    if (!radio) return;

    if (radio.process) {
        try { radio.process.kill(); } catch (e) { }
    }
    if (radio.player) {
        try { radio.player.stop(); } catch (e) { }
    }
    if (radio.connection) {
        try { radio.connection.destroy(); } catch (e) { }
    }
    radioPlayers.delete(guildId);
    addLiveLog(`[RADYO DURDURULDU] Guild ID: ${guildId}`);
}

// ============================================================================
// ÇOKLU PLATFORM YAYIN & İÇERİK DUYURU SİSTEMİ (YOUTUBE, KICK, TWITCH)
// ============================================================================
async function resolveChannelLink(inputUrl) {
    const clean = inputUrl.trim();

    // 1. Twitch: https://twitch.tv/kanal veya https://www.twitch.tv/kanal
    const twitchMatch = clean.match(/twitch\.tv\/([a-zA-Z0-9_]{3,25})/i);
    if (twitchMatch) {
        const slug = twitchMatch[1].toLowerCase();
        return { platform: 'twitch', slug, name: slug, url: `https://twitch.tv/${slug}` };
    }

    // 2. Kick: https://kick.com/kanal veya https://www.kick.com/kanal
    const kickMatch = clean.match(/kick\.com\/([a-zA-Z0-9_-]{3,25})/i);
    if (kickMatch) {
        const slug = kickMatch[1].toLowerCase();
        return { platform: 'kick', slug, name: slug, url: `https://kick.com/${slug}` };
    }

    // 3. YouTube: Kanal ID veya @Handle
    const ytChannelMatch = clean.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/i);
    if (ytChannelMatch) {
        const chId = ytChannelMatch[1];
        return { platform: 'youtube', channelId: chId, name: chId, url: `https://www.youtube.com/channel/${chId}` };
    }

    const ytHandleMatch = clean.match(/youtube\.com\/(@[a-zA-Z0-9_.-]+)/i);
    if (ytHandleMatch) {
        try {
            const handle = ytHandleMatch[1];
            const res = await fetch(`https://www.youtube.com/${handle}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const html = await res.text();
            const chId = html.match(/channel_id=([a-zA-Z0-9_-]+)/i)?.[1] || html.match(/"externalId":"([^"]+)"/i)?.[1];
            const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(' - YouTube', '').trim() || handle;
            if (chId) {
                return { platform: 'youtube', channelId: chId, name: title, url: `https://www.youtube.com/${handle}` };
            }
        } catch (e) { }
    }

    return null;
}

async function checkTwitch(slug) {
    try {
        const res = await fetch('https://gql.twitch.tv/gql', {
            method: 'POST',
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: `query { user(login: "${slug}") { displayName profileImageURL(width: 300) stream { id title viewersCount previewImageURL(width: 1280, height: 720) } } }`
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const user = data.data?.user;
        if (!user) return null;
        if (!user.stream) return { isLive: false, name: user.displayName, avatar: user.profileImageURL };

        const previewImg = user.stream.previewImageURL
            ? user.stream.previewImageURL.replace('{width}', '1280').replace('{height}', '720')
            : user.profileImageURL;

        return {
            isLive: true,
            id: user.stream.id,
            name: user.displayName,
            avatar: user.profileImageURL,
            title: user.stream.title || `${user.displayName} Canlı Yayında`,
            url: `https://twitch.tv/${slug}`,
            image: previewImg,
            color: 0x9146FF
        };
    } catch (e) {
        return null;
    }
}

async function checkKick(slug) {
    try {
        let data = null;

        // 1. Cloudflare TLS korumasını aşmak için curl ile v2 API çağrısı
        try {
            const { stdout } = await execFileAsync('curl', [
                '-s',
                '--compressed',
                '-m', '10',
                '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                `https://kick.com/api/v2/channels/${slug}`
            ]);
            if (stdout && stdout.trim().startsWith('{')) {
                data = JSON.parse(stdout);
            }
        } catch (e) { }

        // 2. curl v2 başarısız olursa curl ile v1 API dene
        if (!data || !data.user) {
            try {
                const { stdout } = await execFileAsync('curl', [
                    '-s',
                    '--compressed',
                    '-m', '10',
                    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    `https://kick.com/api/v1/channels/${slug}`
                ]);
                if (stdout && stdout.trim().startsWith('{')) {
                    data = JSON.parse(stdout);
                }
            } catch (e) { }
        }

        // 3. curl çalışmazsa yedek olarak standart fetch dene
        if (!data || !data.user) {
            try {
                const res = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    }
                });
                if (res.ok) data = await res.json();
            } catch (e) { }
        }

        if (!data || !data.user) {
            addLiveLog(`[KICK KONTROL] ${slug} verisi alınamadı (Cloudflare veya API engeli).`);
            return null;
        }

        const user = data.user;
        const livestream = data.livestream;
        const name = user?.username || slug;
        const avatar = user?.profile_pic || null;

        if (!livestream || livestream.is_live === false) {
            return { isLive: false, name, avatar };
        }

        return {
            isLive: true,
            id: String(livestream.id),
            name,
            avatar,
            title: livestream.session_title || `${name} Canlı Yayında`,
            url: `https://kick.com/${slug}`,
            image: livestream.thumbnail?.url || avatar,
            color: 0x53FC18
        };
    } catch (e) {
        addLiveLog(`[KICK HATA] ${slug}: ${e.message}`);
        return null;
    }
}

async function checkYouTube(channelId) {
    try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (!res.ok) return null;
        const xml = await res.text();
        const videoId = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
        const title = xml.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/)?.[1];
        const name = xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/)?.[1] || 'YouTube';

        if (!videoId) return null;
        return {
            isLive: true,
            id: videoId,
            name,
            title: title || 'Yeni İçerik',
            url: `https://www.youtube.com/watch?v=${videoId}`,
            image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            color: 0xFF0000
        };
    } catch (e) {
        return null;
    }
}

async function checkAllStreamTrackers() {
    if (!client.isReady || !client.isReady()) return;
    const db = getDB();
    let dbUpdated = false;

    for (const guild of client.guilds.cache.values()) {
        const guildDb = db[guild.id];
        if (!guildDb || !guildDb.duyuruKanal || !Array.isArray(guildDb.trackers) || guildDb.trackers.length === 0) continue;

        let targetChannel = guild.channels.cache.get(guildDb.duyuruKanal);
        if (!targetChannel) {
            targetChannel = await guild.channels.fetch(guildDb.duyuruKanal).catch(() => null);
        }
        if (!targetChannel) {
            addLiveLog(`[DUYURU HATA] #${guildDb.duyuruKanal} kanalı bulunamadı veya erişilemedi (${guild.name}).`);
            continue;
        }

        const mention = guildDb.duyuruRol ? `<@&${guildDb.duyuruRol}>` : '@everyone';

        for (const tracker of guildDb.trackers) {
            try {
                let info = null;
                if (tracker.platform === 'twitch') info = await checkTwitch(tracker.slug);
                else if (tracker.platform === 'kick') info = await checkKick(tracker.slug);
                else if (tracker.platform === 'youtube') info = await checkYouTube(tracker.channelId);

                if (!info) continue;

                if (info.isLive) {
                    // Eğer bu yayın/video henüz duyurulmadıysa
                    if (tracker.lastSeenId !== info.id) {
                        tracker.lastSeenId = info.id;
                        dbUpdated = true;

                        const embed = new EmbedBuilder()
                            .setAuthor({ name: info.name, iconURL: info.avatar || undefined, url: info.url })
                            .setTitle(info.title)
                            .setURL(info.url)
                            .setColor(info.color)
                            .setTimestamp();

                        if (info.image) embed.setImage(info.image);

                        const isVideo = tracker.platform === 'youtube';
                        const btnLabel = isVideo ? 'Videoyu İzle' : 'Yayını İzle';
                        const contentMsg = isVideo
                            ? `${mention} **${info.name}** yeni bir içerik yayınladı!`
                            : `${mention} **${info.name}** yayında!`;

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setLabel(btnLabel).setStyle(ButtonStyle.Link).setURL(info.url)
                        );

                        await targetChannel.send({ content: contentMsg, embeds: [embed], components: [row] });
                        addLiveLog(`[YAYIN DUYURUSU BAŞARILI] ${info.name} (${tracker.platform}) -> #${targetChannel.name} (${guild.name})`);
                    }
                } else {
                    // Yayın kapandıysa bir sonraki yayında tekrar duyurabilmek için sıfırla
                    if (tracker.platform !== 'youtube' && tracker.lastSeenId) {
                        tracker.lastSeenId = null;
                        dbUpdated = true;
                        addLiveLog(`[YAYIN BİTTİ] ${tracker.name || tracker.slug} (${tracker.platform}) yayını sonlandı.`);
                    }
                }
            } catch (err) {
                addLiveLog(`[YAYIN DUYURU HATA] ${tracker.name || tracker.slug}: ${err.message}`);
            }
        }
    }

    if (dbUpdated) saveDB(db);
}

// 1 dakikada bir otomatik kontrol döngüsü
setInterval(checkAllStreamTrackers, 60000);

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours} saat`);
    if (minutes > 0) parts.push(`${minutes} dakika`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} saniye`);
    return parts.join(' ');
}

// 100 mesaj sınırına takılmadan tüm ticket geçmişini çeken fonksiyon
async function fetchAllMessages(channel, maxMessages = 1000) {
    let allMessages = [];
    let lastId = null;

    while (allMessages.length < maxMessages) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options).catch(() => null);
        if (!messages || messages.size === 0) break;

        allMessages.push(...Array.from(messages.values()));
        lastId = messages.last().id;

        if (messages.size < 100) break;
    }

    return allMessages.reverse();
}

// ============================================================================
// XP VE PAPEL (EKONOMİ) SİSTEMİ ALTYAPISI
// ============================================================================
const XP_LEVELS = [
    { level: 1, xp: 50000, title: 'Çaylak (Seviye 1)' },
    { level: 2, xp: 150000, title: 'Gezgin (Seviye 2)' },
    { level: 3, xp: 400000, title: 'Kıdemli (Seviye 3)' },
    { level: 4, xp: 900000, title: 'Usta (Seviye 4)' },
    { level: 5, xp: 1600000, title: 'Şampiyon (Seviye 5)' },
    { level: 6, xp: 2300000, title: 'Efsane (Seviye 6)' },
    { level: 7, xp: 3000000, title: 'Hükümdar (Seviye 7 - Maksimum)' }
];

function calculateLevel(xp) {
    let currentLevel = 0;
    for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
        if (xp >= XP_LEVELS[i].xp) {
            currentLevel = XP_LEVELS[i].level;
            break;
        }
    }
    return currentLevel;
}

function getNextLevelInfo(xp) {
    for (const lvl of XP_LEVELS) {
        if (xp < lvl.xp) {
            return lvl;
        }
    }
    return null;
}

function makeProgressBar(current, target, size = 12) {
    if (target <= 0) return `\`${'█'.repeat(size)}\``;
    const percentage = Math.min(Math.max(current / target, 0), 1);
    const filled = Math.round(size * percentage);
    const empty = size - filled;
    return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\``;
}

function formatDurationLabel(days) {
    if (!days || days <= 0) return 'Kalıcı';
    if (days === 7) return '<1 hafta>';
    if (days === 14) return '<2 hafta>';
    if (days === 30) return '<aylık>';
    return `<${days} gün>`;
}

function formatDurationRemaining(ms) {
    if (ms <= 0) return 'Süresi doldu';
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = totalMinutes % 60;
    if (days > 0) return `${days} gün ${hours} saat`;
    if (hours > 0) return `${hours} saat ${mins} dakika`;
    return `${mins} dakika`;
}

const voiceSecondsMap = new Map();

// Ses Odası XP ve Papel Kazanım Döngüsü + Süreli Rol Kontrolü (Her 30 saniyede bir kontrol eder)
setInterval(async () => {
    if (!client.isReady || !client.isReady()) return;
    const db = getDB();
    let dbUpdated = false;

    for (const guild of client.guilds.cache.values()) {
        ensureGuildDB(db, guild.id);

        // Süreli Rol Kontrolü (Temp Roles Expiration - Önbellek dışı üyeleri de sunucudan çeker)
        if (Array.isArray(db[guild.id].tempUserRoles) && db[guild.id].tempUserRoles.length > 0) {
            const now = Date.now();
            const remainingRoles = [];
            for (const item of db[guild.id].tempUserRoles) {
                if (item.expiresAt <= now) {
                    const mem = guild.members.cache.get(item.userId) || await guild.members.fetch(item.userId).catch(() => null);
                    if (mem) {
                        await mem.roles.remove(item.roleId).catch(() => { });
                    }
                    dbUpdated = true;
                } else {
                    remainingRoles.push(item);
                }
            }
            db[guild.id].tempUserRoles = remainingRoles;
        }

        guild.voiceStates.cache.forEach(vs => {
            const member = vs.member;
            if (!member || member.user.bot || !vs.channelId) return;

            // AFK kanalındaysa veya hem kulaklık hem mikrofon kapalıysa (Self-Deaf + Self-Mute) XP/Papel sayma
            if (guild.afkChannelId && vs.channelId === guild.afkChannelId) return;
            if (vs.selfDeaf && vs.selfMute) return;

            const channel = vs.channel;
            if (!channel) return;

            ensureGuildDB(db, guild.id);
            if (db[guild.id].xpEnabled === false) return;

            const vKey = `${guild.id}-${member.id}`;
            const currentSecs = (voiceSecondsMap.get(vKey) || 0) + 30;
            voiceSecondsMap.set(vKey, currentSecs);

            if (!db[guild.id].users[member.id]) {
                db[guild.id].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
            }
            const userData = db[guild.id].users[member.id];
            if (userData.xp === undefined) userData.xp = 0;
            if (userData.level === undefined) userData.level = 0;
            if (userData.papel === undefined) userData.papel = 0;
            if (userData.lastVoiceXp === undefined) userData.lastVoiceXp = 0;

            const nowTime = Date.now();
            // Seste XP aldıktan sonra en az 90 saniye (1 dk ses + 30 sn soğuma süresi) boyunca tekrar XP kazanamaz
            if (!userData.xpDisabled && nowTime - userData.lastVoiceXp >= 90000) {
                userData.lastVoiceXp = nowTime;
                let voiceXp = Math.floor(Math.random() * 11) + 10;
                if (vs.streaming || vs.selfVideo) voiceXp = Math.floor(voiceXp * 1.5);
                userData.xp += voiceXp;
                dbUpdated = true;
            }

            // 10 dakikada (600 saniye seste durunca) 1 Papel kazanımı
            if (currentSecs % 600 === 0) {
                let papelDrop = 1;
                // Şansa bağlı artış: %2 şansla 2 Papel
                const lucky = Math.random();
                if (lucky < 0.02) papelDrop = 2;

                userData.papel += papelDrop;
                dbUpdated = true;
            }

            // Seviye kontrolü
            if (!userData.xpDisabled) {
                const newLevel = calculateLevel(userData.xp);
                if (newLevel > userData.level) {
                    userData.level = newLevel;
                    const roleId = db[guild.id]?.levelRoles?.[String(newLevel)];
                    if (roleId) {
                        member.roles.add(roleId).catch(() => { });
                    }
                    dbUpdated = true;
                }
            }
        });
    }

    if (dbUpdated) saveDB(db);
}, 30000);

// ============================================================================
// GELİŞMİŞ KÜFÜR VE ARGO TESPİT MOTORU (ANTI-BYPASS & BAĞLAM KORUMALI)
// ============================================================================
function kufurTespitEt(metin, customList = []) {
    if (!metin) return false;

    // Discord etiketlerini (kullanıcı, rol, kanal ve emoji ID'leri) küfür kontrolünden önce temizle
    // (Böylece ID numaralarının harf dönüşümünden hatalı küfür uyarısı çıkması engellenir)
    const cleanMetin = metin.replace(/<@!?\d+>|<@&\d+>|<#\d+>|<a?:\w+:\d+>/g, ' ');

    let text = cleanMetin.toLocaleLowerCase('tr-TR');

    const charMap = {
        '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
        '@': 'a', '$': 's', '!': 'i', '¡': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'e',
        'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u',
        'q': 'k', 'w': 'v', 'x': 'ks'
    };

    let normText = '';
    for (let char of text) {
        normText += charMap[char] ? charMap[char] : char;
    }

    // 1. Noktalama, alt çizgi ve özel sembolleri temizleyip kelime ayrıştırma (a.m.k, s_i_k, o.ç, a*q)
    const cleanPunctuation = normText.replace(/[\._\-\*\~\,\;\:\/\\\|\(\)\[\]\{\}\<\>\+\=\?\^\#\$\%\&\!\@]/g, ' ');
    const dedupedPunct = cleanPunctuation.replace(/(.)\1+/g, '$1');
    const wordsOnly = dedupedPunct.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordsArray = wordsOnly.split(' ');
    const strippedText = normText.replace(/(.)\1+/g, '$1').replace(/[^a-z]/g, '');

    // Harfler arasına nokta/boşluk/çizgi konularak yapılan bypass girişimlerini yakalama
    const bypassRegex = /(?:^|[\s\W_])([a4@][\s\W_]*[m][\s\W_]*[kqv]|[a4@][\s\W_]*[kq]|[o0][\s\W_]*[cç]|[p][\s\W_]*[i1!][\s\W_]*[cç]|[s5$][\s\W_]*[i1!][\s\W_]*[k]|[s5$][\s\W_]*[g]|[m][\s\W_]*[kq])(?:[\s\W_]|$)/i;
    if (bypassRegex.test(normText)) return true;

    // Sunucuya özel yasaklı kelimeler kontrolü
    if (Array.isArray(customList) && customList.length > 0) {
        for (let custom of customList) {
            const cleanCustom = custom.toLowerCase().trim();
            if (wordsArray.includes(cleanCustom) || strippedText.includes(cleanCustom)) return true;
        }
    }

    // Doğrudan kelime bazlı küfürler (Masum kelimeler: top, amin, sulan, anan buradan çıkartıldı)
    const kelimeBazliKufurler = [
        'amk', 'amc', 'amq', 'aq', 'oc', 'oç', 'pic', 'piç', 'sik', 'sg', 'mk', 'mq',
        'got', 'göt', 'amcik', 'amck',
        'siki', 'sikim', 'sikin', 'sikis', 'siker', 'sikerim', 'sikeyim', 'sikik', 'siktir', 'sktr', 'siktin', 'sokuk', 'sokarim', 'sokam',
        'yarak', 'yarrak', 'yarag', 'yarrag', 'yarram', 'yaraam',
        'orspu', 'orospu', 'oruspu', 'orosbu', 'orusbu',
        'pezevenk', 'pezeveng', 'pzvnk', 'gavat', 'kaltak', 'kahpe', 'kahbe', 'kancik', 'kevase', 'kaltag',
        'ibne', 'ipne', 'puşt', 'pust', 'yavsak', 'yavşak', 'gotten', 'gotveren', 'götveren',
        'dalyarak', 'dalyarrak', 'malafat', 'taşak', 'tasak', 'tassak', 'daşak', 'dasak', 'dassak',
        'angut', 'lavuk', 'zibidi', 'haysiyetsiz', 'serefsiz', 'şerefsiz', 'namussuz', 'itoglu', 'kopekoglu'
    ];

    for (let word of wordsArray) {
        if (kelimeBazliKufurler.includes(word)) return true;
        if (/^(siktir|sikis|siker|sikey|sikim|orospu|oruspu|pezevenk|yavsak|amcik|yarrak|yarak|gotveren|kahpe|kaltak)/.test(word)) {
            return true;
        }
    }

    // Aileye ve Şahsa Yönelik Ağır Hakaret & Küfür Kombinasyonları
    const aileveSahisKufurleri = [
        /anan[ıi]?n?\s*(am[ıi]|sik|got|bac|sülale|ecdad|avrad|avrat|mezari)/i,
        /anan[ıi]\s*(sike|sikt|sok|sik|ye)/i,
        /bac[ıi]n[ıi]\s*(sike|sikt|sok|sik)/i,
        /s[uü]l[aâ]len[ıi]\s*(sike|sikt|sok|sik)/i,
        /ecdad[ıi]n[ıi]\s*(sike|sikt|sok|sik)/i,
        /avrad[ıi]n[ıi]\s*(sike|sikt|sok|sik)/i,
        /am[ıi]na\s*(koy|sok|cak|yag|soki|kor)/i,
        /am[ıi]n[ıi]\s*(sik|sok|des)/i,
        /g[oö]t[uü]n[eü]\s*(koy|sok|gir)/i
    ];

    for (let reg of aileveSahisKufurleri) {
        if (reg.test(normText)) return true;
    }

    const agirKombinasyonlar = [
        'orospu', 'oruspu', 'orosbu', 'pezevenk', 'pezeveng', 'siktir', 'sikerim', 'sikeyim', 'sikis',
        'amcik', 'aminakoy', 'aminasok', 'aminisik', 'ananisik', 'ananisikeyim', 'bacinisik', 'sulalenisik',
        'yarrak', 'yarram', 'dalyarak', 'gotveren', 'gotten', 'yavsak', 'kahpe', 'kaltak', 'gavat', 'orcocu', 'orospucocu'
    ];

    for (let agir of agirKombinasyonlar) {
        if (strippedText.includes(agir)) return true;
    }

    return false;
}

const otoCevaplar = [
    { tetikleyiciler: ["sa", "s.a", "selam", "selamun aleyküm", "sea", "selamın aleyküm"], cevaplar: ["Aleykümselam, hoş geldin.", "Selam, hoş geldin."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["günaydın", "gunaydin", "hayırlı sabahlar"], cevaplar: ["Günaydın, iyi günler.", "Günaydın, hoş geldin."], etiketle: true, tamKelime: false },
    { tetikleyiciler: ["iyi geceler", "iyi akşamlar", "iyi aksamlar", "hayırlı geceler"], cevaplar: ["İyi geceler.", "İyi akşamlar."], etiketle: false, tamKelime: false },
    { tetikleyiciler: ["hg", "hoş geldin", "hoşgeldin"], cevaplar: ["Hoş bulduk, teşekkürler.", "Teşekkür ederim."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["bb", "görüşürüz", "gorusuruz", "ben kaçar", "çıkıyorum", "allaha emanet", "baybay"], cevaplar: ["Görüşmek üzere.", "Güle güle, yine bekleriz."], etiketle: false, tamKelime: true },
    { tetikleyiciler: ["nasılsın", "naber", "nasilsin", "ne haber", "napıyorsun", "nabıyon"], cevaplar: ["İyiyim, teşekkürler. Sen nasılsın?", "Her şey yolunda, teşekkürler."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["teşekkürler", "sağ ol", "sağol", "eyvallah", "teşekkür ederim", "eyv"], cevaplar: ["Rica ederim.", "Ne demek, her zaman."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["lan", "sus", "kes", "aptal", "mal", "salak"], cevaplar: ["Lütfen üslubumuza dikkat edelim.", "Birbirimize karşı daha saygılı olalım."], etiketle: true, tamKelime: true }
];

// Denetim Kaydından (Audit Log) İşlemi Yapan Yetkiliyi Bulma Fonksiyonu
async function getAuditExecutor(guild, actionType, targetId = null) {
    try {
        const fetchedLogs = await guild.fetchAuditLogs({ limit: 5, type: actionType });
        const logEntry = fetchedLogs.entries.find(entry => {
            const isRecent = (Date.now() - entry.createdTimestamp) < 10000;
            const isTargetMatch = targetId ? (entry.target && entry.target.id === targetId) : true;
            return isRecent && isTargetMatch;
        });
        return logEntry ? logEntry.executor : null;
    } catch (e) {
        return null;
    }
}

// Log Kanalına Embed Gönderme Fonksiyonu
async function sendLog(guild, logCategory, options, files = []) {
    if (!guild) return;
    const db = getDB();
    if (!db[guild.id] || !db[guild.id][logCategory]) return;
    const channelId = db[guild.id][logCategory];
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        const embedColor = options.color ? options.color : 0x2b2d31;
        const embed = new EmbedBuilder()
            .setTitle(options.title)
            .setDescription(options.desc)
            .setColor(embedColor)
            .setTimestamp();
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.footer) embed.setFooter({ text: options.footer });
        channel.send({ embeds: [embed], files: files }).catch(() => { });
    }
}

// Otomatik Hapis (Jail) Uygulama Fonksiyonu
async function applyJail(member, guild, reason) {
    if (!member || !guild) return;
    const db = getDB();
    ensureGuildDB(db, guild.id);
    if (!db[guild.id].users[member.id]) {
        db[guild.id].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
    }

    let userData = db[guild.id].users[member.id];
    userData.jailCount += 1;
    userData.sicilli = true;

    const durations = [15, 30, 60, 180];
    let durationMins = durations[userData.jailCount - 1] ? durations[userData.jailCount - 1] : 180;
    userData.jailExpire = Date.now() + (durationMins * 60 * 1000);
    saveDB(db);

    if (member.manageable) {
        if (db[guild.id].jailRol) await member.roles.add(db[guild.id].jailRol).catch(() => { });
        if (db[guild.id].sicilRol) await member.roles.add(db[guild.id].sicilRol).catch(() => { });
    }

    sendLog(guild, 'logCeza', {
        title: 'Otomatik Cezalandırma (Hapis)',
        desc: `**Kullanıcı:** <@${member.id}> (\`${member.id}\`)\n**Sebep:** ${reason}\n**Süre:** ${durationMins} dakika\n**Toplam İhlal:** ${userData.jailCount}\n**Sicil Durumu:** İşlendi`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
}

// Küfür Uyarısı (24 Saatlik Zaman Aşımı Korumalı) ve 3. İhlalde Hapis Fonksiyonu
async function handleProfanity(message, db, guildId) {
    await message.delete().catch(() => { });
    ensureGuildDB(db, guildId);
    if (!db[guildId].users[message.author.id]) {
        db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
    }

    let userData = db[guildId].users[message.author.id];
    const now = Date.now();

    // 24 saatten (86.400.000 ms) eski uyarıları affet ve sıfırla
    if (userData.lastKufurTime && (now - userData.lastKufurTime > 86400000)) {
        userData.kufurUyari = 0;
    }

    const currentKufur = userData.kufurUyari ? userData.kufurUyari : 0;
    userData.kufurUyari = currentKufur + 1;
    userData.lastKufurTime = now;
    saveDB(db);

    if (userData.kufurUyari < 3) {
        message.channel.send(`<@${message.author.id}>, lütfen üslubunuza dikkat edin. Sunucuda küfür ve argo kullanımı yasaktır. (**${userData.kufurUyari}/3 Uyarı**)\n*(Uyarılarınız 24 saat temiz kalırsanız otomatik sıfırlanır)*`).then(m => setTimeout(() => m.delete().catch(() => { }), 6500));
        sendLog(message.guild, 'logCeza', {
            title: 'Küfür / Argo Uyarısı',
            desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Uyarı Sayısı:** ${userData.kufurUyari}/3\n**Silinen Mesaj:** ${message.content}`,
            color: 0xfee75c
        });
    } else {
        userData.kufurUyari = 0;
        userData.lastKufurTime = null;
        saveDB(db);
        await applyJail(message.member, message.guild, "Küfür / Hakaret (3. İhlal)");
    }
}

// ============================================================================
// GELİŞMİŞ REKLAM & LİNK KORUMASI (BEYAZ LİSTE, GİZLİ LİNK & DAVET İSTİSNASI)
// ============================================================================
const allowedLinkDomains = [
    'youtube.com', 'youtu.be', 'twitch.tv', 'kick.com', 'spotify.com',
    'discord.com', 'discordapp.com', 'tenor.com', 'giphy.com', 'github.com',
    'instagram.com', 'twitter.com', 'x.com', 'tiktok.com'
];

function isForbiddenLink(content, guildInvites = []) {
    if (!content) return false;
    let clean = content;

    // 1. Standart URL Tespiti
    const urlPattern = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi;
    const matches = content.match(urlPattern) || [];

    for (let u of matches) {
        let full = u.startsWith('http') ? u : 'https://' + u;
        try {
            const parsed = new URL(full);
            const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

            // Discord Davet Linki Kontrolü (Sunucunun kendi davet kodları serbest)
            if (host === 'discord.gg' || (host === 'discord.com' && parsed.pathname.startsWith('/invite/'))) {
                const code = parsed.pathname.split('/').filter(Boolean).pop();
                if (guildInvites.includes(code)) {
                    clean = clean.replace(u, '');
                    continue;
                }
                return true; // Başka sunucunun daveti (Reklam)
            }

            // Güvenilir / İzinli Alan Adı Kontrolü
            const isAllowed = allowedLinkDomains.some(d => host === d || host.endsWith('.' + d));
            if (!isAllowed) {
                return true; // Bilinmeyen / Yasaklı link
            } else {
                clean = clean.replace(u, '');
            }
        } catch (e) {
            return true;
        }
    }

    // 2. Gizli Davet ve Boşluklu Bypass Girişimleri (örn: discord . gg / kod)
    const hiddenInviteRegex = /(?:discord(?:[\s\.\(\[\{\-_\*]+gg|\.com\/invite)[\s\.\(\[\{\-_\*\/]*([a-zA-Z0-9\-]+))/i;
    const m = clean.match(hiddenInviteRegex);
    if (m) {
        const code = m[1];
        if (!guildInvites.includes(code)) return true;
        clean = clean.replace(m[0], '');
    }

    // 3. Şüpheli TLD Uzantılarıyla Gizlenmiş Linkler (site . com, reklam . xyz)
    const hiddenLinkRegex = /(?:^|\s)[a-z0-9\-]+(?:\s*[\.\(\[\{]\s*|\s+dot\s+)(?:com|net|org|xyz|gg|top|site|ru|info|link|cc|to)(?:\/|\s|$)/i;
    if (hiddenLinkRegex.test(clean)) return true;

    return false;
}

// Reklam ve Link Uyarısı / Kademeli Ceza (2. İhlalde Hapis)
async function handleLinkViolation(message, db, guildId) {
    await message.delete().catch(() => { });
    ensureGuildDB(db, guildId);
    if (!db[guildId].users[message.author.id]) {
        db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0, linkUyari: 0 };
    }

    let userData = db[guildId].users[message.author.id];
    const now = Date.now();

    // 24 saat sonra link uyarısını sıfırla
    if (userData.lastLinkTime && (now - userData.lastLinkTime > 86400000)) {
        userData.linkUyari = 0;
    }

    userData.linkUyari = (userData.linkUyari || 0) + 1;
    userData.lastLinkTime = now;
    saveDB(db);

    if (userData.linkUyari < 2) {
        message.channel.send(`<@${message.author.id}>, sunucuda harici reklam veya izinsiz link paylaşımı yasaktır. (**${userData.linkUyari}/2 Uyarı**)\n*(Tekrarında otomatik hapis cezası uygulanır)*`).then(m => setTimeout(() => m.delete().catch(() => { }), 6500));
        sendLog(message.guild, 'logCeza', {
            title: 'Reklam / Yasaklı Link Uyarısı',
            desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Uyarı:** ${userData.linkUyari}/2\n**Engellenen İçerik:** ${message.content}`,
            color: 0xfee75c
        });
    } else {
        userData.linkUyari = 0;
        userData.lastLinkTime = null;
        saveDB(db);
        await applyJail(message.member, message.guild, "İzinsiz Reklam / Yasaklı Link Paylaşımı");
    }
}
function buildDashboardButtons(activeTab = 'ayar') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nav_panel_ayar').setLabel('Sistem Ayarları').setStyle(activeTab === 'ayar' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nav_panel_log').setLabel('Log Ayarları').setStyle(activeTab === 'log' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nav_panel_ticket').setLabel('Ticket Kurulumu').setStyle(activeTab === 'ticket' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nav_panel_ekonomi').setLabel('Ekonomi & XP').setStyle(activeTab === 'ekonomi' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nav_panel_info').setLabel('Sistem Özeti').setStyle(activeTab === 'info' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
}

function buildHomeDashboard(guild) {
    const embed = new EmbedBuilder()
        .setTitle(`${guild.name} - Yönetim ve Rehber Paneli`)
        .setDescription(
            `Bu kontrol paneli üzerinden sunucunun tüm moderasyon, güvenlik, geçici ses odası, log ve destek (ticket) sistemlerini hiçbir komut ezberlemeden yapılandırabilirsiniz.\n\n` +
            `**1. Sistem Ayarları Butonu**\n` +
            `Yetkili, muaf, cezalı ve sicilli rollerini; geçici ses odası oluşturucu kanalını, yayın duyuru sistemini, küfür/link engellerini ve bot korumasını buradan yönetebilirsiniz.\n\n` +
            `**2. Log Ayarları Butonu**\n` +
            `Sunucuda gerçekleşen tüm olayları 6 ayrı kategoride (Ceza, Mesaj, Ses, Üye, Sunucu, Güvenlik) hangi kanallara raporlanacağını buradan belirleyebilirsiniz.\n\n` +
            `**3. Ticket Kurulumu Butonu**\n` +
            `İstediğiniz kanala özel destek veya başvuru kutusu kurmanızı sağlar. Üyeler butona bastığında karşılarına bir başvuru formu (Modal) çıkar; konu ve açıklamayı yazıp onayladıklarında özel kanal açılır.\n\n` +
            `**4. Komutlar ve Yetki Dağılımı**\n` +
            `- \`/panel\` : Bu yönetim ekranını açar (Sadece Sunucu Yöneticileri).\n` +
            `- \`/yaz\` : Bot üzerinden kanala duyuru/mesaj yazar (Sadece Sunucu Yöneticileri).\n` +
            `- \`/hapis\` : Kullanıcıyı belirtilen süreyle cezalıya atar (Yöneticiler ve Yetkili Rol).\n` +
            `- \`/af\` : Kullanıcının cezasını ve sicilini temizler (Yöneticiler ve Yetkili Rol).\n` +
            `- \`/sil\` : Kanaldaki mesajları toplu olarak temizler (Yöneticiler ve Yetkili Rol).`
        )
        .setColor(0x2b2d31)
        .setTimestamp();

    return { content: '', embeds: [embed], components: [buildDashboardButtons('home')] };
}

function buildAyarDashboard(guildDb) {
    const getRole = (id) => id ? `<@&${id}>` : 'Atanmamış';
    const getCh = (id) => id ? `<#${id}>` : 'Atanmamış';
    const trackerCount = Array.isArray(guildDb.trackers) ? guildDb.trackers.length : 0;
    const customKufurCount = Array.isArray(guildDb.customKufurler) ? guildDb.customKufurler.length : 0;
    const botWhitelistCount = Array.isArray(guildDb.botWhitelist) ? guildDb.botWhitelist.length : 0;

    const embed = new EmbedBuilder()
        .setTitle('Sistem Ayarları ve Yönetim Merkezi')
        .setDescription(
            `Aşağıdaki butonlardan koruma filtrelerini doğrudan **açıp kapatabilir**, açılır menüden ise rol, kanal ve yayıncı yapılandırmalarını hızlıca yapabilirsiniz.\n\n` +
            `**Rol Görevleri:**\n` +
            `- **Yetkili Rolü:** \`/hapis\`, \`/af\`, \`/sil\` komutlarını ve destek taleplerini yöneten roldür.\n` +
            `- **Muaf Rolü:** Küfür, link, spam ve caps lock denetiminden muaf tutulur.\n` +
            `- **Cezalı (Jail) Rolü:** Ceza alan üyelere otomatik verilen kısıtlama rolüdür.\n` +
            `- **Sicilli Rolü:** Sürekli kural ihlali yapanlara verilen kalıcı uyarı rolüdür.`
        )
        .setColor(0x2b2d31)
        .addFields(
            { name: '👥 Rol Yapılandırması', value: `Yetkili: ${getRole(guildDb.yetkiliRol)}\nMuaf: ${getRole(guildDb.muafRol)}\nCezalı (Jail): ${getRole(guildDb.jailRol)}\nSicilli: ${getRole(guildDb.sicilRol)}`, inline: true },
            { name: '🎙️ Ses ve Yayın', value: `Oda Oluşturucu: ${getCh(guildDb.odaKanal)}\nOda Kategorisi: ${getCh(guildDb.odaKategori)}\nDuyuru Kanalı: ${getCh(guildDb.duyuruKanal)}\nTakip Edilen: **${trackerCount} kanal**`, inline: true },
            { name: '🛡️ Güvenlik ve Koruma Durumu', value: `Link/Reklam: **${guildDb.linkEngel ? '🟢 AÇIK' : '🔴 KAPALI'}**\nKüfür Koruması: **${guildDb.kufurEngel ? '🟢 AÇIK' : '🔴 KAPALI'}** *(+${customKufurCount} özel kelime)*\nCaps Lock: **${guildDb.capsEngel !== false ? '🟢 AÇIK' : '🔴 KAPALI'}**\nİzinsiz Bot Engeli: **${guildDb.antiBot !== false ? '🟢 AÇIK' : '🔴 KAPALI'}** *(+${botWhitelistCount} beyaz listede)*\nOto-Cevap: **${guildDb.otoCevap !== false ? '🟢 AÇIK' : '🔴 KAPALI'}**`, inline: false }
        );

    // Hızlı Aç/Kapat Butonları (Tek Tıkla Kolay Yönetim)
    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_quick_toggle_link')
            .setLabel(guildDb.linkEngel ? 'Link: Açık' : 'Link: Kapalı')
            .setStyle(guildDb.linkEngel ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_quick_toggle_kufur')
            .setLabel(guildDb.kufurEngel ? 'Küfür: Açık' : 'Küfür: Kapalı')
            .setStyle(guildDb.kufurEngel ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_quick_toggle_caps')
            .setLabel(guildDb.capsEngel !== false ? 'Caps: Açık' : 'Caps: Kapalı')
            .setStyle(guildDb.capsEngel !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_quick_toggle_antibot')
            .setLabel(guildDb.antiBot !== false ? 'Anti-Bot: Açık' : 'Anti-Bot: Kapalı')
            .setStyle(guildDb.antiBot !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_quick_toggle_oto')
            .setLabel(guildDb.otoCevap !== false ? 'Oto-Cevap: Açık' : 'Oto-Cevap: Kapalı')
            .setStyle(guildDb.otoCevap !== false ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('panel_ayar_sec')
            .setPlaceholder('Yapılandırılacak ayarı listeden seçin...')
            .addOptions([
                { label: 'Yetkili (Moderatör) Rolü Seç', description: 'Hapis, af, sil ve bilet yönetim yetkisine sahip rol.', value: 'yetkiliRol' },
                { label: 'Muaf Rolü Seç', description: 'Küfür, link ve spam korumalarından muaf tutulan rol.', value: 'muafRol' },
                { label: 'Cezalı (Jail) Rolü Seç', description: 'Hapis cezası alan üyelere verilen kısıtlama rolü.', value: 'jailRol' },
                { label: 'Sicilli Rolü Seç', description: 'Sicili bozulan üyelere verilecek uyarı rolü.', value: 'sicilRol' },
                { label: 'Geçici Oda Oluşturucu Ses Kanalı Seç', description: 'Üyelerin tıkladığında özel oda açacağı ses kanalı.', value: 'odaKanal' },
                { label: 'Geçici Oda Kategorisi Seç', description: 'Açılan özel ses odalarının toplanacağı kategori.', value: 'odaKategori' },
                { label: 'Yayın & İçerik Duyuru Kanalı Seç', description: 'YouTube, Kick ve Twitch bildirimlerinin paylaşılacağı metin kanalı.', value: 'duyuruKanal' },
                { label: 'Duyuru Bildirim Rolü Seç', description: 'Duyurularda etiketlenecek rol (Atanmazsa @everyone).', value: 'duyuruRol' },
                { label: 'Yayıncı / Kanal Ekle (YT, Kick, Twitch)', description: 'Otomatik takip edilecek kanal linkini girin.', value: 'add_stream_tracker' },
                { label: 'Takip Edilen Kanalları Listele / Sil', description: 'Kayıtlı yayıncı kanallarını listeleyin veya kaldırın.', value: 'list_stream_trackers' },
                { label: 'Özel Yasaklı Kelime Ekle', description: 'Sunucunuza özel yasaklanacak kelime ekleyin.', value: 'add_custom_kufur' },
                { label: 'Özel Yasaklı Kelimeleri Listele / Sil', description: 'Eklediğiniz özel yasaklı kelimeleri görün veya silin.', value: 'list_custom_kufur' },
                { label: 'Bot Beyaz Listesi Ekle / Çıkar', description: 'Sunucuya bot ekleme izni olan bot ve üyeleri yönetin.', value: 'manage_bot_whitelist' },
                { label: 'Bot Durum Mesajı Ayarla (Oynuyor)', description: 'Bot profilinde görünecek "Oynuyor..." yazısını düzenleyin.', value: 'set_bot_status' }
            ])
    );

    return { content: '', embeds: [embed], components: [buildDashboardButtons('ayar'), toggleRow, menuRow] };
}

function buildLogDashboard(guildDb) {
    const getCh = (id) => id ? `<#${id}>` : 'Atanmamış';

    const embed = new EmbedBuilder()
        .setTitle('Log Kanalları ve Kapsamları')
        .setDescription(
            `Aşağıdaki menüden ayarlamak istediğiniz **Log Kategorisini** seçin. Her kategorinin neyi kaydettiği aşağıda açıklanmıştır:\n\n` +
            `- **Ceza Log:** Hapis, af, küfür/link uyarıları, Ban, Kick ve Zaman Aşımı (Timeout) işlemlerini tutar.\n` +
            `- **Mesaj Log:** Silinen mesajları (silinen fotoğrafları indirip kanıt olarak geri yükler), düzenlenen mesajları, Hayalet Etiketleri (Ghost Ping) ve kapatılan Ticketların \`.txt\` konuşma dökümlerini tutar.\n` +
            `- **Ses Log:** Ses kanallarına giriş-çıkışları, odada kalınan toplam süreyi (mesai), kamera/yayın açmayı ve yetkili susturmalarını tutar.\n` +
            `- **Üye Log:** Sunucuya katılanları (kimin davet ettiğiyle birlikte), ayrılanları, rol/isim/avatar değişimlerini ve Nitro takviyelerini (Boost) tutar.\n` +
            `- **Sunucu Log:** Açılan/silinen kanalları, rolleri, bir role Yönetici vb. tehlikeli bir yetki verildiğinde acil durum uyarılarını ve açılan geçici odaları tutar.\n` +
            `- **Güvenlik Log:** 15 günden yeni açılmış şüpheli hesap girişlerini, 24 saat dolmadan çıkan sahte (fake) davetleri, sunucuya eklenen botları ve webhook işlemlerini tutar.`
        )
        .setColor(0x2b2d31)
        .addFields(
            { name: 'Ceza Log', value: getCh(guildDb.logCeza), inline: true },
            { name: 'Mesaj Log', value: getCh(guildDb.logMesaj), inline: true },
            { name: 'Ses Log', value: getCh(guildDb.logSes), inline: true },
            { name: 'Üye Log', value: getCh(guildDb.logUye), inline: true },
            { name: 'Sunucu Log', value: getCh(guildDb.logSunucu), inline: true },
            { name: 'Güvenlik Log', value: getCh(guildDb.logGuvenlik), inline: true }
        );

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('panel_log_sec')
            .setPlaceholder('Kanalını belirlemek istediğiniz log kategorisini seçin...')
            .addOptions([
                { label: 'Ceza Log Kanalı Seç', description: 'Hapis, Af, Uyarı, Ban, Kick ve Timeout kayıtları.', value: 'logCeza' },
                { label: 'Mesaj Log Kanalı Seç', description: 'Silinen mesaj/görsel, düzenlenen mesaj, Ghost Ping ve Ticket arşivi.', value: 'logMesaj' },
                { label: 'Ses Log Kanalı Seç', description: 'Ses giriş-çıkış, odada kalma süresi, yayın ve kamera kayıtları.', value: 'logSes' },
                { label: 'Üye Log Kanalı Seç', description: 'Giriş-çıkış, davet takibi, rol, isim, avatar ve Boost kayıtları.', value: 'logUye' },
                { label: 'Sunucu Log Kanalı Seç', description: 'Kanal, rol (Kritik yetki uyarılı), emoji ve geçici oda kayıtları.', value: 'logSunucu' },
                { label: 'Güvenlik Log Kanalı Seç', description: '15 günden yeni hesap alarmı, Fake davet, Webhook ve Bot ekleme.', value: 'logGuvenlik' }
            ])
    );

    return { content: '', embeds: [embed], components: [buildDashboardButtons('log'), menuRow] };
}

function buildTicketDashboard(guildDb) {
    const selectedCat = guildDb.tempTicketCat ? `<#${guildDb.tempTicketCat}>` : 'Henüz Seçilmedi (Lütfen 1. Adımdan seçin)';

    const embed = new EmbedBuilder()
        .setTitle('Destek / Başvuru (Ticket) Paneli Kurulum Rehberi')
        .setDescription(
            `Sunucunuzda istediğiniz kadar farklı kanala (Örn: \`#destek\`, \`#yetkili-basvuru\`, \`#sikayet\`) birbirinden bağımsız Ticket panelleri kurabilirsiniz.\n\n` +
            `**Kullanıcı Deneyimi Nasıl Çalışır?**\n` +
            `Üye kurduğunuz butona tıkladığında karşısına bir **Başvuru / Talep Formu (Modal)** çıkar. Bu formda **"Talep Konusu (Başvuru / Destek / Diğer)"** ve **"Detaylı Açıklama"** kısımlarını doldurup onayladığında kendisine özel kanal açılır ve yazdığı bilgiler yetkililerin önüne ilk mesaj olarak düşer.\n\n` +
            `**Kurulum Adımları:**\n` +
            `**1. Adım:** Aşağıdaki ilk menüden, açılacak özel destek kanallarının hangi **Kategorinin (Klasörün)** altında toplanacağını seçin.\n` +
            `**2. Adım:** İkinci menüden, Ticket kutusunun gönderileceği **Metin veya Duyuru Kanalını** seçin.\n` +
            `**3. Adım (Form Penceresi):** Kanalı seçtiğiniz anda açılacak pencerede kutunun başlığını, açıklamasını, buton yazısını ve bilet içi karşılama mesajını onaylayın.\n\n` +
            `**Şu An Seçili Kategori:** ${selectedCat}`
        )
        .setColor(0x2b2d31);

    const catRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('select_ticket_kur_cat')
            .setPlaceholder('1. Adım (Zorunlu): Taleplerin açılacağı kategoriyi seçin...')
            .setChannelTypes([ChannelType.GuildCategory])
            .setMaxValues(1)
    );

    const components = [buildDashboardButtons('ticket'), catRow];

    if (guildDb.tempTicketCat) {
        const chRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`select_ticket_kur_ch_${guildDb.tempTicketCat}`)
                .setPlaceholder('2. Adım: Panelin gönderileceği kanalı seçin (Form açılır)...')
                .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
                .setMaxValues(1)
        );
        components.push(chRow);
    }

    return { content: '', embeds: [embed], components: components };
}

function buildInfoDashboard(guild, guildDb) {
    const getRole = (id) => id ? `<@&${id}>` : 'Atanmamış';
    const getCh = (id) => id ? `<#${id}>` : 'Atanmamış';
    const trackerCount = Array.isArray(guildDb.trackers) ? guildDb.trackers.length : 0;

    const activeTickets = guildDb.tickets ? Object.keys(guildDb.tickets).length : 0;
    const activeRooms = guildDb.tempRooms ? Object.keys(guildDb.tempRooms).length : 0;

    const embed = new EmbedBuilder()
        .setTitle(`${guild.name} - Sistem Durum Özeti`)
        .setColor(0x2b2d31)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: 'Sunucu İstatistikleri', value: `Üye Sayısı: **${guild.memberCount}** | Açık Ticket: **${activeTickets}** | Açık Geçici Oda: **${activeRooms}**`, inline: false },
            { name: 'Rol Ayarları', value: `Yetkili: ${getRole(guildDb.yetkiliRol)}\nMuaf: ${getRole(guildDb.muafRol)}\nCezalı (Jail): ${getRole(guildDb.jailRol)}\nSicilli: ${getRole(guildDb.sicilRol)}`, inline: true },
            { name: 'Kanal ve Yayın Ayarları', value: `Oda Oluşturucu: ${getCh(guildDb.odaKanal)}\nOda Kategorisi: ${getCh(guildDb.odaKategori)}\nDuyuru Kanalı: ${getCh(guildDb.duyuruKanal)}\nTakip Edilen: **${trackerCount} kanal**`, inline: true },
            { name: 'Log Kanalları', value: `**Ceza:** ${getCh(guildDb.logCeza)}\n**Mesaj:** ${getCh(guildDb.logMesaj)}\n**Ses:** ${getCh(guildDb.logSes)}\n**Üye:** ${getCh(guildDb.logUye)}\n**Sunucu:** ${getCh(guildDb.logSunucu)}\n**Güvenlik:** ${getCh(guildDb.logGuvenlik)}`, inline: false },
            { name: 'Koruma Filtreleri', value: `Link Engeli: **${guildDb.linkEngel ? 'Aktif' : 'Kapalı'}** | Küfür Engeli: **${guildDb.kufurEngel ? 'Aktif' : 'Kapalı'}** | Oto-Cevap: **${guildDb.otoCevap !== false ? 'Aktif' : 'Kapalı'}**`, inline: false }
        )
        .setTimestamp();

    return { content: '', embeds: [embed], components: [buildDashboardButtons('info')] };
}

function buildEkonomiDashboard(guildDb) {
    const getRole = (id) => id ? `<@&${id}>` : 'Atanmamış';
    const levelRoles = guildDb.levelRoles || {};
    const marketRoles = guildDb.marketRoles || [];

    const levelFields = XP_LEVELS.map(lvl => {
        const rId = levelRoles[String(lvl.level)];
        return `• **${lvl.title}:** ${getRole(rId)}`;
    }).join('\n');

    let marketText = 'Henüz markete satılık bir rol eklenmedi.';
    if (marketRoles.length > 0) {
        marketText = marketRoles.map((item, idx) => `**${idx + 1}.** <@&${item.roleId}> — **${item.price.toLocaleString('tr-TR')} Papel** (${formatDurationLabel(item.durationDays)})`).join('\n');
    }

    const embed = new EmbedBuilder()
        .setTitle('💵 Ekonomi, XP ve Seviye Yönetim Merkezi')
        .setDescription(
            `Sunucunun 7 kademeli XP seviye ödül rollerini, market ürünlerini ve ekonomi kurallarını buradan yönetebilirsiniz.\n\n` +
            `**Kazanım Oranları (Dengeli Zorlu Ekonomi):**\n` +
            `• **Mesaj:** Her mesaj 5-12 XP (45 sn cooldown) | **Her 100 mesajda 1 Papel** *(%2 şansla ekstra damla)*\n` +
            `• **Ses Odası:** Her 1.5 dakika 10-20 XP (30 sn soğuma süresi, Yayın/Kamera 1.5x) | **Her 10 dakikada 1 Papel**\n` +
            `• **Süreli Roller:** Markete süreli roller (örn: 2 hafta özel oda izni) eklenebilir. Süre bitince bot rolü otomatik kaldırır.\n` +
            `• **Günlük Maaş:** \`/gunluk\` 24 saatte bir **1 Papel** ile sınırlıdır.\n` +
            `• **Aktarım:** Sadece yöneticiler (\`/papel-ver\`, \`/papel-al\`) işlem yapabilir.`
        )
        .setColor(0x2b2d31)
        .addFields(
            { name: '🎖️ 7 Kademeli Seviye Rol Ödülleri', value: levelFields, inline: false },
            { name: '🛒 Satışta Olan Market Rolleri', value: marketText, inline: false },
            { name: '⚙️ Sistem Durumu', value: `XP ve Seviye Kazanımı: **${guildDb.xpEnabled !== false ? '🟢 AÇIK' : '🔴 KAPALI'}**\nKumar Oyunları (/slot, /yazitura): **${guildDb.gamesEnabled !== false ? '🟢 AÇIK' : '🔴 KAPALI'}**`, inline: false }
        )
        .setTimestamp();

    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_xp_system').setLabel(`XP Sistemi: ${guildDb.xpEnabled !== false ? 'AÇIK' : 'KAPALI'}`).setStyle(guildDb.xpEnabled !== false ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('toggle_games_system').setLabel(`Kumar Oyunları: ${guildDb.gamesEnabled !== false ? 'AÇIK' : 'KAPALI'}`).setStyle(guildDb.gamesEnabled !== false ? ButtonStyle.Success : ButtonStyle.Danger)
    );

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('panel_ekonomi_sec')
            .setPlaceholder('Ekonomi veya seviye ayarı seçin...')
            .addOptions([
                { label: 'Seviye Rol Ödülü Belirle (1-7)', description: 'Belirli bir seviyeye ulaşanlara otomatik verilecek rolü seçin.', value: 'set_level_role' },
                { label: 'Seviye Rol Ödülü Kaldır', description: 'Atanmış bir seviye ödül rolünü sıfırlayın.', value: 'clear_level_role' },
                { label: 'Markete Satılık Rol Ekle (Süreli / Kalıcı)', description: 'Kullanıcıların Papel ile satın alabileceği rol, süre ve fiyat belirleyin.', value: 'add_market_role' },
                { label: 'Marketten Rol Kaldır', description: 'Satışta olan bir rolü marketten kaldırın.', value: 'remove_market_role' }
            ])
    );

    return { content: '', embeds: [embed], components: [buildDashboardButtons('ekonomi'), toggleRow, menuRow] };
}

function buildMarketView(guild, guildDb, user) {
    const uData = (guildDb.users && guildDb.users[user.id]) || {};
    const userPapel = uData.papel || 0;
    const marketRoles = guildDb.marketRoles || [];

    const selectOptions = [];
    let marketListing = '';

    if (marketRoles.length === 0) {
        marketListing = '> ⚠️ *Şu anda markette satışta olan aktif bir rol bulunmuyor.*';
    } else {
        marketListing = marketRoles.map((item, idx) => {
            const role = guild.roles.cache.get(item.roleId);
            const rName = role ? role.name : 'Silinmiş Rol';
            const durTag = formatDurationLabel(item.durationDays);
            const isTemp = item.durationDays && item.durationDays > 0;
            const durDisplay = isTemp ? `⏳ **${durTag}** *(Süre bitince otomatik kaldırılır)*` : '♾️ **Kalıcı (Ömür Boyu)**';

            selectOptions.push({
                label: `${isTemp ? `${durTag} ` : ''}${rName}`.slice(0, 100),
                description: `${item.price.toLocaleString('tr-TR')} Papel — ${durTag}`,
                value: item.roleId,
                emoji: isTemp ? '⏳' : '👑'
            });

            return (
                `> 🛒 **#${idx + 1} — <@&${item.roleId}>**\n` +
                `> ├ 💰 **Fiyat:** \`${item.price.toLocaleString('tr-TR')} Papel\` 💵\n` +
                `> └ ⏱️ **Kullanım:** ${durDisplay}`
            );
        }).join('\n\n');
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: `${guild.name} • Resmi Papel Marketi`, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTitle('🏪 Sunucu Mağazası & Rol Satın Alım Noktası')
        .setColor(0x5865F2)
        .setDescription(
            `💳 **Mevcut Bakiyeniz:** \`${userPapel.toLocaleString('tr-TR')} Papel\` 💵\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `### 🛍️ Satışta Olan Roller & Ayrıcalıklar\n\n` +
            `${marketListing}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 **Nasıl Satın Alınır?**\n` +
            `• Aşağıdaki menüden almak istediğiniz rolü seçin, bakiyeniz yeterliyse rol anında profilinize tanımlanır.\n` +
            `• Süreli rollerin süresi bittiğinde bot rolü profilinizden güvenle geri alır.`
        )
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || undefined)
        .setFooter({ text: 'Not: Bu market ekranı ve işlemler sadece size özeldir • Memur Hüsnü' })
        .setTimestamp();

    const components = [];
    if (selectOptions.length > 0) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('user_buy_market_role')
                .setPlaceholder('🛒 Satın almak istediğiniz rolü seçin...')
                .addOptions(selectOptions.slice(0, 25))
        ));
    }

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_market_my_profile').setLabel('Profilim').setStyle(ButtonStyle.Success).setEmoji('👤'),
        new ButtonBuilder().setCustomId('btn_open_market_view').setLabel('Yenile').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
        new ButtonBuilder().setCustomId('btn_profile_how_it_works').setLabel('Nasıl Papel Kazanılır?').setStyle(ButtonStyle.Primary).setEmoji('❓')
    ));

    return { embeds: [embed], components, ephemeral: true };
}

function buildUserProfileCard(targetUser, guild, guildDb) {
    const uData = (guildDb.users && guildDb.users[targetUser.id]) || {};
    const xp = uData.xp || 0;
    const papel = uData.papel || 0;
    const spentPapel = uData.spentPapel || 0;
    const isOptedOut = Boolean(uData.xpDisabled);
    const level = calculateLevel(xp);
    const nextLvl = getNextLevelInfo(xp);
    const currentTitle = XP_LEVELS.find(l => l.level === level)?.title || 'Gezgin';
    const currentRoleId = guildDb.levelRoles?.[String(level)];

    // Sunucu sıralaması hesabı (sistemden çıkanlar sıralamaya dahil edilmez)
    const allUsers = Object.entries(guildDb.users || {})
        .filter(([_, u]) => (u.xp || 0) > 0 && !u.xpDisabled)
        .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0));
    const rankIndex = allUsers.findIndex(([uid]) => uid === targetUser.id);
    const rankPos = isOptedOut ? 'Devre Dışı' : (rankIndex !== -1 ? rankIndex + 1 : (allUsers.length > 0 ? allUsers.length + 1 : 1));

    // Sıralama rozeti (Top 3 için taç/madalya)
    let rankBadge = '🎖️';
    if (rankPos === 1) rankBadge = '👑 #1 (Sunucu Lideri)';
    else if (rankPos === 2) rankBadge = '🥈 #2 (İkinci)';
    else if (rankPos === 3) rankBadge = '🥉 #3 (Üçüncü)';
    else if (typeof rankPos === 'number') rankBadge = `#${rankPos.toLocaleString('tr-TR')}`;
    else rankBadge = '⛔ Devre Dışı';

    // İlerleme ve hedef
    let targetText = '';
    let barDisplay = '';

    if (isOptedOut) {
        targetText = '⏸️ *Seviye sistemi devre dışı bırakıldı. Katılmak için aşağıdaki butonu kullanabilirsiniz.*';
        barDisplay = '`░░░░░░░░░░░░` *(Sistem Donduruldu)*';
    } else if (nextLvl) {
        const prevXp = level > 0 ? XP_LEVELS.find(l => l.level === level)?.xp || 0 : 0;
        const curInLvl = xp - prevXp;
        const reqInLvl = nextLvl.xp - prevXp;
        const remXp = (nextLvl.xp - xp).toLocaleString('tr-TR');
        const targetRoleId = guildDb.levelRoles?.[String(nextLvl.level)];
        const roleMention = targetRoleId ? `<@&${targetRoleId}>` : `**${nextLvl.title}**`;
        const percentage = Math.min(100, Math.floor((curInLvl / reqInLvl) * 100));

        barDisplay = `${makeProgressBar(curInLvl, reqInLvl, 12)} **%${percentage}**\n> 📈 **XP:** \`${xp.toLocaleString('tr-TR')}\` / \`${nextLvl.xp.toLocaleString('tr-TR')}\``;
        targetText = `🎯 **Hedef:** ${roleMention} rolüne ulaşmak için **${remXp} XP** kaldı!`;
    } else {
        barDisplay = '`████████████` **%100 (Maksimum Seviye)**';
        targetText = '🏆 **Tebrikler! Sunucudaki en yüksek seviyeye ve unvana ulaştınız.**';
    }

    // Aktif süreli roller
    const now = Date.now();
    const userTempRoles = (guildDb.tempUserRoles || []).filter(tr => tr.userId === targetUser.id && tr.expiresAt > now);
    let tempRolesText = '';
    if (userTempRoles.length > 0) {
        tempRolesText = userTempRoles.map(tr => `> • <@&${tr.roleId}> ➔ **Kalan:** \`${formatDurationRemaining(tr.expiresAt - now)}\``).join('\n');
    }

    // Seviyeye göre dinamik parıldayan renkler
    const levelColors = [0x95a5a6, 0x3498db, 0x2ecc71, 0x9b59b6, 0xe67e22, 0xe74c3c, 0xf1c40f, 0x00ffff];
    const embedColor = isOptedOut ? 0xed4245 : (levelColors[level] || 0x5865f2);

    let statusWarning = '';
    if (isOptedOut) {
        statusWarning = `\n> ⛔ **BİLGİ:** Seviye sistemi devre dışı. Seviye rolleriniz geri alındı ve XP kazanımı donduruldu. Aşağıdaki butondan dilediğiniz zaman tekrar katılarak hak ettiğiniz tüm rolleri anında geri alabilirsiniz.\n`;
    }

    const roleDisplay = currentRoleId ? `<@&${currentRoleId}>` : `\`${currentTitle}\``;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `${targetUser.username} — Resmi Üye Profili`,
            iconURL: targetUser.displayAvatarURL({ dynamic: true })
        })
        .setColor(embedColor)
        .setDescription(
            `### 🌟 ${targetUser.displayName} Profili\n` +
            `*MARTIANS #Yükseliş topluluğundaki seviye ilerlemen, papel cüzdanın ve başarımların.*\n` +
            statusWarning + '\n' +
            `**🎖️ RÜTBE & UNVAN BİLGİLERİ**\n` +
            `> 🔰 **Mevcut Seviye:** \`Seviye ${level}\` — **${currentTitle}**\n` +
            `> 🏷️ **Kazanılan Rol:** ${roleDisplay}\n` +
            `> 🏆 **Sunucu Sıralaması:** \`${rankBadge}\`\n\n` +
            `**📊 SEVİYE & TECRÜBE İLERLEMESİ**\n` +
            `> ${barDisplay}\n` +
            `> ${targetText}\n\n` +
            `**💰 PAPEL CÜZDANI & EKONOMİ**\n` +
            `> 💵 **Mevcut Bakiye:** **${papel.toLocaleString('tr-TR')} Papel**\n` +
            `> 💸 **Toplam Harcanan:** \`${spentPapel.toLocaleString('tr-TR')} Papel\`\n` +
            (tempRolesText ? `\n**⏳ AKTİF SÜRELİ ROLLERİNİZ**\n${tempRolesText}\n` : '')
        )
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({
            text: `MARTIANS Ekonomi & Seviye Sistemi • ${targetUser.id}`,
            iconURL: guild.iconURL({ dynamic: true }) || undefined
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`btn_profile_refresh_${targetUser.id}`).setLabel('Yenile').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
        new ButtonBuilder().setCustomId('btn_open_market_view').setLabel('Markete Git').setStyle(ButtonStyle.Success).setEmoji('🛒'),
        new ButtonBuilder().setCustomId('btn_profile_how_it_works').setLabel('Nasıl Çalışır?').setStyle(ButtonStyle.Secondary).setEmoji('❓'),
        isOptedOut
            ? new ButtonBuilder().setCustomId('btn_toggle_user_xp').setLabel('Sisteme Katıl').setStyle(ButtonStyle.Success).setEmoji('🟢')
            : new ButtonBuilder().setCustomId('btn_toggle_user_xp').setLabel('Devre Dışı Bırak').setStyle(ButtonStyle.Danger).setEmoji('🔴')
    );

    return { embeds: [embed], components: [row], ephemeral: true };
}

// ============================================================================
// GEÇİCİ ODA PANEL OLUŞTURUCU (TEMP VOICE UI - EMOJİSİZ TEMİZ YAPI)
// ============================================================================
function buildTempVoiceComponents(roomData, showClaim = false) {
    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('vc_privacy_menu')
            .setPlaceholder('Oda Gizlilik ve Sohbet Ayarları')
            .addOptions([
                { label: 'Odayı Kilitle (Lock)', description: 'Sadece izinli (Trust) üyeler odaya bağlanabilir.', value: 'lock' },
                { label: 'Kilidi Aç (Unlock)', description: 'Herkes odaya bağlanabilir.', value: 'unlock' },
                { label: 'Görünmez Yap (Invisible)', description: 'Odayı sadece izinli (Trust) üyeler görebilir.', value: 'invisible' },
                { label: 'Görünür Yap (Visible)', description: 'Odayı sunucudaki herkes görebilir.', value: 'visible' },
                { label: 'Sohbeti Kapat (Close Chat)', description: 'Oda sohbetine sadece izinli üyeler yazabilir.', value: 'close_chat' },
                { label: 'Sohbeti Aç (Open Chat)', description: 'Oda sohbetine herkes yazabilir.', value: 'open_chat' }
            ])
    );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vc_rename').setLabel('İsim Değiştir').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_limit').setLabel('Kişi Sınırı').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_trust').setLabel('İzin Ver (Trust)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('vc_untrust').setLabel('İzni Kaldır').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_kick').setLabel('Odadan At').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vc_block').setLabel('Engelle (Block)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('vc_unblock').setLabel('Engeli Kaldır').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_claim').setLabel('Sahipliği Al').setStyle(showClaim ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_transfer').setLabel('Sahipliği Devret').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('vc_delete').setLabel('Odayı Sil').setStyle(ButtonStyle.Danger)
    );

    return [selectRow, row1, row2];
}

function buildTempVoiceEmbed(roomData) {
    return new EmbedBuilder()
        .setTitle('Ses Odası Kontrol Paneli')
        .setDescription(
            `**Oda Sahibi:** <@${roomData.ownerId}>\n` +
            `**Giriş Durumu:** ${roomData.locked ? 'Kilitli' : 'Açık'} | **Görünürlük:** ${roomData.hidden ? 'Gizli' : 'Görünür'} | **Sohbet:** ${roomData.chatClosed ? 'Kapalı' : 'Açık'}\n\n` +
            `Odanın gizlilik ayarlarını aşağıdaki menüden, üye ve yetki işlemlerini ise butonlardan yönetebilirsiniz.`
        )
        .setColor(0x2b2d31)
        .setTimestamp();
}

// Otomatik Tahliye ve Hayalet Geçici Oda Süpürücü Döngüsü (Her 30 saniyede bir çalışır)
setInterval(() => {
    const db = getDB();
    const now = Date.now();
    let updated = false;

    client.guilds.cache.forEach(async guild => {
        if (!db[guild.id]) return;

        // 1. Ceza Süresi Dolanları Çıkarma
        if (db[guild.id].users) {
            const jailRoleId = db[guild.id].jailRol;
            for (const userId in db[guild.id].users) {
                let user = db[guild.id].users[userId];
                if (user.jailExpire && now >= user.jailExpire) {
                    user.jailExpire = null;
                    updated = true;
                    if (jailRoleId) {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (member && member.manageable) {
                            member.roles.remove(jailRoleId).catch(() => { });
                            sendLog(guild, 'logCeza', {
                                title: 'Ceza Süresi Doldu',
                                desc: `**Kullanıcı:** <@${member.id}>\nKullanıcının uzaklaştırma (hapis) süresi doldu ve erişimi geri açıldı.`,
                                color: 0x57f287
                            });
                        }
                    }
                }
            }
        }

        // 2. Boşta Kalan Geçici Ses Odalarını Süpürme (Hayalet Oda Temizliği)
        if (db[guild.id].odaKategori) {
            const kategoriId = db[guild.id].odaKategori;
            const olusturucuId = db[guild.id].odaKanal;

            guild.channels.cache.forEach(async ch => {
                if (ch.type === ChannelType.GuildVoice && ch.parentId === kategoriId && ch.id !== olusturucuId) {
                    // Oda yeni oluşturulduysa (10 saniyeden yeniyse) üyenin taşınmasını bekle
                    if (now - ch.createdTimestamp < 10000) return;

                    const humanCount = ch.members.filter(m => !m.user?.bot).size;
                    if (humanCount === 0) {
                        if (db[guild.id].tempRooms && db[guild.id].tempRooms[ch.id]) {
                            delete db[guild.id].tempRooms[ch.id];
                            updated = true;
                        }
                        renameCooldownMap.delete(ch.id);
                        await ch.delete().catch(() => { });
                        addLiveLog(`[OTOMATİK SÜPÜRME] Boş geçici oda silindi: ${ch.name} (${guild.name})`);
                    }
                }
            });
        }
    });
    if (updated) saveDB(db);
}, 30000);

// ============================================================================
// BOT HAZIR OLDUĞUNDA, HAYALET ODA TEMİZLİĞİ VE SLASH KOMUT KURULUMU
// ============================================================================
client.once('ready', async () => {
    addLiveLog(`🎉 Sistem aktif: ${client.user.tag} giriş yaptı! (${client.guilds.cache.size} sunucu)`);

    // Yedek kanalı açıldıysa derhal temizle ve sil
    for (const g of client.guilds.cache.values()) {
        const c = g.channels.cache.find(ch => ch.name === 'memur-db-yedek');
        if (c) await c.delete().catch(() => { });
    }

    const db = getDB();
    if (db.botStatus) {
        client.user.setPresence({
            activities: [{ name: db.botStatus, type: ActivityType.Playing }],
            status: 'online'
        });
    }
    let dbUpdated = false;

    for (const guild of client.guilds.cache.values()) {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(firstInvites.map(inv => [inv.code, inv.uses])));
        } catch (e) { }

        guild.voiceStates.cache.forEach(vs => {
            if (vs.channelId && vs.member && !vs.member.user.bot) {
                voiceTimerMap.set(`${guild.id}-${vs.id}`, Date.now());
            }
        });

        // Hayalet Geçici Oda Temizliği (Bot kapalıyken boşalmış odaları temizler)
        ensureGuildDB(db, guild.id);

        // Mevcut botları ve sunucu sahibini otomatik olarak beyaz listeye ekle
        if (!Array.isArray(db[guild.id].botWhitelist)) db[guild.id].botWhitelist = [];
        guild.members.cache.filter(m => m.user?.bot).forEach(b => {
            if (!db[guild.id].botWhitelist.includes(b.id)) {
                db[guild.id].botWhitelist.push(b.id);
                dbUpdated = true;
            }
        });
        if (guild.ownerId && !db[guild.id].botWhitelist.includes(guild.ownerId)) {
            db[guild.id].botWhitelist.push(guild.ownerId);
            dbUpdated = true;
        }

        const kategoriId = db[guild.id].odaKategori;
        const olusturucuId = db[guild.id].odaKanal;

        // Kategori altındaki tüm ses kanallarını tara
        if (kategoriId) {
            guild.channels.cache.forEach(async ch => {
                if (ch.type === ChannelType.GuildVoice && ch.parentId === kategoriId && ch.id !== olusturucuId) {
                    const humanCount = ch.members.filter(m => !m.user?.bot).size;
                    if (humanCount === 0) {
                        if (db[guild.id].tempRooms && db[guild.id].tempRooms[ch.id]) {
                            delete db[guild.id].tempRooms[ch.id];
                            dbUpdated = true;
                        }
                        renameCooldownMap.delete(ch.id);
                        await ch.delete().catch(() => { });
                    }
                }
            });
        }

        for (const [chId, rData] of Object.entries(db[guild.id].tempRooms || {})) {
            const ch = guild.channels.cache.get(chId);
            if (!ch) {
                delete db[guild.id].tempRooms[chId];
                dbUpdated = true;
            } else {
                const humanCount = ch.members.filter(m => !m.user?.bot).size;
                if (humanCount === 0) {
                    delete db[guild.id].tempRooms[chId];
                    dbUpdated = true;
                    await ch.delete().catch(() => { });
                } else if (!ch.members.has(rData.ownerId) && rData.panelMsgId) {
                    const panelMsg = await ch.messages.fetch(rData.panelMsgId).catch(() => null);
                    if (panelMsg) {
                        await panelMsg.edit({
                            content: `Oda sahibi (<@${rData.ownerId}>) odadan ayrıldı. Odadaki üyelerden biri **Sahipliği Al** butonuna basarak odayı devralabilir.`,
                            embeds: [buildTempVoiceEmbed(rData)],
                            components: buildTempVoiceComponents(rData, true)
                        }).catch(() => { });
                    }
                }
            }
        }
    }

    if (dbUpdated) saveDB(db);

    // Bot açıldıktan 5 saniye sonra yayın kontrollerini anında başlat
    setTimeout(() => {
        checkAllStreamTrackers().catch(e => addLiveLog(`[YAYIN KONTROL HATA]: ${e.message}`));
    }, 5000);

    const commands = [
        {
            name: 'panel',
            description: 'Sunucu sistem ayarları, log kanalları ve ticket kurulum kontrol panelini açar (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString()
        },
        {
            name: 'yaz',
            description: 'Bot üzerinden bulunduğunuz kanala mesaj veya duyuru gönderir (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            options: [
                { name: 'mesaj', type: 3, description: 'Botun kanala yazacağı metin', required: true }
            ]
        },
        {
            name: 'hapis',
            description: 'Kullanıcıyı belirtilen süre ve sebeple cezalıya (hapis) atar.',
            options: [
                { name: 'kullanici', type: 6, description: 'Cezalandırılacak kullanıcıyı seçin', required: true },
                { name: 'sure', type: 4, description: 'Ceza süresi miktarını girin (Sayı)', required: true },
                {
                    name: 'birim', type: 3, description: 'Ceza süresinin zaman birimini seçin', required: true, choices: [
                        { name: 'Saniye', value: 'saniye' },
                        { name: 'Dakika', value: 'dakika' },
                        { name: 'Saat', value: 'saat' },
                        { name: 'Gün', value: 'gun' }
                    ]
                },
                { name: 'sebep', type: 3, description: 'Cezalandırma sebebini yazın (Logda görünür)', required: true }
            ]
        },
        {
            name: 'af',
            description: 'Seçilen kullanıcının veya tüm sunucunun ceza ve sicil kaydını temizler.',
            options: [
                { name: 'kullanici', type: 6, description: 'Affedilecek kullanıcı (Boş bırakılırsa sadece Yöneticiler için genel af uygular)', required: false }
            ]
        },
        {
            name: 'sil',
            description: 'Bulunduğunuz kanaldaki mesajları belirtilen miktarda toplu olarak siler.',
            options: [
                { name: 'miktar', type: 4, description: 'Silinecek mesaj sayısı (1 ile 100 arasında bir sayı girin)', required: true }
            ]
        },
        {
            name: 'durum',
            description: 'Botun profilde görünen "Oynuyor" durum mesajını düzenler (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            options: [
                { name: 'mesaj', type: 3, description: 'Botun oynuyor durumunda görünecek metin (Sıfırlamak için boş bırakın)', required: false }
            ]
        },
        {
            name: 'rank',
            description: 'Seviyenizi, XP durumunuzu ve Papel bakiyenizi gösterir (Kişiye Özel).',
            options: [
                { name: 'kullanici', type: 6, description: 'Profili incelenecek kullanıcı (Varsayılan: Siz)', required: false }
            ]
        },
        {
            name: 'profil',
            description: 'Kullanıcı profil kartınızı, seviyenizi ve papel bakiyenizi görüntüler (Kişiye Özel).',
            options: [
                { name: 'kullanici', type: 6, description: 'Profili incelenecek kullanıcı (Varsayılan: Siz)', required: false }
            ]
        },
        {
            name: 'market',
            description: 'Sunucu Papel marketini ve satın alınabilir ayrıcalıkları listeler (Kişiye Özel).'
        },
        {
            name: 'gunluk',
            description: '24 saatlik günlük 1 Papel ödülünüzü toplar (Kişiye Özel).'
        },
        {
            name: 'yazitura',
            description: 'Papel ile yazı-tura oynayın (Kişiye Özel).',
            options: [
                { name: 'miktar', type: 4, description: 'Bahse gireceğiniz Papel miktarı', required: true },
                {
                    name: 'secim', type: 3, description: 'Tahmininiz', required: true, choices: [
                        { name: 'Yazı', value: 'yazi' },
                        { name: 'Tura', value: 'tura' }
                    ]
                }
            ]
        },
        {
            name: 'slot',
            description: 'Papel ile slot makinesini çevirin (Kişiye Özel).',
            options: [
                { name: 'miktar', type: 4, description: 'Bahse gireceğiniz Papel miktarı', required: true }
            ]
        },
        {
            name: 'papel-ver',
            description: 'Belirtilen kullanıcıya Papel hediye eder (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            options: [
                { name: 'kullanici', type: 6, description: 'Papel verilecek üye', required: true },
                { name: 'miktar', type: 4, description: 'Verilecek Papel miktarı', required: true }
            ]
        },
        {
            name: 'papel-al',
            description: 'Belirtilen kullanıcıdan Papel keser (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            options: [
                { name: 'kullanici', type: 6, description: 'Papel kesilecek üye', required: true },
                { name: 'miktar', type: 4, description: 'Kesilecek Papel miktarı', required: true }
            ]
        },
        {
            name: 'radyo',
            description: 'Ses odasında 7/24 kesintisiz canlı Türkçe radyo istasyonlarını dinleyin.',
            options: [
                {
                    name: 'islem',
                    type: 3,
                    description: 'İşlem seçin (Boş bırakırsanız radyo menüsü açılır)',
                    required: false,
                    choices: [
                        { name: 'Radyo Menüsünü Aç', value: 'menu' },
                        { name: 'Radyoyu Kapat / Ayrıl', value: 'kapat' }
                    ]
                }
            ]
        }
    ];

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands).catch(() => { });
    }
});

// ============================================================================
// INTERACTION (KOMUT, PANEL, MENÜ, BUTON VE MODAL) YÖNETİMİ
// ============================================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.guild) return;

    const actionName = interaction.isChatInputCommand() ? `/${interaction.commandName}` : (interaction.customId || 'Etkileşim');
    const userTag = interaction.user ? interaction.user.tag : 'Bilinmeyen Kullanıcı';
    addLiveLog(`[ETKİLEŞİM] ${actionName} (${interaction.guild.name} - ${userTag})`);

    try {
        const db = getDB();
        const guildId = interaction.guildId;
        ensureGuildDB(db, guildId);

        // Güvenli Yetkili Rolü ve Yönetici Kontrolü
        const isAdmin = Boolean(interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator));
        const isYetkili = Boolean(
            isAdmin ||
            (db[guildId].yetkiliRol && interaction.member && interaction.member.roles && interaction.member.roles.cache && interaction.member.roles.cache.has(db[guildId].yetkiliRol))
        );

        // ------------------------------------------------------------------------
        // 1. SLASH KOMUTLARI (/panel, /yaz, /hapis, /af, /sil)
        // ------------------------------------------------------------------------
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === 'panel') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri açabilir.', ephemeral: true });
                return interaction.reply({ ...buildHomeDashboard(interaction.guild), ephemeral: true });
            }

            if (commandName === 'yaz') {
                if (!isAdmin) return interaction.reply({ content: 'Bu komutu sadece Sunucu Yöneticileri kullanabilir.', ephemeral: true });
                const mesaj = interaction.options.getString('mesaj');
                await interaction.channel.send(mesaj);
                return interaction.reply({ content: 'Mesaj başarıyla kanala gönderildi.', ephemeral: true });
            }

            if (['hapis', 'af', 'sil'].includes(commandName)) {
                if (!isAdmin && !isYetkili) return interaction.reply({ content: 'Bu komutu kullanmak için Yetkili Rolüne veya Yönetici iznine sahip olmalısınız.', ephemeral: true });

                if (commandName === 'hapis') {
                    const user = interaction.options.getUser('kullanici');
                    const sayi = interaction.options.getInteger('sure');
                    const kavram = interaction.options.getString('birim');
                    const sebep = interaction.options.getString('sebep');
                    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

                    if (!member) return interaction.reply({ content: 'Kullanıcı sunucuda bulunamadı.', ephemeral: true });
                    if (!member.manageable) return interaction.reply({ content: 'Bu kullanıcının rolü benden yüksek veya eşit olduğu için işlem yapılamıyor.', ephemeral: true });

                    let sureMs = 0;
                    if (kavram === 'saniye') sureMs = sayi * 1000;
                    if (kavram === 'dakika') sureMs = sayi * 60 * 1000;
                    if (kavram === 'saat') sureMs = sayi * 60 * 60 * 1000;
                    if (kavram === 'gun') sureMs = sayi * 24 * 60 * 60 * 1000;

                    const sureDk = sureMs / (1000 * 60);

                    if (!db[guildId].users[user.id]) db[guildId].users[user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };

                    let userData = db[guildId].users[user.id];
                    userData.jailExpire = Date.now() + sureMs;
                    userData.jailCount += 1;

                    let sicilVerilecek = false;
                    let sicilDurumMesaji = "";

                    if (sureDk > 10) {
                        sicilVerilecek = true;
                        sicilDurumMesaji = "İşlendi (10 dakikadan uzun ceza)";
                    } else {
                        const currentMinor = userData.minorJailCount ? userData.minorJailCount : 0;
                        userData.minorJailCount = currentMinor + 1;
                        if (userData.minorJailCount >= 11) {
                            sicilVerilecek = true;
                            sicilDurumMesaji = `İşlendi (Sınır aşıldı: ${userData.minorJailCount}/11)`;
                        } else {
                            sicilDurumMesaji = `Temiz (Hafif İhlal: ${userData.minorJailCount}/11)`;
                        }
                    }

                    if (sicilVerilecek) userData.sicilli = true;
                    saveDB(db);

                    if (db[guildId].jailRol) await member.roles.add(db[guildId].jailRol).catch(() => { });
                    if (sicilVerilecek && db[guildId].sicilRol) await member.roles.add(db[guildId].sicilRol).catch(() => { });

                    sendLog(interaction.guild, 'logCeza', {
                        title: 'Manuel Cezalandırma (Hapis)',
                        desc: `**Yetkili:** <@${interaction.user.id}>\n**Kullanıcı:** <@${user.id}>\n**Süre:** ${sayi} ${kavram}\n**Sebep:** ${sebep}\n**Sicil:** ${sicilDurumMesaji}`,
                        color: 0xed4245,
                        thumbnail: user.displayAvatarURL()
                    });

                    return interaction.reply({ content: `<@${user.id}> adlı kullanıcıya **${sayi} ${kavram}** uzaklaştırma cezası uygulandı.`, ephemeral: true });
                }

                if (commandName === 'af') {
                    const user = interaction.options.getUser('kullanici');
                    if (user) {
                        if (db[guildId].users && db[guildId].users[user.id]) {
                            delete db[guildId].users[user.id];
                            saveDB(db);
                            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                            if (member && member.manageable) {
                                if (db[guildId].jailRol) member.roles.remove(db[guildId].jailRol).catch(() => { });
                                if (db[guildId].sicilRol) member.roles.remove(db[guildId].sicilRol).catch(() => { });
                            }
                            sendLog(interaction.guild, 'logCeza', { title: 'Ceza ve Sicil Affı', desc: `**Yetkili:** <@${interaction.user.id}>\n**Affedilen:** <@${user.id}>\nKullanıcının tüm ceza ve sicil kayıtları temizlendi.`, color: 0x57f287 });
                            return interaction.reply({ content: `**${user.tag}** adlı kullanıcının cezası kaldırıldı ve sicili temizlendi.`, ephemeral: true });
                        } else {
                            return interaction.reply({ content: `**${user.tag}** adlı kullanıcının aktif bir ceza veya sicil kaydı bulunmuyor.`, ephemeral: true });
                        }
                    } else {
                        if (!isAdmin) return interaction.reply({ content: 'Genel af işlemini sadece Sunucu Yöneticileri uygulayabilir.', ephemeral: true });
                        db[guildId].users = {};
                        saveDB(db);
                        sendLog(interaction.guild, 'logCeza', { title: 'Genel Af Uygulandı', desc: `**Yetkili:** <@${interaction.user.id}>\nSunucudaki tüm üyelerin ceza ve sicil kayıtları sıfırlandı.`, color: 0x57f287 });
                        return interaction.reply({ content: 'Sunucudaki tüm sicil ve ceza kayıtları sıfırlandı.', ephemeral: true });
                    }
                }

                if (commandName === 'sil') {
                    const miktar = interaction.options.getInteger('miktar');
                    if (miktar < 1 || miktar > 100) return interaction.reply({ content: 'Lütfen 1 ile 100 arasında bir sayı girin.', ephemeral: true });
                    const deleted = await interaction.channel.bulkDelete(miktar, true).catch(() => null);
                    const count = deleted ? deleted.size : 0;
                    sendLog(interaction.guild, 'logMesaj', { title: 'Toplu Mesaj Silme (/sil)', desc: `**Yetkili:** <@${interaction.user.id}>\n**Kanal:** <#${interaction.channel.id}>\n**Miktar:** ${count} adet mesaj silindi.`, color: 0xed4245 });
                    return interaction.reply({ content: `**${count}** adet mesaj silindi.`, ephemeral: true });
                }
            }

            if (commandName === 'durum') {
                if (!isAdmin) return interaction.reply({ content: 'Bu komutu sadece Sunucu Yöneticileri kullanabilir.', ephemeral: true });
                await interaction.deferReply({ ephemeral: true }).catch(() => { });
                const yeniDurum = interaction.options.getString('mesaj')?.trim() || '';

                if (yeniDurum.length > 0) {
                    client.user.setPresence({
                        activities: [{ name: yeniDurum, type: ActivityType.Playing }],
                        status: 'online'
                    });
                    db.botStatus = yeniDurum;
                    saveDB(db);
                    return interaction.editReply({ content: `✅ Botun durumu başarıyla **"${yeniDurum}"** *(Oynuyor)* olarak güncellendi.` });
                } else {
                    client.user.setPresence({ activities: [] });
                    delete db.botStatus;
                    saveDB(db);
                    return interaction.editReply({ content: '✅ Botun durum mesajı temizlendi/sıfırlandı.' });
                }
            }

            // ----------------------------------------------------------------
            // XP & PAPEL (EKONOMİ) KOMUTLARI (KİŞİYE ÖZEL / EPHEMERAL)
            // ----------------------------------------------------------------
            if (commandName === 'rank' || commandName === 'profil') {
                const targetUser = interaction.options.getUser('kullanici') || interaction.user;
                ensureGuildDB(db, guildId);
                return interaction.reply(buildUserProfileCard(targetUser, interaction.guild, db[guildId]));
            }

            if (commandName === 'market') {
                ensureGuildDB(db, guildId);
                return interaction.reply(buildMarketView(interaction.guild, db[guildId], interaction.user));
            }

            if (commandName === 'gunluk') {
                ensureGuildDB(db, guildId);
                if (!db[guildId].users[interaction.user.id]) {
                    db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[interaction.user.id];
                if (uData.papel === undefined) uData.papel = 0;
                if (uData.lastDaily === undefined) uData.lastDaily = 0;

                const now = Date.now();
                const cooldown = 24 * 60 * 60 * 1000;

                if (uData.lastDaily && (now - uData.lastDaily < cooldown)) {
                    const remainingMs = cooldown - (now - uData.lastDaily);
                    const remHours = Math.floor(remainingMs / (1000 * 60 * 60));
                    const remMins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                    return interaction.reply({
                        content: `⏳ Günlük papel ödülünü zaten aldınız! Tekrar alabilmek için **${remHours} saat ${remMins} dakika** beklemelisiniz. *(Günlük papel alımı günde 1 adetle sınırlıdır)*`,
                        ephemeral: true
                    });
                }

                uData.lastDaily = now;
                uData.papel += 1;
                saveDB(db);

                return interaction.reply({
                    content: `🎉 Tebrikler! 24 saatlik günlük **1 Papel** 💵 ödülünüzü aldınız.\nGüncel Bakiyeniz: **${uData.papel} Papel**`,
                    ephemeral: true
                });
            }

            if (commandName === 'yazitura') {
                ensureGuildDB(db, guildId);
                if (db[guildId].gamesEnabled === false) {
                    return interaction.reply({ content: 'Bu sunucuda kumar ve şans oyunları yönetici tarafından kapatılmıştır.', ephemeral: true });
                }

                const miktar = interaction.options.getInteger('miktar');
                const secim = interaction.options.getString('secim');

                if (miktar < 1) return interaction.reply({ content: 'Bahis miktarı en az **1 Papel** olmalıdır.', ephemeral: true });

                if (!db[guildId].users[interaction.user.id]) {
                    db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[interaction.user.id];
                if (uData.papel === undefined) uData.papel = 0;

                if (uData.papel < miktar) {
                    return interaction.reply({ content: `❌ Yetersiz bakiye! Mevcut bakiyeniz: **${uData.papel} Papel**.`, ephemeral: true });
                }

                const roll = Math.random() * 100;
                let outcome = '';
                let win = false;

                if (roll < 45) {
                    outcome = 'yazi';
                    win = (secim === 'yazi');
                } else if (roll < 90) {
                    outcome = 'tura';
                    win = (secim === 'tura');
                } else {
                    outcome = 'dik';
                    win = false;
                }

                const secimText = secim === 'yazi' ? 'Yazı' : 'Tura';
                const outcomeText = outcome === 'dik' ? 'Para dik geldi! 🪙 (Kasa Kazandı)' : (outcome === 'yazi' ? 'Yazı 🪙' : 'Tura 🪙');

                if (win) {
                    uData.papel += miktar;
                    saveDB(db);
                    return interaction.reply({
                        content: `🪙 **Yazı-Tura Sonucu:** ${outcomeText}\nTahmininiz: **${secimText}**\n\n🎉 **Tebrikler, kazandınız!** +${miktar} Papel kazandınız.\n💵 Güncel Bakiyeniz: **${uData.papel} Papel**`,
                        ephemeral: true
                    });
                } else {
                    uData.papel -= miktar;
                    saveDB(db);
                    return interaction.reply({
                        content: `🪙 **Yazı-Tura Sonucu:** ${outcomeText}\nTahmininiz: **${secimText}**\n\n💀 **Maalesef kaybettiniz!** -${miktar} Papel kaybettiniz.\n💵 Güncel Bakiyeniz: **${uData.papel} Papel**`,
                        ephemeral: true
                    });
                }
            }

            if (commandName === 'slot') {
                ensureGuildDB(db, guildId);
                if (db[guildId].gamesEnabled === false) {
                    return interaction.reply({ content: 'Bu sunucuda kumar ve şans oyunları yönetici tarafından kapatılmıştır.', ephemeral: true });
                }

                const miktar = interaction.options.getInteger('miktar');
                if (miktar < 1) return interaction.reply({ content: 'Bahis miktarı en az **1 Papel** olmalıdır.', ephemeral: true });

                if (!db[guildId].users[interaction.user.id]) {
                    db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[interaction.user.id];
                if (uData.papel === undefined) uData.papel = 0;

                if (uData.papel < miktar) {
                    return interaction.reply({ content: `❌ Yetersiz bakiye! Mevcut bakiyeniz: **${uData.papel} Papel**.`, ephemeral: true });
                }

                const symbols = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
                const roll = Math.random() * 100;
                let s1, s2, s3;
                let winMultiplier = 0;

                if (roll < 4) {
                    const chosen = symbols[Math.floor(Math.random() * symbols.length)];
                    s1 = s2 = s3 = chosen;
                    winMultiplier = 5;
                } else if (roll < 20) {
                    const chosen = symbols[Math.floor(Math.random() * symbols.length)];
                    const remaining = symbols.filter(s => s !== chosen);
                    const diff = remaining[Math.floor(Math.random() * remaining.length)];
                    s1 = chosen; s2 = chosen; s3 = diff;
                    winMultiplier = 1.5;
                } else {
                    const shuffled = [...symbols].sort(() => 0.5 - Math.random());
                    s1 = shuffled[0]; s2 = shuffled[1]; s3 = shuffled[2];
                    winMultiplier = 0;
                }

                const slotVisual = `╔══════════════╗\n║  ${s1}  │  ${s2}  │  ${s3}  ║\n╚══════════════╝`;

                if (winMultiplier > 0) {
                    const kazanilan = Math.ceil(miktar * winMultiplier);
                    const netKar = Math.max(1, kazanilan - miktar);
                    uData.papel += netKar;
                    saveDB(db);
                    return interaction.reply({
                        content: `🎰 **Slot Makinesi Çevrildi:**\n\`\`\`\n${slotVisual}\n\`\`\`\n🎉 **Tebrikler! (${winMultiplier}x Kazanç)**\n+${netKar} Papel kazandınız!\n💵 Güncel Bakiyeniz: **${uData.papel} Papel**`,
                        ephemeral: true
                    });
                } else {
                    uData.papel -= miktar;
                    saveDB(db);
                    return interaction.reply({
                        content: `🎰 **Slot Makinesi Çevrildi:**\n\`\`\`\n${slotVisual}\n\`\`\`\n💀 **Maalesef kaybettiniz!**\n-${miktar} Papel kaybettiniz.\n💵 Güncel Bakiyeniz: **${uData.papel} Papel**`,
                        ephemeral: true
                    });
                }
            }

            if (commandName === 'papel-ver') {
                if (!isAdmin) return interaction.reply({ content: 'Bu komutu sadece Sunucu Yöneticileri kullanabilir.', ephemeral: true });
                const targetUser = interaction.options.getUser('kullanici');
                const miktar = interaction.options.getInteger('miktar');
                if (miktar < 1) return interaction.reply({ content: 'Lütfen en az 1 Papel girin.', ephemeral: true });

                ensureGuildDB(db, guildId);
                if (!db[guildId].users[targetUser.id]) {
                    db[guildId].users[targetUser.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[targetUser.id];
                if (uData.papel === undefined) uData.papel = 0;

                uData.papel += miktar;
                saveDB(db);

                addLiveLog(`[PAPEL VERİLDİ] ${interaction.user.tag} -> ${targetUser.tag}: +${miktar} Papel`);
                return interaction.reply({
                    content: `✅ <@${targetUser.id}> adlı kullanıcıya **+${miktar.toLocaleString('tr-TR')} Papel** 💵 hediye edildi.\nKullanıcının Yeni Bakiyesi: **${uData.papel.toLocaleString('tr-TR')} Papel**`,
                    ephemeral: true
                });
            }

            if (commandName === 'papel-al') {
                if (!isAdmin) return interaction.reply({ content: 'Bu komutu sadece Sunucu Yöneticileri kullanabilir.', ephemeral: true });
                const targetUser = interaction.options.getUser('kullanici');
                const miktar = interaction.options.getInteger('miktar');
                if (miktar < 1) return interaction.reply({ content: 'Lütfen en az 1 Papel girin.', ephemeral: true });

                ensureGuildDB(db, guildId);
                if (!db[guildId].users[targetUser.id]) {
                    db[guildId].users[targetUser.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[targetUser.id];
                if (uData.papel === undefined) uData.papel = 0;

                uData.papel = Math.max(0, uData.papel - miktar);
                saveDB(db);

                addLiveLog(`[PAPEL KESİLDİ] ${interaction.user.tag} -> ${targetUser.tag}: -${miktar} Papel`);
                return interaction.reply({
                    content: `✅ <@${targetUser.id}> adlı kullanıcıdan **-${miktar.toLocaleString('tr-TR')} Papel** 💵 kesildi.\nKullanıcının Kalan Bakiyesi: **${uData.papel.toLocaleString('tr-TR')} Papel**`,
                    ephemeral: true
                });
            }

            if (commandName === 'radyo') {
                const voiceChannel = interaction.member?.voice?.channel;
                const islem = interaction.options.getString('islem');

                if (islem === 'kapat') {
                    if (!radioPlayers.has(guildId)) {
                        return interaction.reply({
                            content: '📻 Zaten şu anda bu sunucuda çalan aktif bir radyo yayını bulunmuyor.',
                            ephemeral: true
                        });
                    }
                    stopRadio(guildId);
                    return interaction.reply({
                        content: '⏹️ Canlı radyo yayını sonlandırıldı ve ses odasından ayrılındı.',
                        ephemeral: false
                    });
                }

                if (!voiceChannel) {
                    return interaction.reply({
                        content: '⚠️ Radyo dinleyebilmek için lütfen önce herhangi bir **ses kanalına** katılın.',
                        ephemeral: true
                    });
                }

                return interaction.reply(buildRadioView(interaction.guild, voiceChannel.id));
            }
        }

        // ------------------------------------------------------------------------
        // 2. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
        // ------------------------------------------------------------------------
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'panel_ayar_sec') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const secim = interaction.values[0];

                if (secim === 'toggle_link') {
                    db[guildId].linkEngel = !db[guildId].linkEngel;
                    saveDB(db);
                    return interaction.update(buildAyarDashboard(db[guildId]));
                }
                if (secim === 'toggle_kufur') {
                    db[guildId].kufurEngel = !db[guildId].kufurEngel;
                    saveDB(db);
                    return interaction.update(buildAyarDashboard(db[guildId]));
                }
                if (secim === 'toggle_oto') {
                    db[guildId].otoCevap = db[guildId].otoCevap === false ? true : false;
                    saveDB(db);
                    return interaction.update(buildAyarDashboard(db[guildId]));
                }

                if (['yetkiliRol', 'muafRol', 'jailRol', 'sicilRol', 'duyuruRol'].includes(secim)) {
                    const roleSelect = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`set_ayar_rol_${secim}`)
                            .setPlaceholder('Atanacak rolü listeden seçin...')
                            .setMaxValues(1)
                    );
                    const panelData = buildAyarDashboard(db[guildId]);
                    panelData.components.push(roleSelect);
                    return interaction.update(panelData);
                }

                if (secim === 'add_custom_kufur') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal_add_custom_kufur')
                        .setTitle('Özel Yasaklı Kelime Ekle');
                    const input = new TextInputBuilder()
                        .setCustomId('kufur_word')
                        .setLabel('Engellenecek Kelime / İfade')
                        .setPlaceholder('Örn: yasaklikelime')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(50);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }

                if (secim === 'list_custom_kufur') {
                    const customList = db[guildId].customKufurler || [];
                    if (customList.length === 0) {
                        return interaction.reply({ content: 'Bu sunucuda henüz eklenmiş özel bir yasaklı kelime bulunmuyor.', ephemeral: true });
                    }
                    const options = customList.slice(0, 25).map(w => ({
                        label: w,
                        description: `"${w}" kelimesini yasaklı listesinden kaldırır.`,
                        value: w
                    }));
                    const selectMenu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('delete_custom_kufur_select')
                            .setPlaceholder('Silmek istediğiniz yasaklı kelimeyi seçin...')
                            .addOptions(options)
                    );
                    const panelData = buildAyarDashboard(db[guildId]);
                    panelData.components.push(selectMenu);
                    return interaction.update(panelData);
                }

                if (secim === 'add_stream_tracker') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal_add_stream_tracker')
                        .setTitle('Yayıncı / Kanal Ekle');
                    const input = new TextInputBuilder()
                        .setCustomId('tracker_url')
                        .setLabel('Kanal Linki (YouTube, Kick veya Twitch)')
                        .setPlaceholder('Örn: https://kick.com/kanal veya https://twitch.tv/kanal')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }

                if (secim === 'list_stream_trackers') {
                    const trackers = db[guildId].trackers || [];
                    if (trackers.length === 0) {
                        return interaction.reply({ content: 'Bu sunucuda henüz eklenmiş bir YouTube, Kick veya Twitch kanalı bulunmuyor.', ephemeral: true });
                    }
                    const trackerOptions = trackers.slice(0, 25).map(t => ({
                        label: `${t.name} (${t.platform.toUpperCase()})`,
                        description: t.url.slice(0, 100),
                        value: t.url
                    }));
                    const selectMenu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('delete_stream_tracker_select')
                            .setPlaceholder('Silmek istediğiniz kanalı seçin...')
                            .addOptions(trackerOptions)
                    );
                    const panelData = buildAyarDashboard(db[guildId]);
                    panelData.components.push(selectMenu);
                    return interaction.update(panelData);
                }

                if (secim === 'manage_bot_whitelist') {
                    const userSelect = new ActionRowBuilder().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId('select_bot_whitelist')
                            .setPlaceholder('Beyaz listeye eklenecek veya kaldırılacak bot/üyeyi seçin...')
                            .setMaxValues(1)
                    );
                    const panelData = buildAyarDashboard(db[guildId]);
                    panelData.components.push(userSelect);
                    return interaction.update(panelData);
                }

                if (secim === 'set_bot_status') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal_set_bot_status')
                        .setTitle('Bot Durum Mesajı (Oynuyor)');
                    const input = new TextInputBuilder()
                        .setCustomId('status_val')
                        .setLabel('Botun "Oynuyor" Durum Yazısı')
                        .setPlaceholder('Örn: Sunucuyu Denetliyor... (Boş = Sıfırlar)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setMaxLength(120);
                    if (db.botStatus) input.setValue(db.botStatus);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }

                // Topluluk Duyuru Kanalları (GuildAnnouncement) Desteği
                const chTypeMap = {
                    'duyuruKanal': [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    'odaKanal': [ChannelType.GuildVoice],
                    'odaKategori': [ChannelType.GuildCategory]
                };
                if (chTypeMap[secim]) {
                    const chSelect = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`set_ayar_ch_${secim}`)
                            .setPlaceholder('İlgili kanalı veya kategoriyi listeden seçin...')
                            .setChannelTypes(chTypeMap[secim])
                            .setMaxValues(1)
                    );
                    const panelData = buildAyarDashboard(db[guildId]);
                    panelData.components.push(chSelect);
                    return interaction.update(panelData);
                }
            }

            if (interaction.customId === 'delete_stream_tracker_select') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const selectedUrl = interaction.values[0];
                db[guildId].trackers = (db[guildId].trackers || []).filter(t => t.url !== selectedUrl);
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId]));
            }

            if (interaction.customId === 'delete_custom_kufur_select') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const selectedWord = interaction.values[0];
                db[guildId].customKufurler = (db[guildId].customKufurler || []).filter(w => w !== selectedWord);
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId]));
            }

            if (interaction.customId === 'panel_log_sec') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const logKey = interaction.values[0];

                const chSelect = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`set_log_ch_${logKey}`)
                        .setPlaceholder('Bu log kategorisi için metin veya duyuru kanalını seçin...')
                        .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
                        .setMaxValues(1)
                );
                const panelData = buildLogDashboard(db[guildId]);
                panelData.components.push(chSelect);
                return interaction.update(panelData);
            }

            if (interaction.customId === 'vc_privacy_menu') {
                const channel = interaction.channel;
                const roomData = db[guildId].tempRooms[channel.id];
                if (!roomData) return interaction.reply({ content: 'Bu odaya ait veri bulunamadı.', ephemeral: true });
                if (interaction.user.id !== roomData.ownerId && !isAdmin) {
                    return interaction.reply({ content: `Bu menüyü sadece oda sahibi (<@${roomData.ownerId}>) kullanabilir.`, ephemeral: true });
                }

                const choice = interaction.values[0];
                if (choice === 'lock') {
                    roomData.locked = true;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }).catch(() => { });
                } else if (choice === 'unlock') {
                    roomData.locked = false;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true }).catch(() => { });
                } else if (choice === 'invisible') {
                    roomData.hidden = true;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(() => { });
                } else if (choice === 'visible') {
                    roomData.hidden = false;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true }).catch(() => { });
                } else if (choice === 'close_chat') {
                    roomData.chatClosed = true;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false }).catch(() => { });
                } else if (choice === 'open_chat') {
                    roomData.chatClosed = false;
                    await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: true }).catch(() => { });
                }

                saveDB(db);
                return interaction.update({
                    embeds: [buildTempVoiceEmbed(roomData)],
                    components: buildTempVoiceComponents(roomData, false)
                });
            }

            // --- EKONOMİ VE XP PANELİ MENÜ SEÇİMLERİ ---
            if (interaction.customId === 'panel_ekonomi_sec') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const secim = interaction.values[0];

                if (secim === 'set_level_role') {
                    const levelOptions = XP_LEVELS.map(lvl => ({
                        label: `${lvl.title} (${lvl.xp.toLocaleString('tr-TR')} XP)`,
                        description: `Seviye ${lvl.level} ulaşıldığında verilecek rol`,
                        value: String(lvl.level)
                    }));

                    const lvlSelect = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_level_target_for_role')
                            .setPlaceholder('Ödül rolü bağlamak istediğiniz seviyeyi seçin...')
                            .addOptions(levelOptions)
                    );
                    const panelData = buildEkonomiDashboard(db[guildId]);
                    panelData.components.push(lvlSelect);
                    return interaction.update(panelData);
                }

                if (secim === 'clear_level_role') {
                    const configured = Object.keys(db[guildId].levelRoles || {}).filter(k => db[guildId].levelRoles[k]);
                    if (configured.length === 0) {
                        return interaction.reply({ content: 'Henüz atanmış bir seviye ödül rolü bulunmuyor.', ephemeral: true });
                    }
                    const options = configured.map(k => {
                        const lvlObj = XP_LEVELS.find(l => l.level === parseInt(k, 10));
                        return {
                            label: `${lvlObj ? lvlObj.title : `Seviye ${k}`}`,
                            description: `Mevcut Rol ID: ${db[guildId].levelRoles[k]}`,
                            value: k
                        };
                    });

                    const clrSelect = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('delete_level_role_select')
                            .setPlaceholder('Sıfırlamak / kaldırmak istediğiniz seviyeyi seçin...')
                            .addOptions(options)
                    );
                    const panelData = buildEkonomiDashboard(db[guildId]);
                    panelData.components.push(clrSelect);
                    return interaction.update(panelData);
                }

                if (secim === 'add_market_role') {
                    const roleSelect = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId('select_role_for_market_add')
                            .setPlaceholder('Markete satılık olarak eklenecek rolü seçin...')
                            .setMaxValues(1)
                    );
                    const panelData = buildEkonomiDashboard(db[guildId]);
                    panelData.components.push(roleSelect);
                    return interaction.update(panelData);
                }

                if (secim === 'remove_market_role') {
                    const marketRoles = db[guildId].marketRoles || [];
                    if (marketRoles.length === 0) {
                        return interaction.reply({ content: 'Markette satışta olan bir rol bulunmuyor.', ephemeral: true });
                    }
                    const options = marketRoles.slice(0, 25).map((item) => {
                        const r = interaction.guild.roles.cache.get(item.roleId);
                        return {
                            label: r ? r.name : `Rol: ${item.roleId}`,
                            description: `Fiyat: ${item.price.toLocaleString('tr-TR')} Papel`,
                            value: item.roleId
                        };
                    });
                    const remSelect = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('delete_market_role_select')
                            .setPlaceholder('Marketten kaldırmak istediğiniz rolü seçin...')
                            .addOptions(options)
                    );
                    const panelData = buildEkonomiDashboard(db[guildId]);
                    panelData.components.push(remSelect);
                    return interaction.update(panelData);
                }
            }

            if (interaction.customId === 'select_level_target_for_role') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const selectedLvl = interaction.values[0];
                const lvlObj = XP_LEVELS.find(l => l.level === parseInt(selectedLvl, 10));

                const roleSelect = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId(`set_level_role_final_${selectedLvl}`)
                        .setPlaceholder(`${lvlObj ? lvlObj.title : `Seviye ${selectedLvl}`} için atanacak rolü seçin...`)
                        .setMaxValues(1)
                );
                const panelData = buildEkonomiDashboard(db[guildId]);
                panelData.components.push(roleSelect);
                return interaction.update(panelData);
            }

            if (interaction.customId === 'delete_level_role_select') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const selectedLvl = interaction.values[0];
                if (db[guildId].levelRoles) {
                    delete db[guildId].levelRoles[selectedLvl];
                    saveDB(db);
                }
                return interaction.update(buildEkonomiDashboard(db[guildId]));
            }

            if (interaction.customId === 'delete_market_role_select') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const targetRoleId = interaction.values[0];
                if (db[guildId].marketRoles) {
                    db[guildId].marketRoles = db[guildId].marketRoles.filter(r => r.roleId !== targetRoleId);
                    saveDB(db);
                }
                return interaction.update(buildEkonomiDashboard(db[guildId]));
            }

            if (interaction.customId === 'user_buy_market_role') {
                ensureGuildDB(db, guildId);
                const targetRoleId = interaction.values[0];
                const marketRoles = db[guildId].marketRoles || [];
                const item = marketRoles.find(r => r.roleId === targetRoleId);

                if (!item) {
                    return interaction.reply({ content: '❌ Bu rol artık markette satışta değil.', ephemeral: true });
                }

                if (interaction.member.roles.cache.has(targetRoleId)) {
                    return interaction.reply({ content: '⚠️ Zaten bu role sahipsiniz!', ephemeral: true });
                }

                if (!db[guildId].users[interaction.user.id]) {
                    db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[interaction.user.id];
                if (uData.papel === undefined) uData.papel = 0;
                if (uData.spentPapel === undefined) uData.spentPapel = 0;

                if (uData.papel < item.price) {
                    return interaction.reply({
                        content: `❌ Yetersiz bakiye! Bu rolü satın almak için **${item.price.toLocaleString('tr-TR')} Papel** gerekiyor. Mevcut bakiyeniz: **${uData.papel.toLocaleString('tr-TR')} Papel**.`,
                        ephemeral: true
                    });
                }

                uData.papel -= item.price;
                uData.spentPapel += item.price;

                const isTemporary = item.durationDays && item.durationDays > 0;
                let expiresAt = null;

                if (isTemporary) {
                    expiresAt = Date.now() + (item.durationDays * 24 * 60 * 60 * 1000);
                    if (!Array.isArray(db[guildId].tempUserRoles)) db[guildId].tempUserRoles = [];
                    // Varsa eski kaydı temizle
                    db[guildId].tempUserRoles = db[guildId].tempUserRoles.filter(tr => !(tr.userId === interaction.user.id && tr.roleId === targetRoleId));
                    db[guildId].tempUserRoles.push({
                        userId: interaction.user.id,
                        roleId: targetRoleId,
                        expiresAt: expiresAt,
                        purchasedAt: Date.now()
                    });
                }

                saveDB(db);

                try {
                    await interaction.member.roles.add(targetRoleId);
                    const durText = isTemporary ? `\n⏳ **Süre:** **${formatDurationLabel(item.durationDays)}** (Süre bittiğinde otomatik kaldırılacaktır)` : '\n♾️ **Süre:** **Kalıcı**';
                    return interaction.reply({
                        content: `🎉 Tebrikler! **${item.price.toLocaleString('tr-TR')} Papel** karşılığında <@&${targetRoleId}> rolünü başarıyla satın aldınız!${durText}\n💵 Kalan Bakiyeniz: **${uData.papel.toLocaleString('tr-TR')} Papel**`,
                        ephemeral: true
                    });
                } catch (err) {
                    // Rol verilemezse bakiyeyi iade et
                    uData.papel += item.price;
                    uData.spentPapel -= item.price;
                    if (isTemporary && Array.isArray(db[guildId].tempUserRoles)) {
                        db[guildId].tempUserRoles = db[guildId].tempUserRoles.filter(tr => !(tr.userId === interaction.user.id && tr.roleId === targetRoleId));
                    }
                    saveDB(db);
                    return interaction.reply({
                        content: `❌ Rol verilirken bir hata oluştu (Yetki sırası hatası olabilir). Papel bakiyenizden düşülmedi. Hata: ${err.message}`,
                        ephemeral: true
                    });
                }
            }

            if (interaction.customId === 'select_radio_muzik' || interaction.customId === 'select_radio_haber') {
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.reply({
                        content: '⚠️ Radyo çalabilmek için lütfen bir **ses kanalında** bulunun.',
                        ephemeral: true
                    });
                }

                const stationId = interaction.values[0];
                const allStations = [...RADIO_STATIONS.muzik, ...RADIO_STATIONS.haber];
                const station = allStations.find(s => s.id === stationId);

                if (!station) {
                    return interaction.reply({ content: '❌ Seçilen radyo istasyonu bulunamadı.', ephemeral: true });
                }

                await interaction.deferUpdate().catch(() => { });

                try {
                    await playRadio(interaction.guild, voiceChannel, station);
                    return interaction.editReply(buildRadioView(interaction.guild, voiceChannel.id, station)).catch(() => { });
                } catch (err) {
                    return interaction.followUp({
                        content: `❌ Radyo bağlantısı kurulurken hata oluştu: ${err.message}`,
                        ephemeral: true
                    }).catch(() => { });
                }
            }
        }

        // ------------------------------------------------------------------------
        // 3. KANAL VE ROL SEÇİM MENÜSÜ ETKİLEŞİMLERİ
        // ------------------------------------------------------------------------
        if (interaction.isRoleSelectMenu()) {
            if (interaction.customId.startsWith('set_ayar_rol_')) {
                if (!isAdmin) return;
                const key = interaction.customId.replace('set_ayar_rol_', '');
                db[guildId][key] = interaction.values[0];
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId]));
            }

            if (interaction.customId.startsWith('set_level_role_final_')) {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const lvl = interaction.customId.replace('set_level_role_final_', '');
                const selectedRoleId = interaction.values[0];

                if (!db[guildId].levelRoles) db[guildId].levelRoles = {};
                db[guildId].levelRoles[lvl] = selectedRoleId;
                saveDB(db);

                return interaction.update(buildEkonomiDashboard(db[guildId]));
            }

            if (interaction.customId === 'select_role_for_market_add') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const selectedRoleId = interaction.values[0];

                const modal = new ModalBuilder()
                    .setCustomId(`modal_market_price_${selectedRoleId}`)
                    .setTitle('Market Rolü ve Süresi Belirle');

                const priceInput = new TextInputBuilder()
                    .setCustomId('market_price_val')
                    .setLabel('Bu rol kaç Papel karşılığında satılsın?')
                    .setPlaceholder('Örn: 250')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(8)
                    .setRequired(true);

                const durationInput = new TextInputBuilder()
                    .setCustomId('market_duration_val')
                    .setLabel('Süre (Gün: 14 = 2 hafta, 0/boş = Kalıcı)')
                    .setPlaceholder('Örn: 14 (Kalıcı için 0 veya boş bırakın)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(5)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(priceInput),
                    new ActionRowBuilder().addComponents(durationInput)
                );
                return interaction.showModal(modal);
            }
        }

        if (interaction.isChannelSelectMenu()) {
            if (interaction.customId.startsWith('set_ayar_ch_')) {
                if (!isAdmin) return;
                const key = interaction.customId.replace('set_ayar_ch_', '');
                db[guildId][key] = interaction.values[0];
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId]));
            }

            if (interaction.customId.startsWith('set_log_ch_')) {
                if (!isAdmin) return;
                const key = interaction.customId.replace('set_log_ch_', '');
                db[guildId][key] = interaction.values[0];
                saveDB(db);
                return interaction.update(buildLogDashboard(db[guildId]));
            }

            if (interaction.customId === 'select_ticket_kur_cat') {
                if (!isAdmin) return;
                db[guildId].tempTicketCat = interaction.values[0];
                saveDB(db);
                return interaction.update(buildTicketDashboard(db[guildId]));
            }

            if (interaction.customId.startsWith('select_ticket_kur_ch_')) {
                if (!isAdmin) return;
                const catId = interaction.customId.replace('select_ticket_kur_ch_', '');
                const targetChId = interaction.values[0];

                const modal = new ModalBuilder()
                    .setCustomId(`modal_ticket_kur_${targetChId}_${catId}`)
                    .setTitle('Ticket Paneli ve Mesaj Kurulumu');

                const titleInput = new TextInputBuilder()
                    .setCustomId('t_baslik')
                    .setLabel('Panel Başlığı (Kutunun en üst başlığı)')
                    .setValue('Destek ve Başvuru Merkezi')
                    .setMaxLength(250)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const descInput = new TextInputBuilder()
                    .setCustomId('t_aciklama')
                    .setLabel('Panel Açıklaması (Kutunun içindeki yazı)')
                    .setValue('Yetkililerle iletişime geçmek, başvuruda bulunmak veya destek almak için aşağıdaki butona tıklayarak formu doldurabilirsiniz.')
                    .setMaxLength(2000)
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                const btnInput = new TextInputBuilder()
                    .setCustomId('t_buton')
                    .setLabel('Buton Metni (Tıklanacak butonun yazısı)')
                    .setValue('Talep Oluştur')
                    .setMaxLength(80)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const welcomeInput = new TextInputBuilder()
                    .setCustomId('t_ic_mesaj')
                    .setLabel('Bilet İçi Mesaj (Oda açılınca yazacak mesaj)')
                    .setValue('Talebiniz ve ilettiğiniz bilgiler aşağıda yer almaktadır. Yetkililerimiz en kısa sürede sizinle ilgilenecektir.')
                    .setMaxLength(1500)
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(titleInput),
                    new ActionRowBuilder().addComponents(descInput),
                    new ActionRowBuilder().addComponents(btnInput),
                    new ActionRowBuilder().addComponents(welcomeInput)
                );

                return interaction.showModal(modal);
            }
        }

        // ------------------------------------------------------------------------
        // 4. BUTON ETKİLEŞİMLERİ (DASHBOARD NAVİGASYON, TEMP VC & TICKET)
        // ------------------------------------------------------------------------
        if (interaction.isButton()) {
            const customId = interaction.customId;

            // --- CANLI RADYO BUTONLARI ---
            if (customId === 'btn_radio_stop') {
                const voiceChannel = interaction.member?.voice?.channel;
                if (!radioPlayers.has(guildId)) {
                    return interaction.reply({ content: '📻 Şu anda çalan aktif bir radyo bulunmuyor.', ephemeral: true });
                }
                stopRadio(guildId);
                return interaction.update(buildRadioView(interaction.guild, voiceChannel ? voiceChannel.id : null)).catch(() => { });
            }

            if (customId.startsWith('btn_radio_refresh_')) {
                const voiceChannel = interaction.member?.voice?.channel;
                const paramChId = customId.replace('btn_radio_refresh_', '');
                const chId = (paramChId && paramChId !== 'none') ? paramChId : (voiceChannel ? voiceChannel.id : null);
                return interaction.update(buildRadioView(interaction.guild, chId)).catch(() => { });
            }

            // --- /PANEL GEZİNME BUTONLARI ---
            if (customId === 'nav_panel_home') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildHomeDashboard(interaction.guild)).catch(() => { });
            }
            if (customId === 'nav_panel_ayar') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'nav_panel_log') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildLogDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'nav_panel_ticket') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildTicketDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'nav_panel_info') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildInfoDashboard(interaction.guild, db[guildId])).catch(() => { });
            }
            if (customId === 'nav_panel_ekonomi') {
                if (!isAdmin) return interaction.reply({ content: 'Bu kontrol panelini sadece Sunucu Yöneticileri yönetebilir.', ephemeral: true }).catch(() => { });
                return interaction.update(buildEkonomiDashboard(db[guildId])).catch(() => { });
            }

            // --- HIZLI AÇ/KAPAT TOGGLE BUTONLARI ---
            if (customId === 'toggle_xp_system') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].xpEnabled = db[guildId].xpEnabled === false ? true : false;
                saveDB(db);
                return interaction.update(buildEkonomiDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'toggle_games_system') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].gamesEnabled = db[guildId].gamesEnabled === false ? true : false;
                saveDB(db);
                return interaction.update(buildEkonomiDashboard(db[guildId])).catch(() => { });
            }

            // --- PROFİL VE MARKET BUTONLARI ---
            if (customId === 'btn_market_my_profile') {
                ensureGuildDB(db, guildId);
                return interaction.reply(buildUserProfileCard(interaction.user, interaction.guild, db[guildId])).catch(() => { });
            }

            if (customId === 'btn_open_market_view') {
                ensureGuildDB(db, guildId);
                return interaction.reply(buildMarketView(interaction.guild, db[guildId], interaction.user)).catch(() => { });
            }

            if (customId.startsWith('btn_profile_refresh_')) {
                ensureGuildDB(db, guildId);
                const targetUid = customId.replace('btn_profile_refresh_', '');
                let targetUser = interaction.user;
                if (targetUid !== interaction.user.id) {
                    targetUser = client.users.cache.get(targetUid) || interaction.user;
                }
                return interaction.update(buildUserProfileCard(targetUser, interaction.guild, db[guildId])).catch(() => { });
            }

            if (customId === 'btn_profile_how_it_works') {
                const infoEmbed = new EmbedBuilder()
                    .setTitle('ℹ️ Papel, XP ve Süreli Roller Nasıl Çalışır?')
                    .setColor(0x2b2d31)
                    .setDescription(
                        `**⚡ Deneyim (XP) ve Seviyeler:**\n` +
                        `• Sohbet kanallarında mesaj yazarak mesaj başına **5-12 XP** kazanırsınız (45 saniye bekleme süresi).\n` +
                        `• Ses kanallarında her 1.5 dakika için **10-20 XP** kazanırsınız (XP sonrası 30 sn soğuma süresi). Kamera veya yayın açtığınızda **1.5x bonus** verilir!\n` +
                        `• Toplam 7 kademeli seviye bulunur (Çaylak'tan Hükümdar'a kadar). Seviye atladığınızda yöneticinin belirlediği ödül rolleri otomatik verilir.\n\n` +
                        `**💵 Papel (Para) ve Market:**\n` +
                        `• Her **100 mesajda 1 Papel** kazanırsınız *(%2 şansla 2 Papel şanslı damla)*.\n` +
                        `• Ses odasında her **10 dakikada 1 Papel** kazanırsınız.\n` +
                        `• Günde 1 defa \`/gunluk\` yazarak **1 Papel** maaş alabilirsiniz.\n` +
                        `• Papellerinizi \`/market\` üzerinden roller satın almak için kullanabilirsiniz.\n\n` +
                        `**⏳ Süreli Roller:**\n` +
                        `• Markette süresi belirtilen roller (örn: \`<2 hafta>\` veya \`<aylık>\`) satın alındığında hemen başlar.\n` +
                        `• Süre bittiğinde rolünüz bot tarafından otomatik olarak kaldırılır. Kalan sürenizi profil kartınızdan anlık takip edebilirsiniz.`
                    )
                    .setFooter({ text: 'Memur Hüsnü Ekonomi Sistemi' })
                    .setTimestamp();
                return interaction.reply({ embeds: [infoEmbed], ephemeral: true }).catch(() => { });
            }
            if (customId === 'btn_toggle_user_xp') {
                ensureGuildDB(db, guildId);
                if (!db[guildId].users[interaction.user.id]) {
                    db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
                }
                const uData = db[guildId].users[interaction.user.id];
                const isCurrentlyDisabled = Boolean(uData.xpDisabled);

                if (!isCurrentlyDisabled) {
                    // Kullanıcı seviye sisteminden çıkıyor
                    uData.xpDisabled = true;
                    // Seviye ödül rollerini kullanıcıdan geri al
                    const levelRoleIds = Object.values(db[guildId].levelRoles || {});
                    for (const rId of levelRoleIds) {
                        if (rId && interaction.member.roles.cache.has(rId)) {
                            await interaction.member.roles.remove(rId).catch(() => { });
                        }
                    }
                    saveDB(db);
                    return interaction.update(buildUserProfileCard(interaction.user, interaction.guild, db[guildId])).catch(() => { });
                } else {
                    // Kullanıcı seviye sistemine geri katılıyor
                    uData.xpDisabled = false;
                    // Mevcut seviyesine karşılık gelen seviye rolünü tekrar ver
                    const curLevel = calculateLevel(uData.xp || 0);
                    const targetRoleId = db[guildId].levelRoles?.[String(curLevel)];
                    if (targetRoleId && !interaction.member.roles.cache.has(targetRoleId)) {
                        await interaction.member.roles.add(targetRoleId).catch(() => { });
                    }
                    saveDB(db);
                    return interaction.update(buildUserProfileCard(interaction.user, interaction.guild, db[guildId])).catch(() => { });
                }
            }

            if (customId === 'btn_quick_toggle_link') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].linkEngel = !db[guildId].linkEngel;
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'btn_quick_toggle_kufur') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].kufurEngel = !db[guildId].kufurEngel;
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'btn_quick_toggle_caps') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].capsEngel = db[guildId].capsEngel === false ? true : false;
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'btn_quick_toggle_antibot') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].antiBot = db[guildId].antiBot === false ? true : false;
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }
            if (customId === 'btn_quick_toggle_oto') {
                if (!isAdmin) return interaction.reply({ content: 'Bu ayarı sadece Sunucu Yöneticileri değiştirebilir.', ephemeral: true }).catch(() => { });
                db[guildId].otoCevap = db[guildId].otoCevap === false ? true : false;
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId])).catch(() => { });
            }

            // --- GEÇİCİ ODA (TEMP VC) BUTONLARI ---
            if (customId.startsWith('vc_')) {
                const channel = interaction.channel;
                const roomData = db[guildId].tempRooms[channel.id];
                if (!roomData) return interaction.reply({ content: 'Bu ses odasına ait kayıt bulunamadı.', ephemeral: true });

                if (customId === 'vc_claim') {
                    const currentOwner = channel.members.get(roomData.ownerId);
                    if (currentOwner) {
                        return interaction.reply({ content: `Oda sahibi (<@${roomData.ownerId}>) hâlâ odada olduğu için sahipliği devralamazsınız.`, ephemeral: true });
                    }
                    if (!channel.members.has(interaction.user.id)) {
                        return interaction.reply({ content: 'Sahipliği devralmak için ses kanalında olmalısınız.', ephemeral: true });
                    }

                    roomData.ownerId = interaction.user.id;
                    saveDB(db);

                    await channel.permissionOverwrites.edit(interaction.user.id, {
                        ManageChannels: true, MoveMembers: true, Connect: true, ViewChannel: true, SendMessages: true
                    }).catch(() => { });

                    return interaction.update({
                        content: `Odanın yeni sahibi <@${interaction.user.id}> oldu.`,
                        embeds: [buildTempVoiceEmbed(roomData)],
                        components: buildTempVoiceComponents(roomData, false)
                    });
                }

                if (interaction.user.id !== roomData.ownerId && !isAdmin) {
                    return interaction.reply({ content: `Bu işlemi sadece oda sahibi (<@${roomData.ownerId}>) yapabilir.`, ephemeral: true });
                }

                if (customId === 'vc_rename') {
                    const modal = new ModalBuilder().setCustomId('modal_vc_rename').setTitle('Oda İsmini Değiştir');
                    const input = new TextInputBuilder().setCustomId('name_val').setLabel('Yeni Oda İsmi').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }

                if (customId === 'vc_limit') {
                    const modal = new ModalBuilder().setCustomId('modal_vc_limit').setTitle('Kişi Sınırı Ayarla');
                    const input = new TextInputBuilder().setCustomId('limit_val').setLabel('Kişi Sınırı (0 = Sınırsız, Maks: 99)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    return interaction.showModal(modal);
                }

                if (customId === 'vc_trust') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_trust').setPlaceholder('Odaya giriş/yazma izni verilecek üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'İzinli (Trust) listesine eklenecek kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_untrust') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_untrust').setPlaceholder('Özel izni kaldırılacak üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Özel izni (Trust) kaldırılacak kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_block') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_block').setPlaceholder('Odadan engellenecek (Block) üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Odadan engellenecek (Block) kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_unblock') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_unblock').setPlaceholder('Engeli kaldırılacak üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Odaya giriş engeli (Block) kaldırılacak kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_kick') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_kick').setPlaceholder('Odadan atılacak üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Ses kanalından atılacak (Kick) kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_transfer') {
                    const menu = new UserSelectMenuBuilder().setCustomId('select_vc_transfer').setPlaceholder('Oda sahipliğinin devredileceği üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Oda sahipliğini devretmek istediğiniz kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
                }

                if (customId === 'vc_delete') {
                    delete db[guildId].tempRooms[channel.id];
                    saveDB(db);
                    await interaction.reply({ content: 'Oda siliniyor...', ephemeral: true });
                    await channel.delete().catch(() => { });
                    return;
                }
            }

            // --- TICKET (DESTEK) BUTONLARI ---
            if (customId.startsWith('ticket_')) {
                // Kullanıcı "Talep Oluştur" butonuna bastığında Ön Form (Modal) açılır
                if (customId.startsWith('ticket_create_')) {
                    const panelKey = customId.replace('ticket_create_', '');

                    const existingTicket = Object.values(db[guildId].tickets).find(t => t.ownerId === interaction.user.id && t.panelKey === panelKey);
                    if (existingTicket && interaction.guild.channels.cache.has(existingTicket.channelId)) {
                        return interaction.reply({ content: `Bu birimde zaten açık bir talebiniz bulunuyor: <#${existingTicket.channelId}>`, ephemeral: true });
                    }

                    const modal = new ModalBuilder()
                        .setCustomId(`modal_ticket_open_${panelKey}`)
                        .setTitle('Destek ve Başvuru Formu');

                    const subjectInput = new TextInputBuilder()
                        .setCustomId('t_user_konu')
                        .setLabel('Ne için talep açıyorsunuz? (Konu Başlığı)')
                        .setPlaceholder('Örn: Yetkili Başvurusu / Destek Talebi / Şikayet / Diğer')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(100)
                        .setRequired(true);

                    const detailInput = new TextInputBuilder()
                        .setCustomId('t_user_detay')
                        .setLabel('Talebinizi detaylıca açıklayın')
                        .setPlaceholder('Yetkililerin size hızlıca yardımcı olabilmesi için tüm detayları buraya yazın...')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(1500)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(subjectInput),
                        new ActionRowBuilder().addComponents(detailInput)
                    );

                    return interaction.showModal(modal);
                }

                // Kanal içi yönetim butonları (Sadece Yetkili Rol ve Yöneticiler)
                if (!isAdmin && !isYetkili) {
                    return interaction.reply({ content: 'Bu butonları sadece yetkililer kullanabilir.', ephemeral: true });
                }

                const ticketData = db[guildId].tickets[interaction.channel.id];
                if (!ticketData) return interaction.reply({ content: 'Bu kanal kayıtlı bir ticket kanalı değil.', ephemeral: true });

                // Rate Limit'e takılmayan güvenli "Talebi Üstlen" (Claim) sistemi
                if (customId === 'ticket_claim') {
                    if (ticketData.claimedBy === interaction.user.id) {
                        return interaction.reply({ content: 'Bu talebi zaten siz üstlendiniz.', ephemeral: true });
                    }
                    ticketData.claimedBy = interaction.user.id;
                    saveDB(db);

                    if (interaction.message && interaction.message.embeds.length > 0) {
                        const oldEmbed = interaction.message.embeds[0];
                        const newEmbed = EmbedBuilder.from(oldEmbed);
                        const fields = newEmbed.data.fields ? [...newEmbed.data.fields] : [];
                        const claimIdx = fields.findIndex(f => f.name === 'İlgilenen Yetkili');
                        if (claimIdx !== -1) {
                            fields[claimIdx].value = `<@${interaction.user.id}>`;
                        } else {
                            fields.push({ name: 'İlgilenen Yetkili', value: `<@${interaction.user.id}>`, inline: true });
                        }
                        newEmbed.setFields(fields);
                        await interaction.message.edit({ embeds: [newEmbed] }).catch(() => { });
                    }

                    return interaction.reply({ content: `Bu destek talebi <@${interaction.user.id}> tarafından üstlenildi. Yetkilimiz sizinle ilgilenecektir.` });
                }

                if (customId === 'ticket_lock') {
                    ticketData.locked = !ticketData.locked;
                    saveDB(db);
                    await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, { SendMessages: !ticketData.locked }).catch(() => { });
                    return interaction.reply({ content: ticketData.locked ? 'Kanal kilitlendi (Talep sahibi mesaj yazamaz).' : 'Kanal kilidi açıldı.' });
                }

                if (customId === 'ticket_add') {
                    const selectMenu = new UserSelectMenuBuilder().setCustomId('select_ticket_add').setPlaceholder('Kanala eklenecek üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Kanala eklenecek kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(selectMenu)], ephemeral: true });
                }

                if (customId === 'ticket_remove') {
                    const selectMenu = new UserSelectMenuBuilder().setCustomId('select_ticket_remove').setPlaceholder('Kanaldan çıkarılacak üyeyi seçin').setMaxValues(1);
                    return interaction.reply({ content: 'Kanaldan çıkarılacak kullanıcıyı seçin:', components: [new ActionRowBuilder().addComponents(selectMenu)], ephemeral: true });
                }

                if (customId === 'ticket_close') {
                    await interaction.reply({ content: 'Kanal kapatılıyor ve tüm konuşma geçmişi `.txt` olarak arşivleniyor...' });

                    const sortedMessages = await fetchAllMessages(interaction.channel, 1000);

                    let txtLines = [
                        `====================================================`,
                        `TICKET KONUŞMA DÖKÜMÜ (ARŞİV)`,
                        `Kanal Adı       : ${interaction.channel.name}`,
                        `Talep Sahibi ID : ${ticketData.ownerId}`,
                        `Talep Konusu    : ${ticketData.subject || 'Belirtilmedi'}`,
                        `Talep Açıklaması: ${ticketData.details || 'Belirtilmedi'}`,
                        `Üstlenen Yetkili: ${ticketData.claimedBy ? ticketData.claimedBy : 'Üstlenilmedi'}`,
                        `Kapatan Yetkili : ${interaction.user.tag} (${interaction.user.id})`,
                        `Kapanış Tarihi  : ${new Date().toLocaleString('tr-TR')}`,
                        `Toplam Mesaj    : ${sortedMessages.length}`,
                        `====================================================\n`
                    ];

                    for (const m of sortedMessages) {
                        const timeStr = new Date(m.createdTimestamp).toLocaleString('tr-TR');
                        const content = m.content || (m.embeds.length > 0 ? '[Sistem Paneli / Başvuru Kartı]' : '[Görsel / Dosya]');
                        const attachmentUrls = m.attachments.size > 0 ? ` [Ekler: ${m.attachments.map(a => a.url).join(', ')}]` : '';
                        txtLines.push(`[${timeStr}] ${m.author.tag}: ${content}${attachmentUrls}`);
                    }

                    const txtBuffer = Buffer.from(txtLines.join('\n'), 'utf-8');
                    const attachment = new AttachmentBuilder(txtBuffer, { name: `${interaction.channel.name}-arsiv.txt` });

                    sendLog(interaction.guild, 'logMesaj', {
                        title: 'Ticket Kapatıldı ve Arşivlendi',
                        desc: `**Kanal:** \`${interaction.channel.name}\`\n**Talep Sahibi:** <@${ticketData.ownerId}>\n**Konu:** ${ticketData.subject || 'Belirtilmedi'}\n**Üstlenen Yetkili:** ${ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'Yok'}\n**Kapatan Yetkili:** <@${interaction.user.id}>\n**Arşivlenen Mesaj:** ${sortedMessages.length} adet`,
                        color: 0xed4245
                    }, [attachment]);

                    delete db[guildId].tickets[interaction.channel.id];
                    saveDB(db);

                    setTimeout(() => { interaction.channel.delete().catch(() => { }); }, 3000);
                }
            }
        }

        // ------------------------------------------------------------------------
        // 5. MODAL (FORM) ETKİLEŞİMLERİ (TICKET KURULUMU, TICKET AÇMA, YAYINCI EKLEME & TEMP VC)
        // ------------------------------------------------------------------------
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_set_bot_status') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                await interaction.deferReply({ ephemeral: true }).catch(() => { });
                const statusVal = interaction.fields.getTextInputValue('status_val')?.trim() || '';

                if (statusVal.length > 0) {
                    client.user.setPresence({
                        activities: [{ name: statusVal, type: ActivityType.Playing }],
                        status: 'online'
                    });
                    db.botStatus = statusVal;
                    saveDB(db);
                    return interaction.editReply({ content: `✅ Botun durumu başarıyla **"${statusVal}"** *(Oynuyor)* olarak güncellendi.` });
                } else {
                    client.user.setPresence({ activities: [] });
                    delete db.botStatus;
                    saveDB(db);
                    return interaction.editReply({ content: '✅ Botun durum mesajı temizlendi/sıfırlandı.' });
                }
            }

            if (interaction.customId.startsWith('modal_market_price_')) {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const roleId = interaction.customId.replace('modal_market_price_', '');
                const priceStr = interaction.fields.getTextInputValue('market_price_val')?.trim();
                const durationStr = interaction.fields.getTextInputValue('market_duration_val')?.trim() || '0';
                const price = parseInt(priceStr, 10);
                const durationDays = parseInt(durationStr, 10) || 0;

                if (isNaN(price) || price < 1) {
                    return interaction.reply({ content: '❌ Geçersiz fiyat! Lütfen en az 1 veya daha yüksek bir tam sayı girin.', ephemeral: true });
                }

                if (!Array.isArray(db[guildId].marketRoles)) db[guildId].marketRoles = [];
                const existingIdx = db[guildId].marketRoles.findIndex(r => r.roleId === roleId);
                if (existingIdx !== -1) {
                    db[guildId].marketRoles[existingIdx].price = price;
                    db[guildId].marketRoles[existingIdx].durationDays = durationDays;
                } else {
                    db[guildId].marketRoles.push({ roleId, price, durationDays });
                }
                saveDB(db);

                const durLabel = formatDurationLabel(durationDays);
                return interaction.reply({ content: `✅ <@&${roleId}> rolü **${price.toLocaleString('tr-TR')} Papel** fiyatıyla ve **${durLabel}** süresiyle markete başarıyla eklendi!`, ephemeral: true });
            }

            if (interaction.customId === 'modal_add_custom_kufur') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                const newWord = interaction.fields.getTextInputValue('kufur_word').trim().toLowerCase();
                if (!newWord || newWord.length < 2) {
                    return interaction.reply({ content: 'Lütfen en az 2 karakterden oluşan geçerli bir kelime girin.', ephemeral: true });
                }
                if (!db[guildId].customKufurler) db[guildId].customKufurler = [];
                if (db[guildId].customKufurler.includes(newWord)) {
                    return interaction.reply({ content: `**${newWord}** zaten sunucunun özel yasaklı kelimeler listesinde ekli.`, ephemeral: true });
                }
                db[guildId].customKufurler.push(newWord);
                saveDB(db);
                return interaction.reply({ content: `✅ **"${newWord}"** kelimesi sunucunun özel yasaklı kelimeler listesine eklendi.`, ephemeral: true });
            }

            if (interaction.customId === 'modal_add_stream_tracker') {
                const rawUrl = interaction.fields.getTextInputValue('tracker_url').trim();
                await interaction.deferReply({ ephemeral: true });

                const resolved = await resolveChannelLink(rawUrl);
                if (!resolved) {
                    return interaction.editReply({ content: '❌ Geçersiz kanal bağlantısı! Lütfen geçerli bir YouTube (`youtube.com/@kanal`), Kick (`kick.com/kanal`) veya Twitch (`twitch.tv/kanal`) linki girin.' });
                }

                if (!db[guildId].trackers) db[guildId].trackers = [];
                const exists = db[guildId].trackers.some(t => t.url.toLowerCase() === resolved.url.toLowerCase());
                if (exists) {
                    return interaction.editReply({ content: `⚠️ **${resolved.name}** kanalı zaten takip listesinde ekli!` });
                }

                if (resolved.platform === 'youtube') {
                    const ytData = await checkYouTube(resolved.channelId);
                    resolved.lastSeenId = ytData?.id || null;
                } else {
                    resolved.lastSeenId = null;
                }

                db[guildId].trackers.push(resolved);
                saveDB(db);

                addLiveLog(`[YAYINCI EKLENDİ] ${resolved.name} (${resolved.platform}) - ${interaction.guild.name}`);

                // Yeni yayıncı eklenir eklenmez hemen kontrol et ve canlıysa anında duyur
                setTimeout(() => {
                    checkAllStreamTrackers().catch(e => addLiveLog(`[YAYIN KONTROL HATA]: ${e.message}`));
                }, 1000);

                return interaction.editReply({ content: `✅ **${resolved.name}** (${resolved.platform.toUpperCase()}) başarıyla takip listesine eklendi!\nYayın açıksa birkaç saniye içinde duyuru kanalına gönderilecek.` });
            }

            // Yöneticinin Ticket Paneli Kurma Formu
            if (interaction.customId.startsWith('modal_ticket_kur_')) {
                const parts = interaction.customId.replace('modal_ticket_kur_', '').split('_');
                const chId = parts[0];
                const catId = parts[1] || 'none';

                let targetChannel = interaction.guild.channels.cache.get(chId);
                if (!targetChannel) {
                    targetChannel = await interaction.guild.channels.fetch(chId).catch(() => null);
                }
                if (!targetChannel) return interaction.reply({ content: 'Hedef kanal bulunamadı.', ephemeral: true });

                await interaction.deferReply({ ephemeral: true });

                const baslik = interaction.fields.getTextInputValue('t_baslik');
                const aciklama = interaction.fields.getTextInputValue('t_aciklama');
                const butonYazi = interaction.fields.getTextInputValue('t_buton');
                const icMesaj = interaction.fields.getTextInputValue('t_ic_mesaj');

                const panelId = Date.now().toString(36);
                db[guildId].ticketPanels[panelId] = {
                    catId: catId,
                    title: baslik,
                    welcomeMsg: icMesaj
                };
                delete db[guildId].tempTicketCat;
                saveDB(db);

                const embed = new EmbedBuilder()
                    .setTitle(baslik)
                    .setDescription(aciklama)
                    .setColor(0x2b2d31)
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_create_${panelId}`)
                        .setLabel(butonYazi)
                        .setStyle(ButtonStyle.Primary)
                );

                await targetChannel.send({ embeds: [embed], components: [row] });
                return interaction.editReply({ content: `Ticket paneli <#${targetChannel.id}> kanalına başarıyla kuruldu.` });
            }

            // Kullanıcının Ön Formu Doldurup Ticket Açması
            if (interaction.customId.startsWith('modal_ticket_open_')) {
                const panelKey = interaction.customId.replace('modal_ticket_open_', '');
                const panelConfig = db[guildId].ticketPanels ? db[guildId].ticketPanels[panelKey] : null;

                const existingTicket = Object.values(db[guildId].tickets).find(t => t.ownerId === interaction.user.id && t.panelKey === panelKey);
                if (existingTicket && interaction.guild.channels.cache.has(existingTicket.channelId)) {
                    return interaction.reply({ content: `Bu birimde zaten açık bir talebiniz bulunuyor: <#${existingTicket.channelId}>`, ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });

                const konu = interaction.fields.getTextInputValue('t_user_konu').trim();
                const detay = interaction.fields.getTextInputValue('t_user_detay').trim();

                let customCatId = null;
                let welcomeMsg = 'Talebiniz oluşturuldu. Yetkililer en kısa sürede sizinle ilgilenecektir.';
                let panelTitle = 'Destek ve Başvuru Kanalı';

                if (panelConfig) {
                    customCatId = panelConfig.catId !== 'none' ? panelConfig.catId : null;
                    if (panelConfig.welcomeMsg) welcomeMsg = panelConfig.welcomeMsg;
                    if (panelConfig.title) panelTitle = panelConfig.title;
                }

                const overwrites = [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
                ];
                if (db[guildId].yetkiliRol) {
                    overwrites.push({ id: db[guildId].yetkiliRol, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ReadMessageHistory] });
                }

                try {
                    const ticketChannel = await interaction.guild.channels.create({
                        name: `talep-${interaction.user.username}`,
                        type: ChannelType.GuildText,
                        parent: customCatId,
                        permissionOverwrites: overwrites
                    });

                    db[guildId].tickets[ticketChannel.id] = {
                        ownerId: interaction.user.id,
                        channelId: ticketChannel.id,
                        panelKey: panelKey,
                        subject: konu,
                        details: detay,
                        claimedBy: null,
                        locked: false,
                        createdAt: Date.now()
                    };
                    saveDB(db);

                    const embed = new EmbedBuilder()
                        .setTitle(panelTitle)
                        .setDescription(`Merhaba <@${interaction.user.id}>,\n${welcomeMsg}`)
                        .addFields(
                            { name: 'Talep Konusu / Türü', value: `\`${konu}\``, inline: false },
                            { name: 'Kullanıcının Talebi / Açıklaması', value: detay, inline: false },
                            { name: 'İlgilenen Yetkili', value: 'Henüz üstlenilmedi', inline: true }
                        )
                        .setColor(0x2b2d31)
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Talebi Üstlen').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('ticket_lock').setLabel('Kilitle / Aç').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('ticket_add').setLabel('Üye Ekle').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_remove').setLabel('Üye Çıkar').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_close').setLabel('Kapat ve Arşivle').setStyle(ButtonStyle.Danger)
                    );

                    const mentionText = db[guildId].yetkiliRol ? `<@${interaction.user.id}> | <@&${db[guildId].yetkiliRol}>` : `<@${interaction.user.id}>`;
                    await ticketChannel.send({ content: mentionText, embeds: [embed], components: [row] });

                    sendLog(interaction.guild, 'logSunucu', {
                        title: 'Yeni Ticket Açıldı',
                        desc: `**Açan Kullanıcı:** <@${interaction.user.id}>\n**Kanal:** <#${ticketChannel.id}>\n**Birim:** ${panelTitle}\n**Konu:** ${konu}`,
                        color: 0x57f287
                    });
                    return interaction.editReply({ content: `Talebiniz başarıyla oluşturuldu: <#${ticketChannel.id}>` });
                } catch (e) {
                    return interaction.editReply({ content: 'Kanal oluşturulurken bir yetki veya kategori hatası oluştu.' });
                }
            }

            if (interaction.customId === 'modal_vc_limit') {
                const val = parseInt(interaction.fields.getTextInputValue('limit_val'));
                if (isNaN(val) || val < 0 || val > 99) return interaction.reply({ content: 'Lütfen 0 ile 99 arasında geçerli bir sayı girin.', ephemeral: true });
                await interaction.channel.setUserLimit(val).catch(() => { });
                return interaction.reply({ content: `Oda kişi sınırı **${val === 0 ? 'Sınırsız' : val}** olarak ayarlandı.`, ephemeral: true });
            }

            // Geçici Oda İsim Değiştirme (Discord Rate Limit Korumalı - 5 Dakika)
            if (interaction.customId === 'modal_vc_rename') {
                const now = Date.now();
                const lastRename = renameCooldownMap.get(interaction.channel.id) || 0;
                if (now - lastRename < 300000) {
                    const kalanSn = Math.ceil((300000 - (now - lastRename)) / 1000);
                    return interaction.reply({ content: `Discord hız sınırları (Rate Limit) nedeniyle oda ismini tekrar değiştirmek için **${kalanSn} saniye** beklemelisiniz.`, ephemeral: true });
                }
                const newName = interaction.fields.getTextInputValue('name_val').trim();
                renameCooldownMap.set(interaction.channel.id, now);
                await interaction.channel.setName(newName).catch(() => { });
                return interaction.reply({ content: `Oda ismi **${newName}** olarak güncellendi.`, ephemeral: true });
            }
        }

        // ------------------------------------------------------------------------
        // 6. KULLANICI SEÇİM MENÜSÜ (USER SELECT MENU) ETKİLEŞİMLERİ
        // ------------------------------------------------------------------------
        if (interaction.isUserSelectMenu()) {
            const targetId = interaction.values[0];

            if (interaction.customId === 'select_bot_whitelist') {
                if (!isAdmin) return interaction.reply({ content: 'Yetkiniz yok.', ephemeral: true });
                if (!Array.isArray(db[guildId].botWhitelist)) db[guildId].botWhitelist = [];
                const idx = db[guildId].botWhitelist.indexOf(targetId);
                if (idx !== -1) {
                    db[guildId].botWhitelist.splice(idx, 1);
                } else {
                    db[guildId].botWhitelist.push(targetId);
                }
                saveDB(db);
                return interaction.update(buildAyarDashboard(db[guildId]));
            }

            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) return interaction.update({ content: 'Kullanıcı bulunamadı.', components: [] });

            const channel = interaction.channel;
            const roomData = db[guildId].tempRooms[channel.id];

            if (interaction.customId === 'select_vc_trust') {
                await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, SendMessages: true }).catch(() => { });
                return interaction.update({ content: `<@${targetId}> izinli (Trust) listesine eklendi. Oda kilitli veya gizli olsa bile girebilir.`, components: [] });
            }

            if (interaction.customId === 'select_vc_untrust') {
                await channel.permissionOverwrites.delete(targetId).catch(() => { });
                return interaction.update({ content: `<@${targetId}> kullanıcısının özel oda izinleri kaldırıldı.`, components: [] });
            }

            if (interaction.customId === 'select_vc_block') {
                if (targetId === interaction.user.id) return interaction.update({ content: 'Kendinizi engelleyemezsiniz.', components: [] });
                if (targetMember.voice.channelId === channel.id) await targetMember.voice.disconnect().catch(() => { });
                await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false, SendMessages: false }).catch(() => { });
                return interaction.update({ content: `<@${targetId}> odadan engellendi (Block) ve bağlantısı kesildi.`, components: [] });
            }

            if (interaction.customId === 'select_vc_unblock') {
                await channel.permissionOverwrites.delete(targetId).catch(() => { });
                return interaction.update({ content: `<@${targetId}> kullanıcısının oda engeli kaldırıldı.`, components: [] });
            }

            if (interaction.customId === 'select_vc_kick') {
                if (targetId === interaction.user.id) return interaction.update({ content: 'Kendinizi odadan atamazsınız.', components: [] });
                if (targetMember.voice.channelId !== channel.id) return interaction.update({ content: 'Bu kullanıcı şu an ses odasında değil.', components: [] });
                await targetMember.voice.disconnect().catch(() => { });
                return interaction.update({ content: `<@${targetId}> ses odasından çıkarıldı.`, components: [] });
            }

            if (interaction.customId === 'select_vc_transfer') {
                if (targetId === interaction.user.id || targetMember.user.bot) return interaction.update({ content: 'Geçersiz kullanıcı seçimi.', components: [] });
                if (!roomData) return interaction.update({ content: 'Oda verisi bulunamadı.', components: [] });

                roomData.ownerId = targetId;
                saveDB(db);

                await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, Connect: true, ViewChannel: true, SendMessages: true }).catch(() => { });

                if (roomData.panelMsgId) {
                    const panelMsg = await channel.messages.fetch(roomData.panelMsgId).catch(() => null);
                    if (panelMsg) {
                        await panelMsg.edit({
                            content: `Oda sahipliği <@${targetId}> kullanıcısına devredildi.`,
                            embeds: [buildTempVoiceEmbed(roomData)],
                            components: buildTempVoiceComponents(roomData, false)
                        }).catch(() => { });
                    }
                }
                return interaction.update({ content: `Oda sahipliği başarıyla <@${targetId}> kullanıcısına devredildi.`, components: [] });
            }

            if (interaction.customId === 'select_ticket_add') {
                await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, SendMessages: true, AttachFiles: true, ReadMessageHistory: true }).catch(() => { });
                await interaction.update({ content: `<@${targetId}> kanala eklendi.`, components: [] });
                return channel.send(`<@${targetId}>, <@${interaction.user.id}> tarafından bu talebe eklendi.`);
            }

            if (interaction.customId === 'select_ticket_remove') {
                await channel.permissionOverwrites.delete(targetId).catch(() => { });
                await interaction.update({ content: `<@${targetId}> kanaldan çıkarıldı.`, components: [] });
                return channel.send(`<@${targetId}>, <@${interaction.user.id}> tarafından bu talepten çıkarıldı.`);
            }
        }
    } catch (err) {
        addLiveLog(`❌ Etkileşim Hatası: ${err.message}`);
        console.error('Etkileşim Hatası:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: 'İşlem sırasında beklenmeyen bir hata oluştu.', ephemeral: true }).catch(() => { });
        }
    }
});

// ============================================================================
// MESAJ DENETİMİ, KICK DUYURU, OTO-CEVAP, CAPS LOCK VE KADEMELİ SPAM KORUMASI
// ============================================================================
client.on('messageCreate', async message => {
    if (!message.guild) return;
    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    if (message.author.bot || !message.member) return;

    // ========================================================================
    // XP VE PAPEL SİSTEMİ (MESAJ BAŞI XP & HER 50 MESAJDA 1 PAPEL)
    // ========================================================================
    const nowTime = Date.now();
    ensureGuildDB(db, guildId);
    if (db[guildId].xpEnabled !== false) {
        if (!db[guildId].users[message.author.id]) {
            db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
        }
        const uDataMsg = db[guildId].users[message.author.id];
        if (uDataMsg.xp === undefined) uDataMsg.xp = 0;
        if (uDataMsg.level === undefined) uDataMsg.level = 0;
        if (uDataMsg.papel === undefined) uDataMsg.papel = 0;
        if (uDataMsg.msgCount === undefined) uDataMsg.msgCount = 0;
        if (uDataMsg.lastMsgTime === undefined) uDataMsg.lastMsgTime = 0;

        // Mesaj Cooldown (45 saniye)
        if (nowTime - uDataMsg.lastMsgTime >= 45000) {
            uDataMsg.lastMsgTime = nowTime;
            uDataMsg.msgCount += 1;

            // Seviye sisteminden çıkmamışsa XP ve Seviye kazanır
            if (!uDataMsg.xpDisabled) {
                // Mesaj başı 5-12 XP
                const earnedXp = Math.floor(Math.random() * 8) + 5;
                uDataMsg.xp += earnedXp;

                // Seviye Atlama Kontrolü (7 Seviye)
                const newLvl = calculateLevel(uDataMsg.xp);
                if (newLvl > uDataMsg.level) {
                    uDataMsg.level = newLvl;
                    const lvlObj = XP_LEVELS.find(l => l.level === newLvl);
                    const roleId = db[guildId]?.levelRoles?.[String(newLvl)];
                    let roleNote = '';
                    if (roleId) {
                        message.member.roles.add(roleId).catch(() => { });
                        roleNote = ` ve <@&${roleId}> rolünü kazandın`;
                    }
                    message.channel.send(`🎉 Tebrikler <@${message.author.id}>! **${lvlObj ? lvlObj.title : `Seviye ${newLvl}`}** mertebesine yükseldin${roleNote}! 🎖️`).then(m => setTimeout(() => m.delete().catch(() => { }), 8000)).catch(() => { });
                }
            }

            // Her 100 mesajda 1 Papel kazanımı
            if (uDataMsg.msgCount % 100 === 0) {
                let papelGain = 1;
                // Şansa bağlı papel artışı (%2 şansla 2 Papel)
                const luckyRoll = Math.random();
                if (luckyRoll < 0.02) papelGain = 2;

                uDataMsg.papel += papelGain;
                const extraNote = papelGain > 1 ? ` *(Şanslı Damla: +${papelGain} Papel!)*` : '';
                message.channel.send(`💵 Tebrikler <@${message.author.id}>, 100 mesajı tamamlayarak **+${papelGain} Papel** kazandınız!${extraNote}`).then(m => setTimeout(() => m.delete().catch(() => { }), 6000)).catch(() => { });
            }

            saveDB(db);
        }
    }

    const isMuaf = Boolean(db[guildId].muafRol && message.member.roles.cache.has(db[guildId].muafRol));
    const isYetkili = Boolean(db[guildId].yetkiliRol && message.member.roles.cache.has(db[guildId].yetkiliRol));
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isProtected = Boolean(isAdmin || isYetkili || isMuaf);

    if (db[guildId].kufurEngel && !isProtected) {
        const customWords = db[guildId].customKufurler || [];
        if (kufurTespitEt(message.content, customWords)) {
            await handleProfanity(message, db, guildId);
            return;
        }
    }

    // Oto-Cevap
    if (db[guildId].otoCevap !== false) {
        const lowerContent = message.content.toLocaleLowerCase('tr-TR');
        for (const ayar of otoCevaplar) {
            let eslesti = false;
            if (ayar.tetikleyiciler.includes("selam") && lowerContent.includes("aleyküm")) continue;
            for (const tetikleyici of ayar.tetikleyiciler) {
                if (ayar.tamKelime) {
                    const regex = new RegExp(`(?:^|\\s|[.,!?:])${tetikleyici}(?:$|\\s|[.,!?:])`, 'i');
                    if (regex.test(lowerContent)) { eslesti = true; break; }
                } else {
                    if (lowerContent.includes(tetikleyici)) { eslesti = true; break; }
                }
            }
            if (eslesti) {
                const rastgeleCevap = ayar.cevaplar[Math.floor(Math.random() * ayar.cevaplar.length)];
                if (ayar.etiketle) await message.reply(rastgeleCevap).catch(() => { });
                else await message.channel.send(rastgeleCevap).catch(() => { });
                break;
            }
        }
    }

    if (isProtected) return;

    // Link / Reklam Koruması (Akıllı Whitelist, Sunucu Davet İstisnası ve 2. İhlalde Hapis)
    if (db[guildId].linkEngel) {
        const cachedInv = invitesCache.get(guildId);
        const currentGuildInvites = cachedInv ? Array.from(cachedInv.keys()) : [];
        if (message.guild.vanityURLCode) currentGuildInvites.push(message.guild.vanityURLCode);

        if (isForbiddenLink(message.content, currentGuildInvites)) {
            await handleLinkViolation(message, db, guildId);
            return;
        }
    }

    // Caps Lock Koruması (Linkler hariç tutulur ve panel ayarına bağlıdır)
    if (db[guildId].capsEngel !== false) {
        const textWithoutUrls = message.content.replace(/https?:\/\/[^\s]+/gi, '');
        const lettersOnly = textWithoutUrls.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "");
        if (lettersOnly.length > 5) {
            const upperCount = lettersOnly.replace(/[^A-ZĞÜŞİÖÇ]/g, "").length;
            if ((upperCount / lettersOnly.length) >= 0.75) {
                await message.delete().catch(() => { });
                message.channel.send(`${message.member}, lütfen tamamı büyük harf (Caps Lock) içeren mesajlar yazmayalım.`).then(m => setTimeout(() => m.delete().catch(() => { }), 4000));
                sendLog(message.guild, 'logCeza', { title: 'Büyük Harf (Caps Lock) Uyarısı', desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Mesaj:** ${message.content}`, color: 0xfee75c });
            }
        }
    }

    // Kademeli Spam Koruması (1. İhlal: 3 Dk Timeout, 2. İhlal: Hapis)
    const now = Date.now();
    if (!spamMap.has(message.author.id)) spamMap.set(message.author.id, []);
    const userMsgs = spamMap.get(message.author.id);
    userMsgs.push(now);
    const recentMsgs = userMsgs.filter(timestamp => now - timestamp < 3000);
    spamMap.set(message.author.id, recentMsgs);

    if (recentMsgs.length >= 4) {
        spamMap.delete(message.author.id);
        await message.channel.bulkDelete(4, true).catch(() => { });

        ensureGuildDB(db, guildId);
        if (!db[guildId].users[message.author.id]) {
            db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
        }
        let uData = db[guildId].users[message.author.id];
        uData.spamWarn = (uData.spamWarn || 0) + 1;
        saveDB(db);

        if (uData.spamWarn === 1) {
            if (message.member.manageable) {
                await message.member.timeout(3 * 60 * 1000, "Spam / Flood (1. İhlal)").catch(() => { });
            }
            message.channel.send(`<@${message.author.id}>, art arda hızlı mesaj (spam) gönderdiğiniz için **3 dakika** zaman aşımı (timeout) aldınız. Tekrarı halinde hapis cezası uygulanacaktır.`).then(m => setTimeout(() => m.delete().catch(() => { }), 8000));
            sendLog(message.guild, 'logCeza', {
                title: 'Otomatik Spam Müdahalesi (1. İhlal - Timeout)',
                desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**İşlem:** 3 Dakika Zaman Aşımı (Timeout)`,
                color: 0xfee75c
            });
        } else {
            uData.spamWarn = 0;
            saveDB(db);
            await applyJail(message.member, message.guild, "Spam / Flood Yapmak (Tekrarlanan İhlal)");
        }
    }
});

// ============================================================================
// ULTRA DETAYLI VE ZEKİ LOG SİSTEMİ (6 KATEGORİ EKSİKSİZ)
// ============================================================================

// 1. MESAJ SİLİNME (SİLİNEN MEDYA KURTARMALI & GHOST PING)
client.on('messageDelete', async message => {
    if (!message.guild) return;
    if (message.author && message.author.bot) return;

    const targetId = message.author ? message.author.id : null;
    const executor = await getAuditExecutor(message.guild, AuditLogEvent.MessageDelete, targetId);
    const silenBilgisi = executor ? `<@${executor.id}> (Yetkili)` : (message.author ? `<@${message.author.id}> (Kendisi)` : 'Bilinmiyor');
    const content = message.content ? message.content : "[Görsel veya Dosya İçeriği]";

    if (message.mentions) {
        const hasUsers = message.mentions.users.size > 0;
        const hasRoles = message.mentions.roles.size > 0;
        const hasEveryone = message.mentions.everyone;
        if (hasUsers || hasRoles || hasEveryone) {
            sendLog(message.guild, 'logMesaj', {
                title: 'Hayalet Etiket (Ghost Ping) Tespit Edildi',
                desc: `**Atan Kişi:** ${targetId ? `<@${targetId}>` : 'Bilinmiyor'}\n**Kanal:** <#${message.channel.id}>\n**Silinen Mesaj:**\n${content}`,
                color: 0xff0000
            });
        }
    }

    let recoveredFiles = [];
    let attachmentLinks = [];
    if (message.attachments && message.attachments.size > 0) {
        for (const att of message.attachments.values()) {
            attachmentLinks.push(att.url);
            if (att.size <= 8 * 1024 * 1024) {
                try {
                    const res = await fetch(att.url);
                    const arrayBuffer = await res.arrayBuffer();
                    recoveredFiles.push(new AttachmentBuilder(Buffer.from(arrayBuffer), { name: att.name || 'silinen-medya.png' }));
                } catch (e) { }
            }
        }
    }

    const ekBilgi = attachmentLinks.length > 0 ? `\n**Medya Linkleri:**\n${attachmentLinks.join('\n')}` : '';

    sendLog(message.guild, 'logMesaj', {
        title: 'Mesaj Silindi',
        desc: `**Mesaj Sahibi:** ${targetId ? `<@${targetId}>` : 'Bilinmiyor'}\n**Silen Kişi:** ${silenBilgisi}\n**Kanal:** <#${message.channel.id}>\n\n**İçerik:**\n${content}${ekBilgi}`,
        color: 0xed4245
    }, recoveredFiles);
});

// 2. MESAJ DÜZENLEME VE SABİTLEME (PIN)
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!oldMessage.guild) return;
    if (newMessage.author && newMessage.author.bot) return;

    if (!oldMessage.pinned && newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: 'Mesaj Sabitlendi (Pin)', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${newMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0x3498db });
    }
    if (oldMessage.pinned && !newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: 'Mesaj Sabitlemesi Kaldırıldı', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${newMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0xe67e22 });
    }

    if (oldMessage.content === newMessage.content) return;

    const db = getDB();
    const guildId = newMessage.guild.id;
    if (db[guildId] && newMessage.member) {
        const isMuaf = Boolean(db[guildId].muafRol && newMessage.member.roles.cache.has(db[guildId].muafRol));
        const isYetkili = Boolean(db[guildId].yetkiliRol && newMessage.member.roles.cache.has(db[guildId].yetkiliRol));
        const isAdmin = newMessage.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isProtected = Boolean(isAdmin || isYetkili || isMuaf);

        if (!isProtected) {
            const customWords = db[guildId].customKufurler || [];
            if (db[guildId].kufurEngel && kufurTespitEt(newMessage.content, customWords)) {
                await handleProfanity(newMessage, db, guildId);
                return;
            }
            if (db[guildId].linkEngel) {
                const cachedInv = invitesCache.get(guildId);
                const currentGuildInvites = cachedInv ? Array.from(cachedInv.keys()) : [];
                if (newMessage.guild.vanityURLCode) currentGuildInvites.push(newMessage.guild.vanityURLCode);

                if (isForbiddenLink(newMessage.content, currentGuildInvites)) {
                    await handleLinkViolation(newMessage, db, guildId);
                    return;
                }
            }
        }
    }

    const eskiIcerik = oldMessage.content ? oldMessage.content : '[Boş]';
    const yeniIcerik = newMessage.content ? newMessage.content : '[Boş]';

    sendLog(oldMessage.guild, 'logMesaj', {
        title: 'Mesaj Düzenlendi',
        desc: `**Yazan:** <@${newMessage.author.id}>\n**Kanal:** <#${oldMessage.channel.id}> ([Mesaja Git](${newMessage.url}))\n\n**Eski Hal:**\n${eskiIcerik}\n\n**Yeni Hal:**\n${yeniIcerik}`,
        color: 0xfee75c
    });
});

client.on('messageDeleteBulk', messages => {
    const firstMsg = messages.first();
    if (!firstMsg || !firstMsg.guild) return;
    sendLog(firstMsg.guild, 'logMesaj', {
        title: 'Toplu Mesaj Silindi',
        desc: `**Kanal:** <#${firstMsg.channel.id}>\n**Silinen Miktar:** ${messages.size} adet mesaj.`,
        color: 0xed4245
    });
});

client.on('messageReactionRemoveAll', (message) => {
    if (!message.guild) return;
    sendLog(message.guild, 'logMesaj', {
        title: 'Mesaj Tepkileri (Emojiler) Temizlendi',
        desc: `**Kanal:** <#${message.channel.id}>\n[Mesaja Git](${message.url})`,
        color: 0xe67e22
    });
});

// 3. GEÇİCİ ODA (COOLDOWN KORUMALI & KESİN PANEL GÖNDERİMLİ) VE SÜRE HESAPLAMALI SES LOGLARI
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild) return;
    const db = getDB();
    const guildId = newState.guild.id;
    ensureGuildDB(db, guildId);

    // CANLI RADYO OTOMATİK AYRILMA (Bot atılırsa veya kanalda kimse kalmazsa)
    if (radioPlayers.has(guildId)) {
        const radioData = radioPlayers.get(guildId);
        if (oldState.id === client.user?.id && !newState.channelId) {
            stopRadio(guildId);
        } else if (radioData && radioData.channelId) {
            const ch = oldState.guild.channels.cache.get(radioData.channelId);
            if (!ch || ch.members.filter(m => !m.user.bot).size === 0) {
                stopRadio(guildId);
            }
        }
    }

    // GEÇİCİ ODA OLUŞTURMA (15 Saniye Cooldown Korumalı)
    if (db[guildId].odaKanal && db[guildId].odaKategori) {
        if (newState.channelId === db[guildId].odaKanal && newState.member && !newState.member.user.bot) {
            const member = newState.member;
            const now = Date.now();
            const cdKey = `${guildId}-${member.id}`;
            const lastCreated = vcCooldownMap.get(cdKey) || 0;

            if (now - lastCreated < 15000) {
                await member.voice.disconnect().catch(() => { });
                return;
            }
            vcCooldownMap.set(cdKey, now);

            const roomName = `${member.user.username} Odası`;
            try {
                const newChannel = await newState.guild.channels.create({
                    name: roomName,
                    type: ChannelType.GuildVoice,
                    parent: db[guildId].odaKategori,
                    permissionOverwrites: [
                        {
                            id: newState.guild.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
                        },
                        {
                            id: member.id,
                            allow: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
                        },
                        {
                            id: client.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.MoveMembers, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ReadMessageHistory]
                        }
                    ]
                });

                await member.voice.setChannel(newChannel);

                const roomData = {
                    ownerId: member.id,
                    locked: false,
                    hidden: false,
                    chatClosed: false,
                    panelMsgId: null
                };

                db[guildId].tempRooms[newChannel.id] = roomData;
                saveDB(db);

                setTimeout(async () => {
                    try {
                        const panelMsg = await newChannel.send({
                            content: `<@${member.id}>, oda kontrol paneliniz aşağıdadır:`,
                            embeds: [buildTempVoiceEmbed(roomData)],
                            components: buildTempVoiceComponents(roomData, false)
                        });
                        if (panelMsg) {
                            const freshDb = getDB();
                            ensureGuildDB(freshDb, guildId);
                            if (freshDb[guildId].tempRooms[newChannel.id]) {
                                freshDb[guildId].tempRooms[newChannel.id].panelMsgId = panelMsg.id;
                                saveDB(freshDb);
                            }
                        }
                    } catch (sendErr) {
                        console.error("Geçici oda paneli gönderilemedi:", sendErr);
                    }
                }, 1000);

                sendLog(newState.guild, 'logSunucu', { title: 'Geçici Ses Odası Açıldı', desc: `**Oda:** <#${newChannel.id}> (\`${newChannel.name}\`)\n**Sahibi:** <@${member.id}>`, color: 0x57f287 });
            } catch (e) { console.error("Geçici oda oluşturma hatası:", e); }
        }
    }

    // GEÇİCİ ODA SİLME VEYA SAHİPLİK DEVRİ AKTİFLEŞTİRME
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const guild = oldState.guild;
        const channelId = oldState.channelId;
        const oldChannel = oldState.channel || guild.channels.cache.get(channelId);
        const roomData = db[guildId].tempRooms ? db[guildId].tempRooms[channelId] : null;
        const isUnderTempCategory = Boolean(db[guildId].odaKategori && oldChannel && oldChannel.parentId === db[guildId].odaKategori && oldChannel.id !== db[guildId].odaKanal);

        if (oldChannel && (roomData || isUnderTempCategory)) {
            // Ayrılan üye hariç kanalda kalan insan sayısı
            const remainingHumans = oldChannel.members.filter(m => m.id !== oldState.id && !m.user?.bot);

            if (remainingHumans.size === 0) {
                if (db[guildId].tempRooms) delete db[guildId].tempRooms[channelId];
                renameCooldownMap.delete(channelId);
                saveDB(db);
                await oldChannel.delete().catch(err => {
                    addLiveLog(`❌ Geçici oda silme hatası: ${err.message}`);
                });
                sendLog(oldState.guild, 'logSunucu', { title: 'Geçici Ses Odası Silindi', desc: `**Oda Adı:** \`${oldChannel.name}\` boşaldığı için otomatik silindi.`, color: 0xed4245 });
            } else if (roomData && oldState.id === roomData.ownerId) {
                if (roomData.panelMsgId) {
                    const panelMsg = await oldChannel.messages.fetch(roomData.panelMsgId).catch(() => null);
                    if (panelMsg) {
                        await panelMsg.edit({
                            content: `Oda sahibi (<@${roomData.ownerId}>) odadan ayrıldı. Odadaki üyelerden biri **Sahipliği Al** butonuna basarak odayı devralabilir.`,
                            embeds: [buildTempVoiceEmbed(roomData)],
                            components: buildTempVoiceComponents(roomData, true)
                        }).catch(() => { });
                    }
                }
            }
        }
    }

    // SES LOGLARI VE SÜRE (MESAİ) TAKİBİ
    if (oldState.member && oldState.member.user.bot) return;
    const member = newState.member;
    if (!member) return;
    const timerKey = `${guildId}-${member.id}`;

    if (!oldState.channelId && newState.channelId) {
        voiceTimerMap.set(timerKey, Date.now());
        sendLog(newState.guild, 'logSes', { title: 'Ses Kanalına Katıldı', desc: `**Üye:** <@${member.id}>\n**Kanal:** <#${newState.channelId}>`, color: 0x57f287, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceTimerMap.get(timerKey);
        voiceTimerMap.delete(timerKey);
        const durationText = joinTime ? `\n**Odada Geçirilen Süre:** \`${formatDuration(Date.now() - joinTime)}\`` : '';
        sendLog(newState.guild, 'logSes', { title: 'Ses Kanalından Ayrıldı', desc: `**Üye:** <@${member.id}>\n**Ayrıldığı Kanal:** <#${oldState.channelId}>${durationText}`, color: 0xed4245, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId !== newState.channelId) {
        const joinTime = voiceTimerMap.get(timerKey);
        voiceTimerMap.set(timerKey, Date.now());
        const durationText = joinTime ? `\n**Önceki Odada Kalma Süresi:** \`${formatDuration(Date.now() - joinTime)}\`` : '';
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberMove);
        const tasiyan = (executor && executor.id !== member.id) ? `\n**Taşıyan Yetkili:** <@${executor.id}>` : '';
        sendLog(newState.guild, 'logSes', { title: 'Ses Kanalı Değiştirdi', desc: `**Üye:** <@${member.id}>\n**Eski Kanal:** <#${oldState.channelId}>\n**Yeni Kanal:** <#${newState.channelId}>${durationText}${tasiyan}`, color: 0xfee75c });
    }

    if (!oldState.serverMute && newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'Yetkili Tarafından Susturuldu (Server Mute)', desc: `**Üye:** <@${member.id}>\n**Susturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverMute && !newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'Yetkili Susturması Kaldırıldı', desc: `**Üye:** <@${member.id}>\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }
    if (!oldState.serverDeaf && newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'Yetkili Tarafından Sağırlaştırıldı (Server Deafen)', desc: `**Üye:** <@${member.id}>\n**Sağırlaştıran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverDeaf && !newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'Yetkili Sağırlaştırması Kaldırıldı', desc: `**Üye:** <@${member.id}>\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }

    if (!oldState.selfMute && newState.selfMute) sendLog(newState.guild, 'logSes', { title: 'Mikrofonunu Kapattı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfMute && !newState.selfMute) sendLog(newState.guild, 'logSes', { title: 'Mikrofonunu Açtı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });
    if (!oldState.selfDeaf && newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: 'Kulaklığını Kapattı (Sağırlaştı)', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfDeaf && !newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: 'Kulaklığını Açtı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });

    if (!oldState.streaming && newState.streaming) sendLog(newState.guild, 'logSes', { title: 'Ekran Paylaşımı Başlattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında yayın açtı.`, color: 0x3498db });
    if (oldState.streaming && !newState.streaming) sendLog(newState.guild, 'logSes', { title: 'Ekran Paylaşımını Kapattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalındaki yayınını sonlandırdı.`, color: 0xe67e22 });
    if (!oldState.selfVideo && newState.selfVideo) sendLog(newState.guild, 'logSes', { title: 'Kamerasını Açtı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında kamera açtı.`, color: 0x3498db });
    if (oldState.selfVideo && !newState.selfVideo) sendLog(newState.guild, 'logSes', { title: 'Kamerasını Kapattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında kamerasını kapattı.`, color: 0xe67e22 });
});

// 4. ÜYE GİRİŞ / ÇIKIŞ, 15 GÜNLÜK YENİ HESAP ALARMI, FAKE DAVET VE ASKIDA KALAN BİLET TEMİZLİĞİ
client.on('guildMemberAdd', async member => {
    const db = getDB();
    const guildId = member.guild.id;
    ensureGuildDB(db, guildId);

    if (member.user.bot) {
        if (!Array.isArray(db[guildId].botWhitelist)) db[guildId].botWhitelist = [];
        const ownerId = member.guild.ownerId;
        const executor = await getAuditExecutor(member.guild, AuditLogEvent.BotAdd, member.id);

        const isAllowedBot = db[guildId].botWhitelist.includes(member.id);
        const isAllowedAdder = executor && (executor.id === ownerId || db[guildId].botWhitelist.includes(executor.id));

        // Anti-Bot Koruması (İzinsiz Bot Engeli)
        if (db[guildId].antiBot !== false) {
            if (!isAllowedBot && !isAllowedAdder) {
                let kickSuccess = false;
                try {
                    await member.kick('İzinsiz Bot Ekleme Koruması (Anti-Bot)');
                    kickSuccess = true;
                } catch (e) { }

                return sendLog(member.guild, 'logGuvenlik', {
                    title: '🚨 İZİNSİZ BOT TESPİT EDİLDİ VE ENGELLENDİ',
                    desc: `**Eklenen Bot:** <@${member.id}> (\`${member.user.tag}\`)\n` +
                        `**Ekleyen:** ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'Bilinmiyor'}\n` +
                        `**Uygulanan İşlem:** ${kickSuccess ? '🚫 **Bot derhal sunucudan atıldı.**' : '⚠️ *Bot yetki yetersizliği sebebiyle atılamadı!*'}\n` +
                        `**Güvenlik Notu:** Sunucuya bot ekleme izni sadece Sunucu Sahibine aittir. İzinli bot veya kişileri \`/panel\` üzerinden beyaz listeye ekleyebilirsiniz.`,
                    color: 0xed4245,
                    thumbnail: member.user.displayAvatarURL()
                });
            }
        }

        return sendLog(member.guild, 'logGuvenlik', {
            title: 'Sunucuya Yeni Bir Bot Eklendi',
            desc: `**Eklenen Bot:** <@${member.id}> (${member.user.tag})\n**Ekleyen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Durum:** Güvenli / Onaylı`,
            color: 0x57f287,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    if (!db[guildId].users[member.id]) {
        db[guildId].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0, spamWarn: 0 };
    }
    const userData = db[guildId].users[member.id];

    if (member.manageable) {
        if (userData.jailExpire && Date.now() < userData.jailExpire && db[guildId].jailRol) {
            await member.roles.add(db[guildId].jailRol).catch(() => { });
        }
        if (userData.sicilli && db[guildId].sicilRol) {
            await member.roles.add(db[guildId].sicilRol).catch(() => { });
        }
    }

    let inviteMsg = "Davet eden bulunamadı (Özel URL veya süresi dolmuş).";
    let inviterId = null;
    let inviteCode = null;

    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = invitesCache.get(member.guild.id) ? invitesCache.get(member.guild.id) : new Map();
        const usedInvite = newInvites.find(inv => {
            const prevUses = oldInvites.get(inv.code) ? oldInvites.get(inv.code) : 0;
            return inv.uses > prevUses;
        });

        newInvites.forEach(inv => oldInvites.set(inv.code, inv.uses));
        invitesCache.set(member.guild.id, oldInvites);

        if (usedInvite && usedInvite.inviter) {
            inviterId = usedInvite.inviter.id;
            inviteCode = usedInvite.code;
            inviteMsg = `<@${usedInvite.inviter.id}> (\`${usedInvite.code}\` koduyla - Toplam **${usedInvite.uses}** kullanım)`;
        }
    } catch (e) { }

    userData.lastJoin = Date.now();
    userData.inviterId = inviterId;
    userData.inviteCode = inviteCode;
    saveDB(db);

    const hesapYasiMs = Date.now() - member.user.createdTimestamp;
    const hesapYasiGun = Math.floor(hesapYasiMs / (1000 * 60 * 60 * 24));

    if (hesapYasiGun < 15) {
        sendLog(member.guild, 'logGuvenlik', {
            title: 'POTANSİYEL YAN HESAP / ŞÜPHELİ GİRİŞ',
            desc: `**Kullanıcı:** <@${member.id}> (\`${member.user.tag}\`)\n**Hesap Yaşı:** Henüz **${hesapYasiGun} gün** önce açılmış (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)\n**Davet Eden:** ${inviteMsg}`,
            color: 0xff0000,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    sendLog(member.guild, 'logUye', {
        title: 'Sunucuya Katıldı',
        desc: `**Üye:** <@${member.id}> (${member.user.tag})\n**Hesap Kuruluş:** ${hesapYasiGun} gün önce (<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>)\n**Davet Eden:** ${inviteMsg}`,
        color: 0x57f287,
        thumbnail: member.user.displayAvatarURL()
    });
});

client.on('guildMemberRemove', async member => {
    const db = getDB();
    const guildId = member.guild.id;
    ensureGuildDB(db, guildId);

    // Askıda Kalan Bilet (Ticket) Kontrolü ve Otomatik Arşivleme
    for (const [tChId, tData] of Object.entries(db[guildId].tickets)) {
        if (tData.ownerId === member.id) {
            const tChannel = member.guild.channels.cache.get(tChId);
            if (tChannel) {
                const sortedMessages = await fetchAllMessages(tChannel, 1000);
                let txtLines = [
                    `====================================================`,
                    `TICKET KONUŞMA DÖKÜMÜ (ÜYE AYRILDIĞI İÇİN OTOMATİK KAPATILDI)`,
                    `Kanal Adı       : ${tChannel.name}`,
                    `Talep Sahibi    : ${member.user.tag} (${member.id})`,
                    `Talep Konusu    : ${tData.subject || 'Belirtilmedi'}`,
                    `Talep Açıklaması: ${tData.details || 'Belirtilmedi'}`,
                    `Kapanış Tarihi  : ${new Date().toLocaleString('tr-TR')}`,
                    `Toplam Mesaj    : ${sortedMessages.length}`,
                    `====================================================\n`
                ];
                for (const m of sortedMessages) {
                    const timeStr = new Date(m.createdTimestamp).toLocaleString('tr-TR');
                    const content = m.content || (m.embeds.length > 0 ? '[Sistem Paneli / Başvuru Kartı]' : '[Görsel / Dosya]');
                    txtLines.push(`[${timeStr}] ${m.author.tag}: ${content}`);
                }
                const txtBuffer = Buffer.from(txtLines.join('\n'), 'utf-8');
                const attachment = new AttachmentBuilder(txtBuffer, { name: `${tChannel.name}-oto-arsiv.txt` });

                sendLog(member.guild, 'logMesaj', {
                    title: 'Ticket Otomatik Kapatıldı (Üye Sunucudan Ayrıldı)',
                    desc: `**Kanal:** \`${tChannel.name}\`\n**Ayrılan Talep Sahibi:** <@${member.id}> (${member.user.tag})\n**Konu:** ${tData.subject || 'Belirtilmedi'}`,
                    color: 0xe67e22
                }, [attachment]);

                await tChannel.delete().catch(() => { });
            }
            delete db[guildId].tickets[tChId];
            saveDB(db);
        }
    }

    const userData = db[guildId].users[member.id];
    if (userData && userData.lastJoin && (Date.now() - userData.lastJoin) < 86400000) {
        const kalmaSuresi = formatDuration(Date.now() - userData.lastJoin);
        sendLog(member.guild, 'logGuvenlik', {
            title: 'Kalıcı Olmayan (Fake) Davet Tespiti',
            desc: `**Çıkan Üye:** <@${member.id}> (\`${member.user.tag}\`)\n**Sunucuda Kalma Süresi:** \`${kalmaSuresi}\` (24 saatten az)\n**Davet Eden:** ${userData.inviterId ? `<@${userData.inviterId}> (\`${userData.inviteCode}\`)` : 'Bilinmiyor'}`,
            color: 0xe67e22,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    const executor = await getAuditExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (executor) {
        return sendLog(member.guild, 'logCeza', {
            title: 'Sunucudan Atıldı (KICK)',
            desc: `**Atılan Üye:** <@${member.id}> (${member.user.tag})\n**Atan Yetkili:** <@${executor.id}>`,
            color: 0xed4245,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    sendLog(member.guild, 'logUye', {
        title: 'Sunucudan Ayrıldı',
        desc: `**Üye:** <@${member.id}> (${member.user.tag})\nSunucudan kendi isteğiyle ayrıldı.`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
});

// 5. ÜYE GÜNCELLEMELERİ (İSİM, ROL, BOOST VE AVATAR)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const guild = newMember.guild;

    if (!oldMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const bitis = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;
        sendLog(guild, 'logCeza', {
            title: 'Zaman Aşımı (Timeout) Uygulandı',
            desc: `**Üye:** <@${newMember.id}>\n**Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Bitiş Süresi:** ${bitis}`,
            color: 0xed4245,
            thumbnail: newMember.user.displayAvatarURL()
        });
    } else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        sendLog(guild, 'logCeza', {
            title: 'Zaman Aşımı (Timeout) Kaldırıldı',
            desc: `**Üye:** <@${newMember.id}>\n**İşlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Süresi Doldu / Bilinmiyor'}`,
            color: 0x57f287
        });
    }

    if (oldMember.nickname !== newMember.nickname) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const eskiIsim = oldMember.nickname ? oldMember.nickname : oldMember.user.username;
        const yeniIsim = newMember.nickname ? newMember.nickname : newMember.user.username;
        sendLog(guild, 'logUye', {
            title: 'Sunucu İçi İsim (Nickname) Değiştirildi',
            desc: `**Üye:** <@${newMember.id}>\n**Değiştiren:** ${executor ? `<@${executor.id}>` : 'Kendisi'}\n**Eski İsim:** ${eskiIsim}\n**Yeni İsim:** ${yeniIsim}`,
            color: 0x3498db
        });
    }

    if (oldMember.avatar !== newMember.avatar) {
        sendLog(guild, 'logUye', {
            title: 'Sunucu İçi Özel Avatar Değişti',
            desc: `**Üye:** <@${newMember.id}> sunucu içi profil fotoğrafını güncelledi.\n[Eski Avatar](${oldMember.displayAvatarURL()}) -> [Yeni Avatar](${newMember.displayAvatarURL()})`,
            color: 0x3498db,
            thumbnail: newMember.displayAvatarURL()
        });
    }

    if (!oldMember.premiumSince && newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: 'Sunucuya Takviye (Boost) Yapıldı', desc: `<@${newMember.id}> sunucuya Nitro takviyesi yaptı.`, color: 0xf47fff, thumbnail: newMember.user.displayAvatarURL() });
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: 'Sunucu Takviyesi (Boost) Çekildi', desc: `<@${newMember.id}> kullanıcısının sunucu takviyesi sona erdi.`, color: 0x95a5a6 });
    }

    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        const yetkili = executor ? `<@${executor.id}>` : 'Sistem / Bilinmiyor';

        if (addedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: 'Rol Verildi', desc: `**Üye:** <@${newMember.id}>\n**Veren Yetkili:** ${yetkili}\n**Verilen Rol:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0x57f287 });
        }
        if (removedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: 'Rol Alındı', desc: `**Üye:** <@${newMember.id}>\n**Alan Yetkili:** ${yetkili}\n**Alınan Rol:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0xed4245 });
        }
    }
});

client.on('userUpdate', (oldUser, newUser) => {
    if (oldUser.bot) return;
    client.guilds.cache.forEach(guild => {
        if (!guild.members.cache.has(newUser.id)) return;
        if (oldUser.username !== newUser.username) {
            sendLog(guild, 'logUye', { title: 'Discord Kullanıcı Adı Değişti', desc: `**Kullanıcı:** <@${newUser.id}>\n**Eski Adı:** \`${oldUser.username}\`\n**Yeni Adı:** \`${newUser.username}\``, color: 0x3498db });
        }
        if (oldUser.avatar !== newUser.avatar) {
            sendLog(guild, 'logUye', {
                title: 'Discord Profil Fotoğrafı (PP) Değişti',
                desc: `**Kullanıcı:** <@${newUser.id}> genel profil fotoğrafını değiştirdi.\n[Eski PP](${oldUser.displayAvatarURL()}) -> [Yeni PP](${newUser.displayAvatarURL()})`,
                color: 0x3498db,
                thumbnail: newUser.displayAvatarURL()
            });
        }
    });
});

// 6. BAN, KANAL, ROL (KRİTİK İZİN ALARMLI), EMOJİ, WEBHOOK VE DAVET LOGLARI
client.on('guildBanAdd', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: 'Sunucudan Yasaklandı (BAN)',
        desc: `**Yasaklanan:** ${ban.user.tag} (<@${ban.user.id}>)\n**Yasaklayan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x992d22,
        thumbnail: ban.user.displayAvatarURL()
    });
});

client.on('guildBanRemove', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: 'Yasak Kaldırıldı (UNBAN)',
        desc: `**Kullanıcı:** ${ban.user.tag} (<@${ban.user.id}>)\n**Yasağı Kaldıran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x57f287,
        thumbnail: ban.user.displayAvatarURL()
    });
});

const channelPermNames = {
    ViewChannel: 'Kanalı Görüntüle',
    SendMessages: 'Mesaj Gönder',
    SendMessagesInThreads: 'Alt Başlıklarda Mesaj Gönder',
    CreatePublicThreads: 'Herkese Açık Alt Başlık Oluştur',
    CreatePrivateThreads: 'Özel Alt Başlık Oluştur',
    EmbedLinks: 'Bağlantı Yerleştir',
    AttachFiles: 'Dosya Ekle',
    AddReactions: 'Tepki Ekle',
    UseExternalEmojis: 'Harici Emoji Kullan',
    UseExternalStickers: 'Harici Çıkartma Kullan',
    MentionEveryone: '@everyone ve Rolleri Etiketle',
    ManageMessages: 'Mesajları Yönet',
    ManageThreads: 'Alt Başlıkları Yönet',
    ReadMessageHistory: 'Geçmişi Oku',
    SendTTSMessages: 'Metin Okuma Mesajları Gönder',
    UseApplicationCommands: 'Uygulama Komutlarını Kullan',
    Connect: 'Bağlan (Sese Gir)',
    Speak: 'Konuş',
    Stream: 'Yayın Aç (Ekran Paylaş)',
    UseEmbeddedActivities: 'Aktivite Başlat',
    UseVAD: 'Ses Eylemini Kullan',
    PrioritySpeaker: 'Öncelikli Konuşmacı',
    MuteMembers: 'Üyeleri Sustur',
    DeafenMembers: 'Üyeleri Sağırlaştır',
    MoveMembers: 'Üyeleri Taşı',
    ManageChannels: 'Kanalı Yönet',
    ManageRoles: 'İzinleri Yönet',
    ManageWebhooks: 'Webhookları Yönet'
};

function getChannelTypeName(type) {
    switch (type) {
        case ChannelType.GuildText: return 'Metin Kanalı';
        case ChannelType.GuildVoice: return 'Ses Kanalı';
        case ChannelType.GuildCategory: return 'Kategori';
        case ChannelType.GuildAnnouncement: return 'Duyuru Kanalı';
        case ChannelType.GuildStageVoice: return 'Sahne (Stage) Kanalı';
        case ChannelType.GuildForum: return 'Forum Kanalı';
        case ChannelType.PublicThread: return 'Herkese Açık Alt Başlık';
        case ChannelType.PrivateThread: return 'Özel Alt Başlık';
        default: return 'Kanal';
    }
}

client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const db = getDB();
    if (db[channel.guild.id]?.tempRooms && db[channel.guild.id].tempRooms[channel.id]) return;

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const parentName = channel.parent ? channel.parent.name : 'Kategorisiz';
    const typeName = getChannelTypeName(channel.type);

    sendLog(channel.guild, 'logSunucu', {
        title: 'Yeni Kanal Açıldı',
        desc: `**Kanal:** <#${channel.id}> (\`${channel.name}\`)\n` +
            `**Tür:** ${typeName}\n` +
            `**Kategori:** 📁 \`${parentName}\`\n` +
            `**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x57f287
    });
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const db = getDB();
    const guildId = channel.guild.id;

    // Geçici ses odası elle silindiyse veritabanından ve önbellekten temizle
    if (db[guildId]?.tempRooms && db[guildId].tempRooms[channel.id]) {
        delete db[guildId].tempRooms[channel.id];
        renameCooldownMap.delete(channel.id);
        saveDB(db);
        return;
    }

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const parentName = channel.parent ? channel.parent.name : 'Kategorisiz';
    const typeName = getChannelTypeName(channel.type);

    sendLog(channel.guild, 'logSunucu', {
        title: 'Kanal Silindi',
        desc: `**Silinen Kanal:** \`${channel.name}\`\n` +
            `**Tür:** ${typeName}\n` +
            `**Bulunduğu Kategori:** 📁 \`${parentName}\`\n` +
            `**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0xed4245
    });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const db = getDB();
    if (db[newChannel.guild.id]?.tempRooms && db[newChannel.guild.id].tempRooms[newChannel.id]) return;

    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    // 1. Kanal Adı Değişimi
    if (oldChannel.name !== newChannel.name) {
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Kanal Adı Değiştirildi',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Adı:** \`${oldChannel.name}\`\n**Yeni Adı:** \`${newChannel.name}\``,
            color: 0x3498db
        });
    }

    // 2. Kategori Değişimi (Taşıma)
    if (oldChannel.parentId !== newChannel.parentId) {
        const oldParent = oldChannel.parent ? oldChannel.parent.name : 'Kategorisiz';
        const newParent = newChannel.parent ? newChannel.parent.name : 'Kategorisiz';
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Kanal Kategorisi Değiştirildi',
            desc: `**Kanal:** <#${newChannel.id}> (\`${newChannel.name}\`)\n**Yetkili:** ${yetkili}\n**Eski Kategori:** 📁 \`${oldParent}\`\n**Yeni Kategori:** 📁 \`${newParent}\``,
            color: 0x3498db
        });
    }

    // 3. Kanal Açıklaması (Topic) Değişimi
    if ('topic' in oldChannel && 'topic' in newChannel && oldChannel.topic !== newChannel.topic) {
        const eskiTopic = oldChannel.topic ? oldChannel.topic : '*Yok*';
        const yeniTopic = newChannel.topic ? newChannel.topic : '*Yok*';
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Kanal Açıklaması (Topic) Değişti',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski:** ${eskiTopic}\n**Yeni:** ${yeniTopic}`,
            color: 0x3498db
        });
    }

    // 4. Kanal Yavaş Mod (Slowmode) Değişimi
    if ('rateLimitPerUser' in oldChannel && 'rateLimitPerUser' in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        const eskiSure = oldChannel.rateLimitPerUser ? `${oldChannel.rateLimitPerUser} saniye` : 'Kapalı';
        const yeniSure = newChannel.rateLimitPerUser ? `${newChannel.rateLimitPerUser} saniye` : 'Kapalı';
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Kanal Yavaş Mod (Slowmode) Değişti',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Süre:** \`${eskiSure}\`\n**Yeni Süre:** \`${yeniSure}\``,
            color: 0xfee75c
        });
    }

    // 5. Yaş Sınırı (+18 / NSFW) Değişimi
    if ('nsfw' in oldChannel && 'nsfw' in newChannel && oldChannel.nsfw !== newChannel.nsfw) {
        sendLog(newChannel.guild, 'logSunucu', {
            title: newChannel.nsfw ? '🔞 Kanal Yaş Sınırı (+18 / NSFW) Açıldı' : '🛡️ Kanal Yaş Sınırı (+18 / NSFW) Kapatıldı',
            desc: `**Kanal:** <#${newChannel.id}> (\`${newChannel.name}\`)\n**Yetkili:** ${yetkili}\n**Durum:** Kanal ${newChannel.nsfw ? '**+18 (NSFW) olarak işaretlendi.**' : '**standart kanala dönüştürüldü.**'}`,
            color: newChannel.nsfw ? 0xed4245 : 0x57f287
        });
    }

    // 6. Ses Kanalı Kullanıcı Limiti Değişimi
    if ('userLimit' in oldChannel && 'userLimit' in newChannel && oldChannel.userLimit !== newChannel.userLimit) {
        const eskiLimit = oldChannel.userLimit === 0 ? 'Sınırsız' : `${oldChannel.userLimit} Kişi`;
        const yeniLimit = newChannel.userLimit === 0 ? 'Sınırsız' : `${newChannel.userLimit} Kişi`;
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Ses Kanalı Kişi Limiti Değişti',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Limit:** \`${eskiLimit}\`\n**Yeni Limit:** \`${yeniLimit}\``,
            color: 0x3498db
        });
    }

    // 7. Ses Kanalı Kalitesi (Bitrate) Değişimi
    if ('bitrate' in oldChannel && 'bitrate' in newChannel && oldChannel.bitrate !== newChannel.bitrate) {
        const eskiBitrate = Math.round(oldChannel.bitrate / 1000);
        const yeniBitrate = Math.round(newChannel.bitrate / 1000);
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Ses Kanalı Kalitesi (Bitrate) Değişti',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Kalite:** \`${eskiBitrate} kbps\`\n**Yeni Kalite:** \`${yeniBitrate} kbps\``,
            color: 0x3498db
        });
    }

    // 8. Ses Kanalı Bölgesi (RTC Region) Değişimi
    if ('rtcRegion' in oldChannel && 'rtcRegion' in newChannel && oldChannel.rtcRegion !== newChannel.rtcRegion) {
        const eskiRegion = oldChannel.rtcRegion ? oldChannel.rtcRegion : 'Otomatik';
        const yeniRegion = newChannel.rtcRegion ? newChannel.rtcRegion : 'Otomatik';
        sendLog(newChannel.guild, 'logSunucu', {
            title: 'Ses Kanalı Bölgesi (Region) Değişti',
            desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Bölge:** \`${eskiRegion}\`\n**Yeni Bölge:** \`${yeniRegion}\``,
            color: 0x3498db
        });
    }

    // 9. Kanal İzin Değişiklikleri (Permission Overwrite Karşılaştırması & Kilit Tespiti)
    const oldOverwrites = oldChannel.permissionOverwrites?.cache;
    const newOverwrites = newChannel.permissionOverwrites?.cache;

    if (oldOverwrites && newOverwrites) {
        for (const [id, newOw] of newOverwrites) {
            const oldOw = oldOverwrites.get(id);
            const targetType = newOw.type === 0 ? 'Rol' : 'Üye';
            const targetMention = newOw.type === 0 ? `<@&${id}>` : `<@${id}>`;
            const isEveryone = id === newChannel.guild.id;

            if (!oldOw) {
                const allowedList = newOw.allow.toArray().map(p => channelPermNames[p] || p);
                const deniedList = newOw.deny.toArray().map(p => channelPermNames[p] || p);
                let desc = `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Hedef:** ${targetMention} (${targetType})\n`;
                if (allowedList.length > 0) desc += `**Açılan İzinler (🟢):** ${allowedList.join(', ')}\n`;
                if (deniedList.length > 0) desc += `**Kapatılan İzinler (🔴):** ${deniedList.join(', ')}`;

                sendLog(newChannel.guild, 'logSunucu', {
                    title: 'Kanal Özel İzni Eklendi',
                    desc,
                    color: 0x57f287
                });
            } else {
                const oldAllow = oldOw.allow.bitfield;
                const newAllow = newOw.allow.bitfield;
                const oldDeny = oldOw.deny.bitfield;
                const newDeny = newOw.deny.bitfield;

                if (oldAllow !== newAllow || oldDeny !== newDeny) {
                    // Özel Durum: @everyone için SendMessages kontrolü (Kilit Tespiti)
                    if (isEveryone) {
                        const oldSendDenied = oldOw.deny.has(PermissionsBitField.Flags.SendMessages);
                        const newSendDenied = newOw.deny.has(PermissionsBitField.Flags.SendMessages);

                        if (!oldSendDenied && newSendDenied) {
                            sendLog(newChannel.guild, 'logSunucu', {
                                title: '🔒 Kanal Yazmaya Kapatıldı (Kilitlendi)',
                                desc: `**Kanal:** <#${newChannel.id}> (\`${newChannel.name}\`)\n**Yetkili:** ${yetkili}\n**Durum:** \`@everyone\` rolünün mesaj gönderme izni kapatıldı.`,
                                color: 0xed4245
                            });
                        } else if (oldSendDenied && !newSendDenied) {
                            sendLog(newChannel.guild, 'logSunucu', {
                                title: '🔓 Kanal Yazmaya Açıldı (Kilit Kaldırıldı)',
                                desc: `**Kanal:** <#${newChannel.id}> (\`${newChannel.name}\`)\n**Yetkili:** ${yetkili}\n**Durum:** \`@everyone\` rolünün mesaj gönderme izni tekrar açıldı.`,
                                color: 0x57f287
                            });
                        }
                    }

                    // Detaylı İzin Değişimi Raporu
                    const newlyAllowed = newOw.allow.toArray().filter(p => !oldOw.allow.has(p)).map(p => channelPermNames[p] || p);
                    const newlyDenied = newOw.deny.toArray().filter(p => !oldOw.deny.has(p)).map(p => channelPermNames[p] || p);
                    const newlyCleared = [
                        ...oldOw.allow.toArray().filter(p => !newOw.allow.has(p)),
                        ...oldOw.deny.toArray().filter(p => !newOw.deny.has(p))
                    ].map(p => channelPermNames[p] || p);

                    if (newlyAllowed.length > 0 || newlyDenied.length > 0 || newlyCleared.length > 0) {
                        let desc = `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Hedef:** ${targetMention} (${targetType})\n`;
                        if (newlyAllowed.length > 0) desc += `**Açılan İzinler (🟢):** ${newlyAllowed.join(', ')}\n`;
                        if (newlyDenied.length > 0) desc += `**Kapatılan İzinler (🔴):** ${newlyDenied.join(', ')}\n`;
                        if (newlyCleared.length > 0) desc += `**Sıfırlanan İzinler (⚪):** ${newlyCleared.join(', ')}\n`;

                        sendLog(newChannel.guild, 'logSunucu', {
                            title: 'Kanal İzinleri Güncellendi',
                            desc,
                            color: 0xfee75c
                        });
                    }
                }
            }
        }

        // Silinen Özel İzinler
        for (const [id, oldOw] of oldOverwrites) {
            if (!newOverwrites.has(id)) {
                const targetType = oldOw.type === 0 ? 'Rol' : 'Üye';
                const targetMention = oldOw.type === 0 ? `<@&${id}>` : `<@${id}>`;
                sendLog(newChannel.guild, 'logSunucu', {
                    title: 'Kanal Özel İzni Kaldırıldı',
                    desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Kaldırılan Hedef:** ${targetMention} (${targetType})\nBu hedefin kanaldaki tüm özel izinleri kaldırıldı (varsayılana döndü).`,
                    color: 0xe67e22
                });
            }
        }
    }
});

client.on('roleCreate', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    sendLog(role.guild, 'logSunucu', { title: 'Yeni Rol Oluşturuldu', desc: `**Rol:** <@&${role.id}> (\`${role.name}\`)\n**Oluşturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('roleDelete', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    sendLog(role.guild, 'logSunucu', { title: 'Rol Silindi', desc: `**Silinen Rol:** \`${role.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldRole.name !== newRole.name) {
        sendLog(newRole.guild, 'logSunucu', { title: 'Rol Adı Değişti', desc: `**Rol:** <@&${newRole.id}>\n**Yetkili:** ${yetkili}\n**Eski Adı:** ${oldRole.name}\n**Yeni Adı:** ${newRole.name}`, color: 0x3498db });
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        const criticalPerms = [
            { flag: PermissionsBitField.Flags.Administrator, name: 'Yönetici (Administrator)' },
            { flag: PermissionsBitField.Flags.ManageGuild, name: 'Sunucuyu Yönet' },
            { flag: PermissionsBitField.Flags.ManageRoles, name: 'Rolleri Yönet' },
            { flag: PermissionsBitField.Flags.ManageChannels, name: 'Kanalları Yönet' },
            { flag: PermissionsBitField.Flags.BanMembers, name: 'Üyeleri Yasakla (Ban)' },
            { flag: PermissionsBitField.Flags.KickMembers, name: 'Üyeleri At (Kick)' },
            { flag: PermissionsBitField.Flags.ManageMessages, name: 'Mesajları Yönet' },
            { flag: PermissionsBitField.Flags.ManageWebhooks, name: 'Webhook\'ları Yönet' }
        ];

        const addedCritical = criticalPerms.filter(p => !oldRole.permissions.has(p.flag) && newRole.permissions.has(p.flag));

        if (addedCritical.length > 0) {
            sendLog(newRole.guild, 'logSunucu', {
                title: 'KRİTİK ROL İZNİ EKLENDİ',
                desc: `**Rol:** <@&${newRole.id}> (\`${newRole.name}\`)\n**İşlemi Yapan:** ${yetkili}\n**Eklenen Kritik Yetkiler:**\n${addedCritical.map(p => `- \`${p.name}\``).join('\n')}`,
                color: 0xff0000
            });
        } else {
            sendLog(newRole.guild, 'logSunucu', { title: 'Rol İzinleri Güncellendi', desc: `**Rol:** <@&${newRole.id}>\n**Değiştiren Yetkili:** ${yetkili}\nRolün yetki ayarları değiştirildi.`, color: 0xfee75c });
        }
    }
});

client.on('threadCreate', thread => {
    sendLog(thread.guild, 'logSunucu', { title: 'Alt Başlık (Thread) Açıldı', desc: `**Başlık:** <#${thread.id}> (\`${thread.name}\`)\n**Açan:** <@${thread.ownerId}>`, color: 0x57f287 });
});

client.on('threadDelete', thread => {
    sendLog(thread.guild, 'logSunucu', { title: 'Alt Başlık (Thread) Silindi', desc: `**Silinen Başlık:** \`${thread.name}\``, color: 0xed4245 });
});

client.on('emojiCreate', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: 'Emoji Eklendi', desc: `**Emoji:** ${emoji} (\`${emoji.name}\`)\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('emojiDelete', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: 'Emoji Silindi', desc: `**Silinen Emoji:** \`${emoji.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('stickerCreate', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: 'Çıkartma (Sticker) Eklendi', desc: `**Sticker:** \`${sticker.name}\`\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('stickerDelete', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: 'Çıkartma (Sticker) Silindi', desc: `**Silinen Sticker:** \`${sticker.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const executor = await getAuditExecutor(newGuild, AuditLogEvent.GuildUpdate);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldGuild.name !== newGuild.name) {
        sendLog(newGuild, 'logSunucu', { title: 'Sunucu Adı Değiştirildi', desc: `**Yetkili:** ${yetkili}\n**Eski Adı:** ${oldGuild.name}\n**Yeni Adı:** ${newGuild.name}`, color: 0x3498db });
    }
    if (oldGuild.icon !== newGuild.icon) {
        sendLog(newGuild, 'logSunucu', { title: 'Sunucu İkonu Değiştirildi', desc: `**Yetkili:** ${yetkili}\nSunucu profil resmi güncellendi.`, color: 0x3498db, thumbnail: newGuild.iconURL() });
    }
});

client.on('webhookUpdate', async channel => {
    let executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookCreate);
    if (!executor) {
        executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookDelete);
    }
    sendLog(channel.guild, 'logGuvenlik', {
        title: 'Webhook İşlemi Tespit Edildi',
        desc: `**Kanal:** <#${channel.id}>\n**İşlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\nKanaldaki webhook'lar oluşturuldu, güncellendi veya silindi.`,
        color: 0xff0000
    });
});

client.on('inviteCreate', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id) ? invitesCache.get(invite.guild.id) : new Map();
    oldInvites.set(invite.code, invite.uses);
    invitesCache.set(invite.guild.id, oldInvites);

    sendLog(invite.guild, 'logGuvenlik', {
        title: 'Yeni Davet Linki Oluşturuldu',
        desc: `**Oluşturan:** <@${invite.inviterId}>\n**Kanal:** <#${invite.channelId}>\n**Kod:** \`${invite.code}\`\n**Maks. Kullanım:** ${invite.maxUses === 0 ? 'Sınırsız' : invite.maxUses}`,
        color: 0x57f287
    });
});

client.on('inviteDelete', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id);
    if (oldInvites) oldInvites.delete(invite.code);

    sendLog(invite.guild, 'logGuvenlik', {
        title: 'Davet Linki Silindi / Süresi Doldu',
        desc: `**Kanal:** <#${invite.channelId}>\n**Silinen Kod:** \`${invite.code}\``,
        color: 0xe67e22
    });
});

process.on('unhandledRejection', error => {
    if (error && [10062, 40060, 50013, 10008].includes(error.code)) return;
    console.error('Sistem Hatası (Rejection):', error);
});

process.on('uncaughtException', error => {
    console.error('Beklenmeyen Hata (Exception):', error);
});

const botToken = process.env.TOKEN ? process.env.TOKEN.trim() : null;

if (!botToken) {
    addLiveLog('❌ KRİTİK HATA: Discord Bot TOKEN ortam değişkeni bulunamadı!');
    console.error('Render panelinde sol menüdeki "Environment" sekmesine gidin, Key: TOKEN, Value: <Token>');
} else {
    addLiveLog('✅ TOKEN bulundu, Discord bağlantı süreci başlatılıyor...');

    let isLoggingIn = false;
    async function startBot() {
        if (isLoggingIn || (client.isReady && client.isReady())) return;
        isLoggingIn = true;
        try {
            await initMongoDB();
            addLiveLog('Discord Gateway bağlantısı başlatılıyor...');
            await client.login(botToken);
            addLiveLog('✅ client.login() başarıyla tamamlandı.');
        } catch (err) {
            addLiveLog(`❌ Discord Giriş Hatası: ${err.message || err}`);
            isLoggingIn = false;
            // Bağlantı koparsa veya hata verirse 10 saniye sonra otomatik yeniden dene
            setTimeout(startBot, 10000);
        } finally {
            isLoggingIn = false;
        }
    }

    startBot();
}
