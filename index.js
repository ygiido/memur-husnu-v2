const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const serverPort = process.env.PORT ? process.env.PORT : 3000;
http.createServer((req, res) => res.end('Bot aktif!')).listen(serverPort);

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

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
const getDB = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));

const spamMap = new Map();
const invitesCache = new Map();

// ============================================================================
// ULTRA GELÄ°ÅMÄ°Å KÃœFÃœR VE ARGO TESPÄ°T MOTORU (ANTI-BYPASS)
// ============================================================================
function kufurTespitEt(metin) {
    if (!metin) return false;

    let text = metin.toLocaleLowerCase('tr-TR');

    const charMap = {
        '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
        '@': 'a', '$': 's', '!': 'i', 'Â¡': 'i', '|': 'i', '+': 't', 'â‚¬': 'e', 'Â£': 'e',
        'Ã§': 'c', 'ÄŸ': 'g', 'Ä±': 'i', 'Ã¶': 'o', 'ÅŸ': 's', 'Ã¼': 'u', 'Ã¢': 'a', 'Ã®': 'i', 'Ã»': 'u',
        'q': 'k', 'w': 'v', 'x': 'ks'
    };

    let normText = '';
    for (let char of text) {
        normText += charMap[char] ? charMap[char] : char;
    }

    const dedupedText = normText.replace(/(.)\1+/g, '$1');
    const wordsOnly = dedupedText.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordsArray = wordsOnly.split(' ');
    const strippedText = dedupedText.replace(/[^a-z]/g, '');

    const kelimeBazliKufurler = [
        'amk', 'amc', 'amq', 'aq', 'oc', 'oÃ§', 'pic', 'piÃ§', 'sik', 'sg', 'mk', 'mq',
        'got', 'gÃ¶t', 'am', 'ami', 'amin', 'amina', 'aminda', 'amini', 'amcik', 'amck',
        'siki', 'sikim', 'sikin', 'sikis', 'siker', 'sikerim', 'sikeyim', 'sikik', 'siktir', 'sktr', 'siktin', 'sokuk', 'sokarim', 'sokam',
        'yarak', 'yarrak', 'yarag', 'yarrag', 'yarram', 'yaraam',
        'orspu', 'orospu', 'oruspu', 'orosbu', 'orusbu',
        'pezevenk', 'pezeveng', 'pzvnk', 'gavat', 'kaltak', 'kahpe', 'kahbe', 'kancik', 'kevase', 'kaltag',
        'ibne', 'ipne', 'top', 'puÅŸt', 'pust', 'yavsak', 'yavÅŸak', 'gotten', 'gotveren', 'gÃ¶tveren',
        'dalyarak', 'dalyarrak', 'malafat', 'taÅŸak', 'tasak', 'tassak', 'daÅŸak', 'dasak', 'dassak',
        'angut', 'lavuk', 'zibidi', 'haysiyetsiz', 'serefsiz', 'ÅŸerefsiz', 'namussuz', 'itoglu', 'kopekoglu',
        'anan', 'anani', 'ananin', 'bacini', 'bacinin', 'sulan', 'sulaleni', 'ecdadini', 'soyunu', 'zÃ¼rriyetini'
    ];

    for (let word of wordsArray) {
        if (kelimeBazliKufurler.includes(word)) return true;
        if (/^(siktir|sikis|siker|sikey|sikim|orospu|oruspu|pezevenk|yavsak|amcik|yarrak|yarak|gotveren|kahpe|kaltak|ecdadini|sulaleni)/.test(word)) {
            return true;
        }
    }

    const ayrilmisHarfDeseni = /(?:^|\s)([a4@]\s*[m]\s*[kqv]|[a4@]\s*[q]|[o0]\s*[cÃ§]|[p]\s*[i1!]\s*[cÃ§]|[s5$]\s*[i1!]\s*[k])(?:\s|$)/i;
    if (ayrilmisHarfDeseni.test(text)) return true;

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
    { tetikleyiciler: ["as", "a.s", "aleykÃ¼m selam", "aleykÃ¼mselam", "aleykum selam"], cevaplar: ["HoÅŸ bulduk efendim. Evrak kayÄ±t bÃ¶lÃ¼mÃ¼ne hoÅŸ geldiniz, buyurun.", "HoÅŸ bulduk, mesaimiz devam ediyor. NasÄ±l yardÄ±mcÄ± olabilirim?", "GÃ¶revimizin baÅŸÄ±ndayÄ±z vatandaÅŸ, buyurun."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["sa", "s.a", "selam", "selamun aleykÃ¼m", "sea", "selamÄ±n aleykÃ¼m"], cevaplar: ["AleykÃ¼mselam efendim. Dairemize hoÅŸ geldiniz.", "AleykÃ¼mselam, buyurun iÅŸleminiz neydi?", "AleykÃ¼mselam vatandaÅŸ, hoÅŸ geldiniz."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["gÃ¼naydÄ±n", "gunaydin", "hayÄ±rlÄ± sabahlar", "sabah ÅŸerifleriniz hayrolsun"], cevaplar: ["GÃ¼naydÄ±n efendim. Mesaimiz baÅŸlamÄ±ÅŸtÄ±r, harika bir gÃ¼n dilerim.", "GÃ¼naydÄ±n vatandaÅŸ, hoÅŸ geldiniz. Ã‡ayÄ±mÄ±z yeni demlendi."], etiketle: true, tamKelime: false },
    { tetikleyiciler: ["iyi geceler", "iyi akÅŸamlar", "iyi aksamlar", "hayÄ±rlÄ± geceler"], cevaplar: ["Ä°yi geceler efendim. NÃ¶betÃ§i memur olarak gÃ¶rev baÅŸÄ±ndayÄ±m.", "Ä°yi akÅŸamlar, huzurlu istirahatler dilerim."], etiketle: false, tamKelime: false },
    { tetikleyiciler: ["hg", "hoÅŸ geldin", "hoÅŸgeldin"], cevaplar: ["HoÅŸ bulduk, Ã§ok teÅŸekkÃ¼r ederim. Dairede durumlar nasÄ±l?", "SaÄŸ olun efendim, masamÄ±za geÃ§tik."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["bb", "gÃ¶rÃ¼ÅŸÃ¼rÃ¼z", "gorusuruz", "ben kaÃ§ar", "Ã§Ä±kÄ±yorum", "allaha emanet", "baybay"], cevaplar: ["DosyanÄ±zÄ± kapattÄ±m, saÄŸlÄ±cakla kalÄ±n.", "Allah'a emanet olun, yine bekleriz."], etiketle: false, tamKelime: true },
    { tetikleyiciler: ["nasÄ±lsÄ±n", "naber", "nasilsin", "ne haber", "napÄ±yorsun", "nabÄ±yon"], cevaplar: ["Ã‡ok ÅŸÃ¼kÃ¼r efendim, evraklarÄ±mÄ±zÄ± dÃ¼zenliyoruz. Siz nasÄ±lsÄ±nÄ±z?", "TeÅŸekkÃ¼r ederim, gÃ¶revimizin baÅŸÄ±ndayÄ±z. Sizi sormalÄ±?"], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["teÅŸekkÃ¼rler", "saÄŸ ol", "saÄŸol", "eyvallah", "teÅŸekkÃ¼r ederim", "eyv"], cevaplar: ["Rica ederim efendim, kamu hizmeti bizim gÃ¶revimiz.", "Ne demek, her zaman yardÄ±ma hazÄ±rÄ±z."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["lan", "sus", "kes", "aptal", "mal", "salak"], cevaplar: ["Efendim, lÃ¼tfen Ã¼slubumuza dikkat edelim. Resmi dairedeyiz.", "Sevgili vatandaÅŸÄ±m, birbirimize karÅŸÄ± daha nazik olalÄ±m lÃ¼tfen."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["Ã§ay", "kahve", "sigara", "Ã§orba", "molasÄ±"], cevaplar: ["Buyurun efendim, Ã§ayÄ±mÄ±z taze. Bir bardak da size doldurayÄ±m.", "Mesai arasÄ± sÄ±cak bir Ã§ay gibisi yok, afiyet olsun."], etiketle: false, tamKelime: false }
];

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

async function sendLog(guild, logCategory, options) {
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
        if (options.footer) embed.setFooter({ text: options.footer });
        channel.send({ embeds: [embed] }).catch(() => {});
    }
}

async function applyJail(member, guild, reason) {
    const db = getDB();
    if (!db[guild.id]) db[guild.id] = {};
    if (!db[guild.id].users) db[guild.id].users = {};
    if (!db[guild.id].users[member.id]) {
        db[guild.id].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };
    }

    let userData = db[guild.id].users[member.id];
    userData.jailCount += 1;
    userData.sicilli = true; 

    const durations = [15, 30, 60, 180];
    let durationMins = durations[userData.jailCount - 1] ? durations[userData.jailCount - 1] : 180; 
    userData.jailExpire = Date.now() + (durationMins * 60 * 1000);
    saveDB(db);

    if (db[guild.id].jailRol) await member.roles.add(db[guild.id].jailRol).catch(() => {});
    if (db[guild.id].sicilRol) await member.roles.add(db[guild.id].sicilRol).catch(() => {});

    sendLog(guild, 'logCeza', {
        title: 'ğŸš¨ Otomatik Timeout (UzaklaÅŸtÄ±rma)',
        desc: `**VatandaÅŸ:** <@${member.id}> (\`${member.id}\`)\n**Sebep:** ${reason}\n**SÃ¼re:** ${durationMins} dakika\n**Toplam Ä°hlali:** ${userData.jailCount}\n**Sicil DosyasÄ±:** Ä°ÅŸlendi ğŸ“œ`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
}

async function handleProfanity(message, db, guildId) {
    await message.delete().catch(() => {});
    
    if (!db[guildId].users) db[guildId].users = {};
    if (!db[guildId].users[message.author.id]) {
        db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };
    }
    
    let userData = db[guildId].users[message.author.id];
    const currentKufur = userData.kufurUyari ? userData.kufurUyari : 0;
    userData.kufurUyari = currentKufur + 1;
    saveDB(db);

    if (userData.kufurUyari < 3) {
        message.channel.send(`<@${message.author.id}>, LÃ¼tfen Ã¼slubumuza dikkat edelim, sunucuda kÃ¼fÃ¼r ve argo yasaktÄ±r. (**${userData.kufurUyari}/3 UyarÄ±**)`).then(m => setTimeout(() => m.delete().catch(() => {}), 6000));
        sendLog(message.guild, 'logCeza', {
            title: 'âš ï¸ KÃ¼fÃ¼r/Argo UyarÄ±sÄ±',
            desc: `**KullanÄ±cÄ±:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**UyarÄ± SayÄ±sÄ±:** ${userData.kufurUyari}/3\n**Silinen Ä°Ã§erik:** ${message.content}`,
            color: 0xfee75c
        });
    } else {
        userData.kufurUyari = 0;
        saveDB(db);
        await applyJail(message.member, message.guild, "KÃ¼fÃ¼r / Hakaret (3. Ä°hlal)");
    }
}

setInterval(() => {
    const db = getDB();
    const now = Date.now();
    let updated = false;

    client.guilds.cache.forEach(async guild => {
        if (!db[guild.id] || !db[guild.id].users) return;
        const jailRoleId = db[guild.id].jailRol;

        for (const userId in db[guild.id].users) {
            let user = db[guild.id].users[userId];
            if (user.jailExpire && now >= user.jailExpire) {
                user.jailExpire = null;
                updated = true;
                if (jailRoleId) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        member.roles.remove(jailRoleId).catch(() => {});
                        sendLog(guild, 'logCeza', {
                            title: 'ğŸ”“ Tahliye Edildi',
                            desc: `**VatandaÅŸ:** <@${member.id}>\nKullanÄ±cÄ±nÄ±n timeout sÃ¼resi doldu ve eriÅŸimi geri aÃ§Ä±ldÄ±.`,
                            color: 0x57f287
                        });
                    }
                }
            }
        }
    });
    if (updated) saveDB(db);
}, 60000);

client.once('ready', async () => {
    console.log(`ğŸ¤– Sistem aktif! ${client.user.tag} giriÅŸ yaptÄ±.`);
    
    if (process.env.GEMINI_API_KEY) {
        console.log("âœ… Yapay Zeka (Gemini 3.8 Flash) baÅŸarÄ±yla baÄŸlandÄ±!");
    } else {
        console.log("âŒ DÄ°KKAT: GEMINI_API_KEY bulunamadÄ±!");
    }

    client.guilds.cache.forEach(async guild => {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(firstInvites.map(inv => [inv.code, inv.uses])));
        } catch (e) {}
    });

    const commands = [
        {
            name: 'ayar',
            description: 'Botun temel sistem ve kural ayarlarÄ±nÄ± yapar (Sadece YÃ¶neticiler).',
            options: [
                { name: 'yetkili-rol', type: 8, description: 'Botu yÃ¶netecek makam yetkilisi (Ã–rn: ModeratÃ¶r)' },
                { name: 'muaf-rol', type: 8, description: 'Ceza iÅŸlemlerinden muaf tutulacak rol (@rol)' },
                { name: 'jail-rol', type: 8, description: 'Timeout (Hapis) alanlara verilecek rol (@rol)' },
                { name: 'sicil-rol', type: 8, description: 'Sicili kirlenenlere verilecek mÃ¼hÃ¼rlÃ¼ rol (@rol)' },
                { name: 'kick-bot', type: 6, description: 'Duyurusu yakalanacak Kick botu (@bot)' },
                { name: 'kick-kanal', type: 7, description: 'YayÄ±ndayÄ±z duyurusunun yapÄ±lacaÄŸÄ± kanal (#kanal)' },
                { name: 'ai-kanal', type: 7, description: 'Memur HÃ¼snÃ¼ (AI) ile sohbet edilecek kanal (#kanal)' },
                { name: 'link-engel', type: 5, description: 'Link paylaÅŸÄ±mÄ± yasaklansÄ±n mÄ±? (True/False)' },
                { name: 'kufur-engel', type: 5, description: 'KÃ¼fÃ¼r filtresi ve 3 uyarÄ±lÄ± ceza sistemi (True/False)' },
                { name: 'oto-cevap', type: 5, description: 'Memur vatandaÅŸlarla sohbet etsin mi? (True/False)' }
            ]
        },
        {
            name: 'log',
            description: 'Ultra detaylÄ± log kanallarÄ±nÄ± kategorilere gÃ¶re ayarlar (Sadece YÃ¶neticiler).',
            options: [
                { name: 'ceza', type: 7, description: 'Adli Sicil: Hapis, Af, UyarÄ±, Ban, Kick, Timeout loglarÄ± (#kanal)' },
                { name: 'mesaj', type: 7, description: 'Ä°letiÅŸim: Silinen, dÃ¼zenlenen mesajlar, Pin ve Ghost Ping loglarÄ± (#kanal)' },
                { name: 'ses', type: 7, description: 'ToplantÄ±: Ses giriÅŸ-Ã§Ä±kÄ±ÅŸ, kamera, yayÄ±n, saÄŸÄ±rlaÅŸtÄ±rma/susturma loglarÄ± (#kanal)' },
                { name: 'uye', type: 7, description: 'NÃ¼fus: KatÄ±lan (Davet detaylÄ±), ayrÄ±lan, rol, isim, avatar ve Boost loglarÄ± (#kanal)' },
                { name: 'sunucu', type: 7, description: 'Ä°dari: Kanal, rol, alt baÅŸlÄ±k (thread), emoji, sticker ve sunucu ayar loglarÄ± (#kanal)' },
                { name: 'guvenlik', type: 7, description: 'Ä°stihbarat: Webhook, yeni eklenen botlar ve davet linki loglarÄ± (#kanal)' }
            ]
        },
        { name: 'info', description: 'Kurum istatistiklerini, kural ve log kanalÄ± ayarlarÄ±nÄ± gÃ¶sterir.' },
        {
            name: 'af',
            description: 'KiÅŸinin veya herkesin sicilini temizler (Dava DÃ¼ÅŸÃ¼rÃ¼r).',
            options: [{ name: 'kullanici', type: 6, description: 'Sicili temizlenecek kiÅŸi (BoÅŸ bÄ±rakÄ±lÄ±rsa herkesi affeder)' }]
        },
        {
            name: 'hapis',
            description: 'KullanÄ±cÄ±yÄ± manuel olarak uzaklaÅŸtÄ±rÄ±r (SÃ¼re & Sebep).',
            options: [
                { name: 'kullanici', type: 6, description: 'UzaklaÅŸtÄ±rÄ±lacak kiÅŸi', required: true },
                { name: 'sayi', type: 4, description: 'Ceza sÃ¼resi (SayÄ±)', required: true },
                { name: 'kavram', type: 3, description: 'SÃ¼re birimi', required: true, choices: [
                    { name: 'Saniye', value: 'saniye' },
                    { name: 'Dakika', value: 'dakika' },
                    { name: 'Saat', value: 'saat' },
                    { name: 'GÃ¼n', value: 'gun' }
                ]},
                { name: 'sebep', type: 3, description: 'Ä°ÅŸlem sebebi', required: true }
            ]
        },
        {
            name: 'yaz',
            description: 'Bot adÄ±na bir metin yazdÄ±rÄ±rsÄ±nÄ±z.',
            options: [{ name: 'mesaj', type: 3, description: 'YazdÄ±rÄ±lacak metin', required: true }]
        },
        {
            name: 'sil',
            description: 'Belirtilen miktarda mesajÄ± siler.',
            options: [{ name: 'miktar', type: 4, description: 'Silinecek mesaj sayÄ±sÄ± (1-100)', required: true }]
        }
    ];

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands).catch(() => {});
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const db = getDB();
    const guildId = interaction.guildId;
    const isYetkili = db[guildId] && db[guildId].yetkiliRol && interaction.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === 'ayar') {
        if (!isAdmin) return interaction.reply({ content: 'âŒ Bu iÅŸlemi sadece Kurum MÃ¼dÃ¼rleri (YÃ¶neticiler) yapabilir.', ephemeral: true });
        if (!db[guildId]) db[guildId] = { users: {} };
        
        const opts = ['yetkili-rol', 'muaf-rol', 'jail-rol', 'sicil-rol', 'kick-bot', 'kick-kanal', 'ai-kanal'];
        opts.forEach(opt => {
            const val = interaction.options.get(opt);
            if (val) db[guildId][opt.replace(/-([a-z])/g, g => g[1].toUpperCase())] = val.value;
        });
        
        const linkEngel = interaction.options.getBoolean('link-engel');
        if (linkEngel !== null) db[guildId].linkEngel = linkEngel;
        
        const kufurEngel = interaction.options.getBoolean('kufur-engel');
        if (kufurEngel !== null) db[guildId].kufurEngel = kufurEngel;
        
        const otoCevap = interaction.options.getBoolean('oto-cevap');
        if (otoCevap !== null) db[guildId].otoCevap = otoCevap;
        
        saveDB(db);
        return interaction.reply({ content: 'âœ… Kurum sistem ayarlarÄ± baÅŸarÄ±yla kaydedildi!', ephemeral: true });
    }

    if (interaction.commandName === 'log') {
        if (!isAdmin) return interaction.reply({ content: 'âŒ Log kanallarÄ±nÄ± sadece YÃ¶neticiler ayarlayabilir.', ephemeral: true });
        if (!db[guildId]) db[guildId] = { users: {} };

        const logMap = {
            'ceza': 'logCeza',
            'mesaj': 'logMesaj',
            'ses': 'logSes',
            'uye': 'logUye',
            'sunucu': 'logSunucu',
            'guvenlik': 'logGuvenlik'
        };

        let degisenler = [];
        for (const [optName, dbKey] of Object.entries(logMap)) {
            const ch = interaction.options.getChannel(optName);
            if (ch) {
                db[guildId][dbKey] = ch.id;
                degisenler.push(`**${optName.toUpperCase()}** â” <#${ch.id}>`);
            }
        }

        if (degisenler.length === 0) {
            return interaction.reply({ content: 'âš ï¸ LÃ¼tfen en az bir log kategorisi seÃ§ip kanal etiketleyin.', ephemeral: true });
        }

        saveDB(db);
        return interaction.reply({ content: `âœ… **Log KanallarÄ± GÃ¼ncellendi:**\n${degisenler.join('\n')}`, ephemeral: true });
    }

    if (['info', 'yaz', 'sil', 'af', 'hapis'].includes(interaction.commandName)) {
        if (!isAdmin && !isYetkili) return interaction.reply({ content: 'âŒ Bu komutu kullanma yetkiniz bulunmamaktadÄ±r.', ephemeral: true });

        if (interaction.commandName === 'info') {
            const guildDb = db[guildId] ? db[guildId] : {};
            const getRole = (id) => id ? `<@&${id}>` : 'âŒ AtanmamÄ±ÅŸ';
            const getChannel = (id) => id ? `<#${id}>` : 'âŒ AtanmamÄ±ÅŸ';
            const getUser = (id) => id ? `<@${id}>` : 'âŒ AtanmamÄ±ÅŸ';

            const embed = new EmbedBuilder()
                .setTitle(`ğŸ›ï¸ ${interaction.guild.name} - Sistem ve Log Paneli`)
                .setColor(0x2b2d31)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: 'ğŸ“Œ NÃ¼fus', value: `ğŸ‘¥ Ãœye SayÄ±sÄ±: **${interaction.guild.memberCount}**`, inline: false },
                    { name: 'âš™ï¸ Rol AyarlarÄ±', value: `ğŸ‘‘ Yetkili: ${getRole(guildDb.yetkiliRol)}\nğŸ›¡ï¸ Muaf: ${getRole(guildDb.muafRol)}\nğŸš” Hapis (Jail): ${getRole(guildDb.jailRol)}\nğŸ“œ Sicilli: ${getRole(guildDb.sicilRol)}`, inline: true },
                    { name: 'ğŸ¤– Ã–zel Kanallar', value: `ğŸ’¬ AI DanÄ±ÅŸma: ${getChannel(guildDb.aiKanal)}\nğŸ¥ YayÄ±n Duyuru: ${getChannel(guildDb.kickKanal)}\nğŸ¤– Kick Bot: ${getUser(guildDb.kickBot)}`, inline: true },
                    { name: 'ğŸ“‚ Log KanallarÄ± (/log)', value: `ğŸ”¨ **Ceza:** ${getChannel(guildDb.logCeza)}\nğŸ’¬ **Mesaj:** ${getChannel(guildDb.logMesaj)}\nğŸ”Š **Ses:** ${getChannel(guildDb.logSes)}\nğŸ‘¤ **Ãœye:** ${getChannel(guildDb.logUye)}\nğŸ¢ **Sunucu:** ${getChannel(guildDb.logSunucu)}\nğŸ›¡ï¸ **GÃ¼venlik:** ${getChannel(guildDb.logGuvenlik)}`, inline: false },
                    { name: 'ğŸ›¡ï¸ Kurallar', value: `ğŸ”— Link Engeli: **${guildDb.linkEngel ? 'âœ… Aktif' : 'âŒ KapalÄ±'}** | ğŸ¤¬ KÃ¼fÃ¼r Engeli: **${guildDb.kufurEngel ? 'âœ… Aktif' : 'âŒ KapalÄ±'}** | ğŸ’¬ Oto-Sohbet: **${guildDb.otoCevap !== false ? 'âœ… Aktif' : 'âŒ KapalÄ±'}**`, inline: false }
                ).setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'hapis') {
            const user = interaction.options.getUser('kullanici');
            const sayi = interaction.options.getInteger('sayi');
            const kavram = interaction.options.getString('kavram');
            const sebep = interaction.options.getString('sebep');
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!member) return interaction.reply({ content: 'âŒ KullanÄ±cÄ± bulunamadÄ±.', ephemeral: true });

            let sureMs = 0;
            if (kavram === 'saniye') sureMs = sayi * 1000;
            if (kavram === 'dakika') sureMs = sayi * 60 * 1000;
            if (kavram === 'saat') sureMs = sayi * 60 * 60 * 1000;
            if (kavram === 'gun') sureMs = sayi * 24 * 60 * 60 * 1000;

            const sureDk = sureMs / (1000 * 60);

            if (!db[guildId].users) db[guildId].users = {};
            if (!db[guildId].users[user.id]) db[guildId].users[user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };

            let userData = db[guildId].users[user.id];
            userData.jailExpire = Date.now() + sureMs;
            userData.jailCount += 1;

            let sicilVerilecek = false;
            let sicilDurumMesaji = "";

            if (sureDk > 10) {
                sicilVerilecek = true;
                sicilDurumMesaji = "Ä°ÅŸlendi ğŸ“œ (10 dakikadan uzun ceza)";
            } else {
                const currentMinor = userData.minorJailCount ? userData.minorJailCount : 0;
                userData.minorJailCount = currentMinor + 1;
                if (userData.minorJailCount >= 11) {
                    sicilVerilecek = true;
                    sicilDurumMesaji = `Ä°ÅŸlendi ğŸ“œ (SÄ±nÄ±r aÅŸÄ±ldÄ±: ${userData.minorJailCount}/11)`;
                } else {
                    sicilDurumMesaji = `Temiz ğŸŸ¢ (Hafif Ä°hlal: ${userData.minorJailCount}/11)`;
                }
            }

            if (sicilVerilecek) userData.sicilli = true;
            saveDB(db);

            if (db[guildId].jailRol) await member.roles.add(db[guildId].jailRol).catch(() => {});
            if (sicilVerilecek && db[guildId].sicilRol) await member.roles.add(db[guildId].sicilRol).catch(() => {});

            sendLog(interaction.guild, 'logCeza', {
                title: 'ğŸš¨ Manuel Timeout (Hapis)',
                desc: `**Yetkili:** <@${interaction.user.id}>\n**VatandaÅŸ:** <@${user.id}>\n**SÃ¼re:** ${sayi}${kavram}\n**Sebep:** ${sebep}\n**Sicil:** ${sicilDurumMesaji}`,
                color: 0xed4245,
                thumbnail: user.displayAvatarURL()
            });

            return interaction.reply({ content: `âœ… <@${user.id}> adlÄ± kullanÄ±cÄ±ya ${sayi}${kavram} uzaklaÅŸtÄ±rma uygulandÄ±.`, ephemeral: true });
        }

        if (interaction.commandName === 'af') {
            const user = interaction.options.getUser('kullanici');
            if (!db[guildId]) return interaction.reply({ content: 'VeritabanÄ± bulunamadÄ±.', ephemeral: true });
            
            if (user) {
                if (db[guildId].users && db[guildId].users[user.id]) {
                    delete db[guildId].users[user.id];
                    saveDB(db);
                    const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
                    if(member) {
                        if(db[guildId].jailRol) member.roles.remove(db[guildId].jailRol).catch(()=>{});
                        if(db[guildId].sicilRol) member.roles.remove(db[guildId].sicilRol).catch(()=>{});
                    }
                    sendLog(interaction.guild, 'logCeza', { title: 'ğŸ•Šï¸ Sicil AffÄ± (Beraat)', desc: `**Yetkili:** <@${interaction.user.id}>\n**Affedilen:** <@${user.id}>\nKullanÄ±cÄ±nÄ±n tÃ¼m ceza ve sicil kayÄ±tlarÄ± temizlendi.`, color: 0x57f287 });
                    return interaction.reply({ content: `${user.tag} adlÄ± kullanÄ±cÄ±nÄ±n sicili temizlendi.`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `âŒ **${user.tag}** adlÄ± kullanÄ±cÄ±nÄ±n kaydÄ± zaten temiz.`, ephemeral: true });
                }
            } else {
                db[guildId].users = {};
                saveDB(db);
                sendLog(interaction.guild, 'logCeza', { title: 'ğŸ•Šï¸ Genel Af Ä°lan Edildi', desc: `**Yetkili:** <@${interaction.user.id}>\nSunucudaki **TÃœM** Ã¼yelerin ceza ve sicil kayÄ±tlarÄ± sÄ±fÄ±rlandÄ±.`, color: 0x57f287 });
                return interaction.reply({ content: 'TÃ¼m siciller sÄ±fÄ±rlandÄ±.', ephemeral: true });
            }
        }
        
        if (interaction.commandName === 'yaz') {
            const mesaj = interaction.options.getString('mesaj');
            await interaction.channel.send(mesaj);
            return interaction.reply({ content: 'Mesaj gÃ¶nderildi.', ephemeral: true });
        }

        if (interaction.commandName === 'sil') {
            const miktar = interaction.options.getInteger('miktar');
            if (miktar < 1 || miktar > 100) return interaction.reply({ content: '1 ile 100 arasÄ±nda bir sayÄ± girin.', ephemeral: true });
            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            sendLog(interaction.guild, 'logMesaj', { title: 'ğŸ§¹ Yetkili Mesaj Silme (/sil)', desc: `**Yetkili:** <@${interaction.user.id}>\n**Kanal:** <#${interaction.channel.id}>\n**Miktar:** ${miktar} adet mesaj silindi.`, color: 0xed4245 });
            return interaction.reply({ content: `${miktar} adet mesaj silindi.`, ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (!message.guild) return;
    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    if (message.author.bot && db[guildId].kickBot && db[guildId].kickKanal) {
        if (message.author.id === db[guildId].kickBot) {
            let kickLink = null;
            if (message.components && message.components.length > 0) {
                for (const row of message.components) {
                    for (const component of row.components) {
                        if (component.url && component.url.includes('kick.com')) { kickLink = component.url; break; }
                    }
                    if (kickLink) break;
                }
            }
            if (!kickLink) {
                const linkMatch = message.content.match(/(https?:\/\/kick\.com\/[^\s]+)/i);
                if (linkMatch) kickLink = linkMatch[0];
            }
            if (!kickLink && message.embeds.length > 0) {
                const embedDesc = message.embeds[0].description ? message.embeds[0].description : "";
                const embedUrl = message.embeds[0].url ? message.embeds[0].url : "";
                const embedMatch = embedDesc.match(/(https?:\/\/kick\.com\/[^\s]+)/i);
                kickLink = embedUrl.includes('kick.com') ? embedUrl : (embedMatch ? embedMatch[0] : null);
            }
            if (kickLink) {
                await message.delete().catch(() => {});
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('ğŸ”´ YayÄ±na Gel').setStyle(ButtonStyle.Link).setURL(kickLink)
                );
                const duyuruKanali = message.guild.channels.cache.get(db[guildId].kickKanal);
                if (duyuruKanali) {
                    duyuruKanali.send({ 
                        content: '@everyone ğŸŸ¢ **YayÄ±ndayÄ±z! KatÄ±lmak iÃ§in aÅŸaÄŸÄ±daki butona tÄ±kla.**', 
                        components: [row] 
                    }).catch(() => {});
                }
                return; 
            }
        }
    }

    if (message.author.bot) return;

    const isMuaf = db[guildId].muafRol && message.member.roles.cache.has(db[guildId].muafRol);
    const isYetkili = db[guildId].yetkiliRol && message.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isProtected = Boolean(isAdmin || isYetkili || isMuaf);

    if (db[guildId].kufurEngel && !isProtected) {
        if (kufurTespitEt(message.content)) {
            await handleProfanity(message, db, guildId);
            return;
        }
    }

    if (message.mentions.has(client.user) && !message.mentions.everyone && genAI) {
        const aiKanalId = db[guildId].aiKanal;
        if (aiKanalId && message.channel.id !== aiKanalId) {
            return message.reply(`Efendim, danÄ±ÅŸma iÅŸlemlerimiz sadece <#${aiKanalId}> kanalÄ±ndan yapÄ±lmaktadÄ±r. LÃ¼tfen oraya teÅŸrif edin.`).then(m => setTimeout(() => m.delete().catch(() => {}), 6000));
        }

        try {
            await message.channel.sendTyping();
            
            const model = genAI.getGenerativeModel({ 
                model: "gemini-3.8-flash", 
                systemInstruction: "Senin adÄ±n Memur HÃ¼snÃ¼. Sen son derece kibar, beyefendi, yardÄ±msever, iÅŸini severek yapan, bilgili ve gÃ¼ler yÃ¼zlÃ¼ bir devlet memurusun. Asla yapay zeka olduÄŸunu sÃ¶yleme, kendinden kÄ±demli bir danÄ±ÅŸma memuru olarak bahset.\n\nKullanÄ±cÄ±lara 'efendim', 'deÄŸerli vatandaÅŸÄ±m', 'dostum' gibi nazik hitaplar kullan. Asla huysuzluk yapma, kimseyi tersleme, 'sÄ±ra var' veya 'evraÄŸÄ±nÄ± yÄ±rtarÄ±m' gibi kaba cÃ¼mleler kurma.\n\nSana sorulan her tÃ¼rlÃ¼ soruyu (yazÄ±lÄ±m, genel kÃ¼ltÃ¼r, tavsiye, gÃ¼nlÃ¼k sohbet) en doÄŸru, anlaÅŸÄ±lÄ±r, kibar ve Ã§Ã¶zÃ¼m odaklÄ± ÅŸekilde yanÄ±tla. CevaplarÄ±n Discord'da rahat okunacak ÅŸekilde derli toplu ve Ã¶z olsun."
            });
            
            const userPrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
            
            if (userPrompt.length === 0) {
                return message.reply("Buyurun efendim, size nasÄ±l yardÄ±mcÄ± olabilirim? Sorunuzu yazabilirsiniz.");
            }

            let responseText = "";
            let success = false;
            
            for (let i = 0; i < 3; i++) {
                try {
                    const result = await model.generateContent(userPrompt);
                    responseText = result.response.text();
                    success = true;
                    break;
                } catch (err) {
                    if (err.message.includes("503") || err.message.includes("high demand")) {
                        console.log(`[UyarÄ±] Google API yoÄŸun (503). Deneme ${i + 1}/3... 2 saniye bekleniyor.`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        throw err; 
                    }
                }
            }

            if (!success) throw new Error("Google sunucularÄ± ÅŸu an tamamen kilitli (503).");
            
            await message.reply(responseText);
            return; 
        } catch (error) {
            console.log("HATA YAKALANDI: ", error.message);
            await message.reply(`Efendim, ÅŸu an sistemlerimizde geÃ§ici bir yoÄŸunluk var, evraklarÄ±nÄ±zÄ± iÅŸleme alamÄ±yorum. LÃ¼tfen birkaÃ§ dakika sonra tekrar deneyiniz.`);
            return;
        }
    }

    if (db[guildId].otoCevap !== false) {
        const lowerContent = message.content.toLocaleLowerCase('tr-TR');
        for (const ayar of otoCevaplar) {
            let eslesti = false;
            if (ayar.tetikleyiciler.includes("selam") && lowerContent.includes("aleykÃ¼m")) continue; 
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
                if (ayar.etiketle) await message.reply(rastgeleCevap).catch(() => {});
                else await message.channel.send(rastgeleCevap).catch(() => {});
                break;
            }
        }
    }

    if (isProtected) return;

    if (db[guildId].linkEngel) {
        const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels)/i.test(message.content);
        const hasLink = /(https?:\/\/[^\s]+)/g.test(message.content);
        if (hasLink && !isDiscordMedia) {
            await message.delete().catch(() => {});
            await applyJail(message.member, message.guild, "YasaklÄ± Link PaylaÅŸÄ±mÄ±");
            return; 
        }
    }

    const lettersOnly = message.content.replace(/[^a-zA-ZÄŸÃ¼ÅŸÄ±Ã¶Ã§ÄÃœÅÄ°Ã–Ã‡]/g, "");
    if (lettersOnly.length > 5) {
        const upperCount = lettersOnly.replace(/[^A-ZÄÃœÅÄ°Ã–Ã‡]/g, "").length;
        if ((upperCount / lettersOnly.length) >= 0.75) {
            await message.delete().catch(() => {});
            message.channel.send(`${message.member}, lÃ¼tfen tamamÄ± bÃ¼yÃ¼k harf (Caps Lock) olan mesajlar yazmayalÄ±m.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
            sendLog(message.guild, 'logCeza', { title: 'âš ï¸ BÃ¼yÃ¼k Harf (Caps Lock) UyarÄ±sÄ±', desc: `**KullanÄ±cÄ±:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Mesaj:** ${message.content}`, color: 0xfee75c });
        }
    }

    const now = Date.now();
    if (!spamMap.has(message.author.id)) spamMap.set(message.author.id, []);
    const userMsgs = spamMap.get(message.author.id);
    userMsgs.push(now);
    const recentMsgs = userMsgs.filter(timestamp => now - timestamp < 3000);
    spamMap.set(message.author.id, recentMsgs);

    if (recentMsgs.length >= 4) {
        spamMap.delete(message.author.id); 
        await message.channel.bulkDelete(4).catch(() => {}); 
        await applyJail(message.member, message.guild, "Spam / Flood Yapmak");
    }
});

client.on('messageDelete', async message => {
    if (!message.guild) return;
    if (message.author && message.author.bot) return;
    
    const targetId = message.author ? message.author.id : null;
    const executor = await getAuditExecutor(message.guild, AuditLogEvent.MessageDelete, targetId);
    const silenBilgisi = executor ? `<@${executor.id}> (Yetkili)` : (message.author ? `<@${message.author.id}> (Kendisi)` : 'Bilinmiyor');
    const content = message.content ? message.content : "[GÃ¶rsel veya Embed Ä°Ã§erik]";
    const attachments = message.attachments.size > 0 ? `\n**Ekler:** ${message.attachments.map(a => a.url).join('\n')}` : '';

    if (message.mentions) {
        const hasUsers = message.mentions.users.size > 0;
        const hasRoles = message.mentions.roles.size > 0;
        const hasEveryone = message.mentions.everyone;
        if (hasUsers || hasRoles || hasEveryone) {
            sendLog(message.guild, 'logMesaj', {
                title: 'ğŸ‘» Hayalet Etiket (Ghost Ping) YakalandÄ±!',
                desc: `**Atan KiÅŸi:** <@${targetId}>\n**Kanal:** <#${message.channel.id}>\n**Silinen Mesaj:**\n${content}`,
                color: 0xff0000
            });
        }
    }

    sendLog(message.guild, 'logMesaj', {
        title: 'ğŸ—‘ï¸ Mesaj Silindi',
        desc: `**Mesaj Sahibi:** ${targetId ? `<@${targetId}>` : 'Bilinmiyor'}\n**Silen KiÅŸi:** ${silenBilgisi}\n**Kanal:** <#${message.channel.id}>\n\n**Ä°Ã§erik:**\n${content}${attachments}`,
        color: 0xed4245
    });
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!oldMessage.guild) return;
    if (newMessage.author && newMessage.author.bot) return;
    
    if (!oldMessage.pinned && newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: 'ğŸ“Œ Mesaj Sabitlendi', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${newMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0x3498db });
    }
    if (oldMessage.pinned && !newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: 'ğŸ“ Mesaj Sabitlemesi KaldÄ±rÄ±ldÄ±', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${newMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0xe67e22 });
    }

    if (oldMessage.content === newMessage.content) return;

    const db = getDB();
    const guildId = newMessage.guild.id;
    if (db[guildId] && newMessage.member) {
        const isMuaf = db[guildId].muafRol && newMessage.member.roles.cache.has(db[guildId].muafRol);
        const isYetkili = db[guildId].yetkiliRol && newMessage.member.roles.cache.has(db[guildId].yetkiliRol);
        const isAdmin = newMessage.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isProtected = Boolean(isAdmin || isYetkili || isMuaf);

        if (!isProtected) {
            if (db[guildId].kufurEngel && kufurTespitEt(newMessage.content)) {
                await handleProfanity(newMessage, db, guildId);
                return;
            }
            if (db[guildId].linkEngel) {
                const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels)/i.test(newMessage.content);
                const hasLink = /(https?:\/\/[^\s]+)/g.test(newMessage.content);
                if (hasLink && !isDiscordMedia) {
                    await newMessage.delete().catch(() => {});
                    await applyJail(newMessage.member, newMessage.guild, "YasaklÄ± Link PaylaÅŸÄ±mÄ± (DÃ¼zenlenen Mesaj)");
                    return;
                }
            }
        }
    }

    const eskiIcerik = oldMessage.content ? oldMessage.content : '[BoÅŸ]';
    const yeniIcerik = newMessage.content ? newMessage.content : '[BoÅŸ]';

    sendLog(oldMessage.guild, 'logMesaj', {
        title: 'âœï¸ Mesaj DÃ¼zenlendi',
        desc: `**Yazan:** <@${newMessage.author.id}>\n**Kanal:** <#${oldMessage.channel.id}> ([Mesaja Git](${newMessage.url}))\n\n**Eski Hal:**\n${eskiIcerik}\n\n**Yeni Hal:**\n${yeniIcerik}`,
        color: 0xfee75c
    });
});

client.on('messageDeleteBulk', messages => {
    const firstMsg = messages.first();
    if (!firstMsg || !firstMsg.guild) return;
    sendLog(firstMsg.guild, 'logMesaj', {
        title: 'ğŸ§¹ Toplu Mesaj Silindi',
        desc: `**Kanal:** <#${firstMsg.channel.id}>\n**Silinen Miktar:** ${messages.size} adet mesaj.`,
        color: 0xed4245
    });
});

client.on('messageReactionRemoveAll', (message) => {
    if (!message.guild) return;
    sendLog(message.guild, 'logMesaj', {
        title: 'ğŸ§¼ Mesaj Tepkileri (Emojiler) Temizlendi',
        desc: `**Kanal:** <#${message.channel.id}>\n[Mesaja Git](${message.url})`,
        color: 0xe67e22
    });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild) return;
    if (oldState.member && oldState.member.user.bot) return;
    const member = newState.member;

    if (!oldState.channelId && newState.channelId) {
        sendLog(newState.guild, 'logSes', { title: 'ğŸ”Š Ses KanalÄ±na KatÄ±ldÄ±', desc: `**Ãœye:** <@${member.id}>\n**Kanal:** <#${newState.channelId}>`, color: 0x57f287, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId && !newState.channelId) {
        sendLog(oldState.guild, 'logSes', { title: 'ğŸ”‡ Ses KanalÄ±ndan AyrÄ±ldÄ±', desc: `**Ãœye:** <@${member.id}>\n**AyrÄ±ldÄ±ÄŸÄ± Kanal:** <#${oldState.channelId}>`, color: 0xed4245, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId !== newState.channelId) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberMove);
        const tasiyan = (executor && executor.id !== member.id) ? `\n**TaÅŸÄ±yan Yetkili:** <@${executor.id}>` : '';
        sendLog(newState.guild, 'logSes', { title: 'ğŸ”€ Ses KanalÄ± DeÄŸiÅŸtirdi', desc: `**Ãœye:** <@${member.id}>\n**Eski Kanal:** <#${oldState.channelId}>\n**Yeni Kanal:** <#${newState.channelId}>${tasiyan}`, color: 0xfee75c });
    }

    if (!oldState.serverMute && newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'ğŸ›‘ Yetkili TarafÄ±ndan Susturuldu (Server Mute)', desc: `**Ãœye:** <@${member.id}>\n**Susturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverMute && !newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'ğŸ”Š Yetkili SusturmasÄ± KaldÄ±rÄ±ldÄ±', desc: `**Ãœye:** <@${member.id}>\n**AÃ§an Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }
    if (!oldState.serverDeaf && newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'ğŸ™‰ Yetkili TarafÄ±ndan SaÄŸÄ±rlaÅŸtÄ±rÄ±ldÄ± (Server Deafen)', desc: `**Ãœye:** <@${member.id}>\n**SaÄŸÄ±rlaÅŸtÄ±ran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverDeaf && !newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: 'ğŸ‘‚ Yetkili SaÄŸÄ±rlaÅŸtÄ±rmasÄ± KaldÄ±rÄ±ldÄ±', desc: `**Ãœye:** <@${member.id}>\n**AÃ§an Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }

    if (!oldState.selfMute && newState.selfMute) sendLog(newState.guild, 'logSes', { title: 'ğŸ™ï¸ Mikrofonunu KapattÄ±', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfMute && !newState.selfMute) sendLog(newState.guild, 'logSes', { title: 'ğŸ™ï¸ Mikrofonunu AÃ§tÄ±', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });
    if (!oldState.selfDeaf && newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: 'ğŸ§ KulaklÄ±ÄŸÄ±nÄ± KapattÄ± (SaÄŸÄ±rlaÅŸtÄ±)', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfDeaf && !newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: 'ğŸ§ KulaklÄ±ÄŸÄ±nÄ± AÃ§tÄ±', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });

    if (!oldState.streaming && newState.streaming) sendLog(newState.guild, 'logSes', { title: 'ğŸ“º Ekran PaylaÅŸÄ±mÄ± BaÅŸlattÄ±', desc: `<@${member.id}>, <#${newState.channelId}> kanalÄ±nda yayÄ±n aÃ§tÄ±.`, color: 0x3498db });
    if (oldState.streaming && !newState.streaming) sendLog(newState.guild, 'logSes', { title: 'ğŸ“º Ekran PaylaÅŸÄ±mÄ±nÄ± KapattÄ±', desc: `<@${member.id}>, <#${newState.channelId}> kanalÄ±ndaki yayÄ±nÄ±nÄ± sonlandÄ±rdÄ±.`, color: 0xe67e22 });
    if (!oldState.selfVideo && newState.selfVideo) sendLog(newState.guild, 'logSes', { title: 'ğŸ“· KamerasÄ±nÄ± AÃ§tÄ±', desc: `<@${member.id}>, <#${newState.channelId}> kanalÄ±nda kamera aÃ§tÄ±.`, color: 0x3498db });
    if (oldState.selfVideo && !newState.selfVideo) sendLog(newState.guild, 'logSes', { title: 'ğŸ“· KamerasÄ±nÄ± KapattÄ±', desc: `<@${member.id}>, <#${newState.channelId}> kanalÄ±nda kamerasÄ±nÄ± kapattÄ±.`, color: 0xe67e22 });
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) {
        const executor = await getAuditExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
        return sendLog(member.guild, 'logGuvenlik', {
            title: 'ğŸ¤– Sunucuya Yeni Bir Bot Eklendi!',
            desc: `**Eklenen Bot:** <@${member.id}> (${member.user.tag})\n**Ekleyen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
            color: 0xff0000,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    let inviteMsg = "Davet eden bulunamadÄ± (Ã–zel URL veya sÃ¼resi dolmuÅŸ).";
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
            inviteMsg = `<@${usedInvite.inviter.id}> (\`${usedInvite.code}\` koduyla - Toplam **${usedInvite.uses}** kullanÄ±m)`;
        }
    } catch (e) {}

    const hesapYasi = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    sendLog(member.guild, 'logUye', {
        title: 'ğŸ“¥ Sunucuya KatÄ±ldÄ±',
        desc: `**Ãœye:** <@${member.id}> (${member.user.tag})\n**Hesap KuruluÅŸ:** ${hesapYasi} gÃ¼n Ã¶nce\n**Davet Eden:** ${inviteMsg}`,
        color: 0x57f287,
        thumbnail: member.user.displayAvatarURL()
    });
});

client.on('guildMemberRemove', async member => {
    const executor = await getAuditExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (executor) {
        return sendLog(member.guild, 'logCeza', {
            title: 'ğŸ¥¾ Sunucudan AtÄ±ldÄ± (KICK)',
            desc: `**AtÄ±lan Ãœye:** <@${member.id}> (${member.user.tag})\n**Atan Yetkili:** <@${executor.id}>`,
            color: 0xed4245,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    sendLog(member.guild, 'logUye', {
        title: 'ğŸ“¤ Sunucudan AyrÄ±ldÄ±',
        desc: `**Ãœye:** <@${member.id}> (${member.user.tag})\nSunucudan kendi isteÄŸiyle ayrÄ±ldÄ±.`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const guild = newMember.guild;

    if (!oldMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const bitis = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;
        sendLog(guild, 'logCeza', {
            title: 'â³ Zaman AÅŸÄ±mÄ± (Timeout) UygulandÄ±',
            desc: `**Ãœye:** <@${newMember.id}>\n**Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**BitiÅŸ SÃ¼resi:** ${bitis}`,
            color: 0xed4245,
            thumbnail: newMember.user.displayAvatarURL()
        });
    } else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        sendLog(guild, 'logCeza', {
            title: 'ğŸ”Š Zaman AÅŸÄ±mÄ± (Timeout) KaldÄ±rÄ±ldÄ±',
            desc: `**Ãœye:** <@${newMember.id}>\n**Ä°ÅŸlemi Yapan:** ${executor ? `<@${executor.id}>` : 'SÃ¼resi Doldu / Bilinmiyor'}`,
            color: 0x57f287
        });
    }

    if (oldMember.nickname !== newMember.nickname) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const eskiIsim = oldMember.nickname ? oldMember.nickname : oldMember.user.username;
        const yeniIsim = newMember.nickname ? newMember.nickname : newMember.user.username;
        sendLog(guild, 'logUye', {
            title: 'ğŸ‘¤ Sunucu Ä°Ã§i Ä°sim DeÄŸiÅŸtirildi',
            desc: `**Ãœye:** <@${newMember.id}>\n**DeÄŸiÅŸtiren:** ${executor ? `<@${executor.id}>` : 'Kendisi'}\n**Eski Ä°sim:** ${eskiIsim}\n**Yeni Ä°sim:** ${yeniIsim}`,
            color: 0x3498db
        });
    }

    if (oldMember.avatar !== newMember.avatar) {
        sendLog(guild, 'logUye', {
            title: 'ğŸ–¼ï¸ Sunucu Ã–zel AvatarÄ± DeÄŸiÅŸti',
            desc: `**Ãœye:** <@${newMember.id}> sunucu iÃ§i profil fotoÄŸrafÄ±nÄ± gÃ¼ncelledi.`,
            color: 0x3498db,
            thumbnail: newMember.displayAvatarURL()
        });
    }

    if (!oldMember.premiumSince && newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: 'ğŸ’ Sunucuya Takviye (Boost) YapÄ±ldÄ±!', desc: `<@${newMember.id}> sunucumuza Nitro takviyesi yaptÄ±!`, color: 0xf47fff, thumbnail: newMember.user.displayAvatarURL() });
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: 'ğŸ’” Sunucu Takviyesi (Boost) Ã‡ekildi', desc: `<@${newMember.id}> kullanÄ±cÄ±sÄ±nÄ±n sunucu takviyesi sona erdi.`, color: 0x95a5a6 });
    }

    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    
    if (addedRoles.size > 0 || removedRoles.size > 0) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        const yetkili = executor ? `<@${executor.id}>` : 'Sistem / Bilinmiyor';

        if (addedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: 'ğŸ·ï¸ Rol Verildi', desc: `**Ãœye:** <@${newMember.id}>\n**Veren Yetkili:** ${yetkili}\n**Verilen Rol:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0x57f287 });
        }
        if (removedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: 'ğŸ—‘ï¸ Rol AlÄ±ndÄ±', desc: `**Ãœye:** <@${newMember.id}>\n**Alan Yetkili:** ${yetkili}\n**AlÄ±nan Rol:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0xed4245 });
        }
    }
});

client.on('userUpdate', (oldUser, newUser) => {
    if (oldUser.bot) return;
    client.guilds.cache.forEach(guild => {
        if (!guild.members.cache.has(newUser.id)) return;
        if (oldUser.username !== newUser.username) {
            sendLog(guild, 'logUye', { title: 'ğŸŒ Discord KullanÄ±cÄ± AdÄ± DeÄŸiÅŸti', desc: `**KullanÄ±cÄ±:** <@${newUser.id}>\n**Eski AdÄ±:** ${oldUser.username}\n**Yeni AdÄ±:** ${newUser.username}`, color: 0x3498db });
        }
        if (oldUser.avatar !== newUser.avatar) {
            sendLog(guild, 'logUye', { title: 'ğŸ“¸ Discord Profil FotoÄŸrafÄ± DeÄŸiÅŸti', desc: `**KullanÄ±cÄ±:** <@${newUser.id}> genel profil fotoÄŸrafÄ±nÄ± deÄŸiÅŸtirdi.`, color: 0x3498db, thumbnail: newUser.displayAvatarURL() });
        }
    });
});

client.on('guildBanAdd', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: 'ğŸš« Sunucudan YasaklandÄ± (BAN)',
        desc: `**Yasaklanan:** ${ban.user.tag} (<@${ban.user.id}>)\n**Yasaklayan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x992d22,
        thumbnail: ban.user.displayAvatarURL()
    });
});

client.on('guildBanRemove', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: 'ğŸ•Šï¸ Yasak KaldÄ±rÄ±ldÄ± (UNBAN)',
        desc: `**KullanÄ±cÄ±:** ${ban.user.tag} (<@${ban.user.id}>)\n**YasaÄŸÄ± KaldÄ±ran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x57f287,
        thumbnail: ban.user.displayAvatarURL()
    });
});

client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: 'ğŸ“ Yeni Kanal AÃ§Ä±ldÄ±', desc: `**Kanal:** <#${channel.id}> (\`${channel.name}\`)\n**AÃ§an Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: 'ğŸ—‘ï¸ Kanal Silindi', desc: `**Silinen Kanal:** \`${channel.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldChannel.name !== newChannel.name) {
        sendLog(newChannel.guild, 'logSunucu', { title: 'âœï¸ Kanal AdÄ± DeÄŸiÅŸtirildi', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski AdÄ±:** \`${oldChannel.name}\`\n**Yeni AdÄ±:** \`${newChannel.name}\``, color: 0x3498db });
    }
    if (oldChannel.topic !== newChannel.topic) {
        const eskiTopic = oldChannel.topic ? oldChannel.topic : 'Yok';
        const yeniTopic = newChannel.topic ? newChannel.topic : 'Yok';
        sendLog(newChannel.guild, 'logSunucu', { title: 'ğŸ“ Kanal AÃ§Ä±klamasÄ± (Topic) DeÄŸiÅŸti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski:** ${eskiTopic}\n**Yeni:** ${yeniTopic}`, color: 0x3498db });
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        sendLog(newChannel.guild, 'logSunucu', { title: 'â³ Kanal YavaÅŸ Mod (Slowmode) DeÄŸiÅŸti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski SÃ¼re:** ${oldChannel.rateLimitPerUser} sn\n**Yeni SÃ¼re:** ${newChannel.rateLimitPerUser} sn`, color: 0xfee75c });
    }
});

client.on('roleCreate', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    sendLog(role.guild, 'logSunucu', { title: 'ğŸ·ï¸ Yeni Rol OluÅŸturuldu', desc: `**Rol:** <@&${role.id}> (\`${role.name}\`)\n**OluÅŸturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('roleDelete', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    sendLog(role.guild, 'logSunucu', { title: 'ğŸ—‘ï¸ Rol Silindi', desc: `**Silinen Rol:** \`${role.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldRole.name !== newRole.name) {
        sendLog(newRole.guild, 'logSunucu', { title: 'âœï¸ Rol AdÄ± DeÄŸiÅŸti', desc: `**Rol:** <@&${newRole.id}>\n**Yetkili:** ${yetkili}\n**Eski AdÄ±:** ${oldRole.name}\n**Yeni AdÄ±:** ${newRole.name}`, color: 0x3498db });
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        sendLog(newRole.guild, 'logSunucu', { title: 'âš ï¸ Rol Ä°zinleri DeÄŸiÅŸtirildi', desc: `**Rol:** <@&${newRole.id}>\n**DeÄŸiÅŸtiren Yetkili:** ${yetkili}\nRolÃ¼n yetki ayarlarÄ±yla oynandÄ±!`, color: 0xfee75c });
    }
});

client.on('threadCreate', thread => {
    sendLog(thread.guild, 'logSunucu', { title: 'ğŸ§µ Alt BaÅŸlÄ±k (Thread) AÃ§Ä±ldÄ±', desc: `**BaÅŸlÄ±k:** <#${thread.id}> (\`${thread.name}\`)\n**AÃ§an:** <@${thread.ownerId}>`, color: 0x57f287 });
});

client.on('threadDelete', thread => {
    sendLog(thread.guild, 'logSunucu', { title: 'ğŸ—‘ï¸ Alt BaÅŸlÄ±k (Thread) Silindi', desc: `**Silinen BaÅŸlÄ±k:** \`${thread.name}\``, color: 0xed4245 });
});

client.on('emojiCreate', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: 'ğŸ˜€ Emoji Eklendi', desc: `**Emoji:** ${emoji} (\`${emoji.name}\`)\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('emojiDelete', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: 'ğŸ—‘ï¸ Emoji Silindi', desc: `**Silinen Emoji:** \`${emoji.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('stickerCreate', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: 'ğŸ·ï¸ Ã‡Ä±kartma (Sticker) Eklendi', desc: `**Sticker:** \`${sticker.name}\`\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('stickerDelete', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: 'ğŸ—‘ï¸ Ã‡Ä±kartma (Sticker) Silindi', desc: `**Silinen Sticker:** \`${sticker.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const executor = await getAuditExecutor(newGuild, AuditLogEvent.GuildUpdate);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldGuild.name !== newGuild.name) {
        sendLog(newGuild, 'logSunucu', { title: 'ğŸ¢ Sunucu AdÄ± DeÄŸiÅŸtirildi', desc: `**Yetkili:** ${yetkili}\n**Eski AdÄ±:** ${oldGuild.name}\n**Yeni AdÄ±:** ${newGuild.name}`, color: 0x3498db });
    }
    if (oldGuild.icon !== newGuild.icon) {
        sendLog(newGuild, 'logSunucu', { title: 'ğŸ–¼ï¸ Sunucu Ä°konu DeÄŸiÅŸtirildi', desc: `**Yetkili:** ${yetkili}\nSunucu profil resmi gÃ¼ncellendi.`, color: 0x3498db, thumbnail: newGuild.iconURL() });
    }
});

client.on('webhookUpdate', async channel => {
    let executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookCreate);
    if (!executor) {
        executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookDelete);
    }
    sendLog(channel.guild, 'logGuvenlik', {
        title: 'ğŸš¨ Webhook Ä°ÅŸlemi Tespit Edildi!',
        desc: `**Kanal:** <#${channel.id}>\n**Ä°ÅŸlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\nKanaldaki webhook'lar oluÅŸturuldu, gÃ¼ncellendi veya silindi!`,
        color: 0xff0000
    });
});

client.on('inviteCreate', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id) ? invitesCache.get(invite.guild.id) : new Map();
    oldInvites.set(invite.code, invite.uses);
    invitesCache.set(invite.guild.id, oldInvites);

    sendLog(invite.guild, 'logGuvenlik', {
        title: 'ğŸ”— Yeni Davet Linki OluÅŸturuldu',
        desc: `**OluÅŸturan:** <@${invite.inviterId}>\n**Kanal:** <#${invite.channelId}>\n**Kod:** \`${invite.code}\`\n**Maks. KullanÄ±m:** ${invite.maxUses === 0 ? 'SÄ±nÄ±rsÄ±z' : invite.maxUses}`,
        color: 0x57f287
    });
});

client.on('inviteDelete', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id);
    if (oldInvites) oldInvites.delete(invite.code);

    sendLog(invite.guild, 'logGuvenlik', {
        title: 'ğŸ—‘ï¸ Davet Linki Silindi / SÃ¼resi Doldu',
        desc: `**Kanal:** <#${invite.channelId}>\n**Silinen Kod:** \`${invite.code}\``,
        color: 0xe67e22
    });
});

process.on('unhandledRejection', error => {
    if (error.code === 10062) return; 
    console.error('Sistem HatasÄ± (Rejection):', error);
});

process.on('uncaughtException', error => {
    console.error('Beklenmeyen Hata (Exception):', error);
});

client.login(process.env.TOKEN);
