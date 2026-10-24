const { 
    Client, GatewayIntentBits, Partials, PermissionsBitField, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, 
    AttachmentBuilder, ChannelType, AuditLogEvent 
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const serverPort = process.env.PORT ? process.env.PORT : 3000;
http.createServer((req, res) => res.end('Bot aktif.')).listen(serverPort);

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
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction]
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
const getDB = () => {
    try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } 
    catch (e) { return {}; }
};
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));

const spamMap = new Map();
const invitesCache = new Map();
const voiceTimerMap = new Map();
const statusCache = new Map();

function ensureGuildDB(db, guildId) {
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].users) db[guildId].users = {};
    if (!db[guildId].tempRooms) db[guildId].tempRooms = {};
    if (!db[guildId].tickets) db[guildId].tickets = {};
    if (!db[guildId].ticketPanels) db[guildId].ticketPanels = {};
}

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

// Tüm kanal mesajlarını 100 sınırına takılmadan çeken yardımcı fonksiyon
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
// GELİŞMİŞ KÜFÜR VE ARGO TESPİT MOTORU (ANTI-BYPASS)
// ============================================================================
function kufurTespitEt(metin) {
    if (!metin) return false;

    let text = metin.toLocaleLowerCase('tr-TR');

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

    const dedupedText = normText.replace(/(.)\1+/g, '$1');
    const wordsOnly = dedupedText.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordsArray = wordsOnly.split(' ');
    const strippedText = dedupedText.replace(/[^a-z]/g, '');

    const kelimeBazliKufurler = [
        'amk', 'amc', 'amq', 'aq', 'oc', 'oç', 'pic', 'piç', 'sik', 'sg', 'mk', 'mq',
        'got', 'göt', 'am', 'ami', 'amin', 'amina', 'aminda', 'amini', 'amcik', 'amck',
        'siki', 'sikim', 'sikin', 'sikis', 'siker', 'sikerim', 'sikeyim', 'sikik', 'siktir', 'sktr', 'siktin', 'sokuk', 'sokarim', 'sokam',
        'yarak', 'yarrak', 'yarag', 'yarrag', 'yarram', 'yaraam',
        'orspu', 'orospu', 'oruspu', 'orosbu', 'orusbu',
        'pezevenk', 'pezeveng', 'pzvnk', 'gavat', 'kaltak', 'kahpe', 'kahbe', 'kancik', 'kevase', 'kaltag',
        'ibne', 'ipne', 'top', 'puşt', 'pust', 'yavsak', 'yavşak', 'gotten', 'gotveren', 'götveren',
        'dalyarak', 'dalyarrak', 'malafat', 'taşak', 'tasak', 'tassak', 'daşak', 'dasak', 'dassak',
        'angut', 'lavuk', 'zibidi', 'haysiyetsiz', 'serefsiz', 'şerefsiz', 'namussuz', 'itoglu', 'kopekoglu',
        'anan', 'anani', 'ananin', 'bacini', 'bacinin', 'sulan', 'sulaleni', 'ecdadini', 'soyunu', 'zürriyetini'
    ];

    for (let word of wordsArray) {
        if (kelimeBazliKufurler.includes(word)) return true;
        if (/^(siktir|sikis|siker|sikey|sikim|orospu|oruspu|pezevenk|yavsak|amcik|yarrak|yarak|gotveren|kahpe|kaltak|ecdadini|sulaleni)/.test(word)) {
            return true;
        }
    }

    const ayrilmisHarfDeseni = /(?:^|\s)([a4@]\s*[m]\s*[kqv]|[a4@]\s*[q]|[o0]\s*[cç]|[p]\s*[i1!]\s*[cç]|[s5$]\s*[i1!]\s*[k])(?:\s|$)/i;
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
    { tetikleyiciler: ["as", "a.s", "aleyküm selam", "aleykümselam", "aleykum selam"], cevaplar: ["Hoş bulduk, merhaba.", "Hoş bulduk, nasıl yardımcı olabilirim?"], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["sa", "s.a", "selam", "selamun aleyküm", "sea", "selamın aleyküm"], cevaplar: ["Aleykümselam, hoş geldin.", "Selam, hoş geldin."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["günaydın", "gunaydin", "hayırlı sabahlar"], cevaplar: ["Günaydın, iyi günler.", "Günaydın, hoş geldin."], etiketle: true, tamKelime: false },
    { tetikleyiciler: ["iyi geceler", "iyi akşamlar", "iyi aksamlar", "hayırlı geceler"], cevaplar: ["İyi geceler.", "İyi akşamlar."], etiketle: false, tamKelime: false },
    { tetikleyiciler: ["hg", "hoş geldin", "hoşgeldin"], cevaplar: ["Hoş bulduk, teşekkürler.", "Teşekkür ederim."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["bb", "görüşürüz", "gorusuruz", "ben kaçar", "çıkıyorum", "allaha emanet", "baybay"], cevaplar: ["Görüşmek üzere.", "Güle güle, yine bekleriz."], etiketle: false, tamKelime: true },
    { tetikleyiciler: ["nasılsın", "naber", "nasilsin", "ne haber", "napıyorsun", "nabıyon"], cevaplar: ["İyiyim, teşekkürler. Sen nasılsın?", "Her şey yolunda, teşekkürler."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["teşekkürler", "sağ ol", "sağol", "eyvallah", "teşekkür ederim", "eyv"], cevaplar: ["Rica ederim.", "Ne demek, her zaman."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["lan", "sus", "kes", "aptal", "mal", "salak"], cevaplar: ["Lütfen üslubumuza dikkat edelim.", "Birbirimize karşı daha saygılı olalım."], etiketle: true, tamKelime: true }
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
        channel.send({ embeds: [embed], files: files }).catch(() => {});
    }
}

async function applyJail(member, guild, reason) {
    if (!member || !guild) return;
    const db = getDB();
    ensureGuildDB(db, guild.id);
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

    if (member.manageable) {
        if (db[guild.id].jailRol) await member.roles.add(db[guild.id].jailRol).catch(() => {});
        if (db[guild.id].sicilRol) await member.roles.add(db[guild.id].sicilRol).catch(() => {});
    }

    sendLog(guild, 'logCeza', {
        title: 'Otomatik Cezalandırma (Hapis)',
        desc: `**Kullanıcı:** <@${member.id}> (\`${member.id}\`)\n**Sebep:** ${reason}\n**Süre:** ${durationMins} dakika\n**Toplam İhlal:** ${userData.jailCount}\n**Sicil Durumu:** İşlendi`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
}

async function handleProfanity(message, db, guildId) {
    await message.delete().catch(() => {});
    ensureGuildDB(db, guildId);
    if (!db[guildId].users[message.author.id]) {
        db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };
    }
    
    let userData = db[guildId].users[message.author.id];
    const currentKufur = userData.kufurUyari ? userData.kufurUyari : 0;
    userData.kufurUyari = currentKufur + 1;
    saveDB(db);

    if (userData.kufurUyari < 3) {
        message.channel.send(`<@${message.author.id}>, lütfen üslubunuza dikkat edin. Sunucuda küfür ve argo kullanımı yasaktır. (**${userData.kufurUyari}/3 Uyarı**)`).then(m => setTimeout(() => m.delete().catch(() => {}), 6000));
        sendLog(message.guild, 'logCeza', {
            title: 'Küfür / Argo Uyarısı',
            desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Uyarı Sayısı:** ${userData.kufurUyari}/3\n**Silinen Mesaj:** ${message.content}`,
            color: 0xfee75c
        });
    } else {
        userData.kufurUyari = 0;
        saveDB(db);
        await applyJail(message.member, message.guild, "Küfür / Hakaret (3. İhlal)");
    }
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

// Otomatik Tahliye Döngüsü
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
                    if (member && member.manageable) {
                        member.roles.remove(jailRoleId).catch(() => {});
                        sendLog(guild, 'logCeza', {
                            title: 'Ceza Süresi Doldu',
                            desc: `**Kullanıcı:** <@${member.id}>\nKullanıcının uzaklaştırma (hapis) süresi doldu ve erişimi geri açıldı.`,
                            color: 0x57f287
                        });
                    }
                }
            }
        }
    });
    if (updated) saveDB(db);
}, 30000);

// ============================================================================
// BOT HAZIR OLDUĞUNDA, HAYALET ODA TEMİZLİĞİ VE SLASH KOMUT KURULUMU
// ============================================================================
client.once('ready', async () => {
    console.log(`Sistem aktif: ${client.user.tag} giriş yaptı.`);
    
    if (process.env.GEMINI_API_KEY) {
        console.log("Yapay Zeka (Gemini) başarıyla bağlandı.");
    }

    const db = getDB();
    let dbUpdated = false;

    for (const guild of client.guilds.cache.values()) {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(firstInvites.map(inv => [inv.code, inv.uses])));
        } catch (e) {}

        guild.voiceStates.cache.forEach(vs => {
            if (vs.channelId && vs.member && !vs.member.user.bot) {
                voiceTimerMap.set(`${guild.id}-${vs.id}`, Date.now());
            }
        });

        // Hayalet Geçici Oda Temizliği (Bot kapalıyken boşalmış odaları temizler)
        ensureGuildDB(db, guild.id);
        for (const [chId, rData] of Object.entries(db[guild.id].tempRooms)) {
            const ch = guild.channels.cache.get(chId);
            if (!ch) {
                delete db[guild.id].tempRooms[chId];
                dbUpdated = true;
            } else {
                const humanCount = ch.members.filter(m => !m.user.bot).size;
                if (humanCount === 0) {
                    delete db[guild.id].tempRooms[chId];
                    dbUpdated = true;
                    await ch.delete().catch(() => {});
                } else if (!ch.members.has(rData.ownerId) && rData.panelMsgId) {
                    const panelMsg = await ch.messages.fetch(rData.panelMsgId).catch(() => null);
                    if (panelMsg) {
                        await panelMsg.edit({
                            content: `Oda sahibi (<@${rData.ownerId}>) odadan ayrıldı. Odadaki üyelerden biri **Sahipliği Al** butonuna basarak odayı devralabilir.`,
                            embeds: [buildTempVoiceEmbed(rData)],
                            components: buildTempVoiceComponents(rData, true)
                        }).catch(() => {});
                    }
                }
            }
        }
    }

    if (dbUpdated) saveDB(db);

    const commands = [
        {
            name: 'sistem',
            description: 'Sunucu sistem, log ve ticket kurulum ayarları (Sadece Yöneticiler).',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            options: [
                {
                    name: 'ayar',
                    type: 1, // SUB_COMMAND
                    description: 'Botun temel rol, kanal ve koruma ayarlarını doğrudan yapılandırır.',
                    options: [
                        { name: 'yetkili-rol', type: 8, description: 'Moderatör / Yetkili Rolü' },
                        { name: 'muaf-rol', type: 8, description: 'Denetimden muaf tutulacak rol' },
                        { name: 'jail-rol', type: 8, description: 'Cezalı (Hapis) rolü' },
                        { name: 'sicil-rol', type: 8, description: 'Sicili bozulanlara verilecek rol' },
                        { name: 'oda-kanal', type: 7, channel_types: [ChannelType.GuildVoice], description: 'Geçici oda oluşturucu ses kanalı' },
                        { name: 'oda-kategori', type: 7, channel_types: [ChannelType.GuildCategory], description: 'Geçici ses odalarının açılacağı kategori' },
                        { name: 'ticket-kategori', type: 7, channel_types: [ChannelType.GuildCategory], description: 'Destek (Ticket) kanallarının açılacağı varsayılan kategori' },
                        { name: 'ai-kanal', type: 7, channel_types: [ChannelType.GuildText], description: 'Yapay zeka (AI) sohbet kanalı' },
                        { name: 'kick-kanal', type: 7, channel_types: [ChannelType.GuildText], description: 'Yayın duyurusunun yapılacağı kanal' },
                        { name: 'kick-bot', type: 6, description: 'Duyurusu yakalanacak Kick botu' },
                        { name: 'link-engel', type: 5, description: 'Link paylaşım engeli (True/False)' },
                        { name: 'kufur-engel', type: 5, description: 'Küfür filtresi ve 3 uyarılı ceza sistemi (True/False)' },
                        { name: 'oto-cevap', type: 5, description: 'Otomatik selamlama sistemi (True/False)' }
                    ]
                },
                {
                    name: 'log',
                    type: 1, // SUB_COMMAND
                    description: '6 kategorili detaylı log kanallarını doğrudan ayarlar.',
                    options: [
                        { name: 'ceza', type: 7, channel_types: [ChannelType.GuildText], description: 'Ceza: Hapis, Af, Uyarı, Ban, Kick, Timeout kayıtları' },
                        { name: 'mesaj', type: 7, channel_types: [ChannelType.GuildText], description: 'Mesaj: Silinen (Medya kurtarmalı), düzenlenen, Pin, Ticket ve Ghost Ping' },
                        { name: 'ses', type: 7, channel_types: [ChannelType.GuildText], description: 'Ses: Giriş-çıkış (Süre hesaplı), kamera, yayın, susturma kayıtları' },
                        { name: 'uye', type: 7, channel_types: [ChannelType.GuildText], description: 'Üye: Giriş-çıkış, rol, isim, avatar, durum (status) ve Boost' },
                        { name: 'sunucu', type: 7, channel_types: [ChannelType.GuildText], description: 'Sunucu: Kanal, rol (Kritik yetki uyarılı), alt başlık, emoji, çıkartma' },
                        { name: 'guvenlik', type: 7, channel_types: [ChannelType.GuildText], description: 'Güvenlik: Yeni hesap alarmı (<15 gün), Fake davet, Webhook ve Bot ekleme' }
                    ]
                },
                {
                    name: 'ticket-kur',
                    type: 1, // SUB_COMMAND
                    description: 'Seçilen kanala özelleştirilebilir mesajlı bağımsız bir Ticket paneli kurar.',
                    options: [
                        { name: 'kanal', type: 7, channel_types: [ChannelType.GuildText], description: 'Ticket panelinin gönderileceği metin kanalı', required: true },
                        { name: 'kategori', type: 7, channel_types: [ChannelType.GuildCategory], description: 'Bu panelden açılan taleplerin oluşturulacağı kategori', required: false },
                        { name: 'panel-baslik', type: 3, description: 'Panel başlığı (Boş bırakılırsa form penceresi açılır)', required: false },
                        { name: 'panel-aciklama', type: 3, description: 'Panel üzerinde yazacak açıklama metni', required: false },
                        { name: 'buton-yazisi', type: 3, description: 'Butonun üzerindeki yazı (Örn: Talep Oluştur / Başvuru Yap)', required: false },
                        { name: 'bilet-ici-mesaj', type: 3, description: 'Kullanıcı ticket açtığında kanalın içine gönderilecek karşılama mesajı', required: false }
                    ]
                },
                {
                    name: 'info',
                    type: 1, // SUB_COMMAND
                    description: 'Sunucu istatistiklerini, aktif kuralları ve log kanalı ayarlarını gösterir.'
                }
            ]
        },
        {
            name: 'hapis',
            description: 'Kullanıcıyı belirtilen süreyle cezalıya (hapis) atar.',
            options: [
                { name: 'kullanici', type: 6, description: 'Cezalandırılacak kullanıcı', required: true },
                { name: 'sure', type: 4, description: 'Ceza süresi (Sayı)', required: true },
                { name: 'birim', type: 3, description: 'Süre birimi', required: true, choices: [
                    { name: 'Saniye', value: 'saniye' },
                    { name: 'Dakika', value: 'dakika' },
                    { name: 'Saat', value: 'saat' },
                    { name: 'Gün', value: 'gun' }
                ]},
                { name: 'sebep', type: 3, description: 'Ceza sebebi', required: true }
            ]
        },
        {
            name: 'af',
            description: 'Kullanıcının veya tüm sunucunun ceza ve sicil kaydını temizler.',
            options: [
                { name: 'kullanici', type: 6, description: 'Affedilecek kullanıcı (Boş bırakılırsa tüm sunucuya genel af uygulanır)', required: false }
            ]
        },
        {
            name: 'sil',
            description: 'Kanaldaki mesajları toplu olarak siler.',
            options: [
                { name: 'miktar', type: 4, description: 'Silinecek mesaj sayısı (1-100)', required: true }
            ]
        },
        {
            name: 'yaz',
            description: 'Bot üzerinden kanala mesaj gönderir.',
            options: [
                { name: 'mesaj', type: 3, description: 'Gönderilecek metin', required: true }
            ]
        }
    ];

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands).catch(() => {});
    }
});

// ============================================================================
// INTERACTION (KOMUT, MENÜ, BUTON VE MODAL) YÖNETİMİ
// ============================================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.guild) return;
    const db = getDB();
    const guildId = interaction.guildId;
    ensureGuildDB(db, guildId);

    const isYetkili = db[guildId].yetkiliRol && interaction.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    // ------------------------------------------------------------------------
    // 1. SLASH KOMUTLARI (/sistem, /hapis, /af, /sil, /yaz)
    // ------------------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // === /SİSTEM KOMUTU (AYAR, LOG, TICKET-KUR, INFO) ===
        if (commandName === 'sistem') {
            if (!isAdmin) return interaction.reply({ content: 'Bu komutu sadece Sunucu Yöneticileri kullanabilir.', ephemeral: true });
            const subCommand = interaction.options.getSubcommand();

            if (subCommand === 'ayar') {
                const opts = [
                    'yetkili-rol', 'muaf-rol', 'jail-rol', 'sicil-rol', 
                    'kick-bot', 'kick-kanal', 'ai-kanal', 
                    'oda-kanal', 'oda-kategori', 'ticket-kategori'
                ];
                let degisenler = [];

                opts.forEach(opt => {
                    const val = interaction.options.get(opt);
                    if (val) {
                        const dbKey = opt.replace(/-([a-z])/g, g => g[1].toUpperCase());
                        db[guildId][dbKey] = val.value;
                        degisenler.push(`**${opt}** güncellendi.`);
                    }
                });

                const linkEngel = interaction.options.getBoolean('link-engel');
                if (linkEngel !== null) { db[guildId].linkEngel = linkEngel; degisenler.push(`**link-engel:** ${linkEngel ? 'Açık' : 'Kapalı'}`); }

                const kufurEngel = interaction.options.getBoolean('kufur-engel');
                if (kufurEngel !== null) { db[guildId].kufurEngel = kufurEngel; degisenler.push(`**kufur-engel:** ${kufurEngel ? 'Açık' : 'Kapalı'}`); }

                const otoCevap = interaction.options.getBoolean('oto-cevap');
                if (otoCevap !== null) { db[guildId].otoCevap = otoCevap; degisenler.push(`**oto-cevap:** ${otoCevap ? 'Açık' : 'Kapalı'}`); }

                if (degisenler.length === 0) {
                    return interaction.reply({ content: 'Lütfen değiştirmek istediğiniz en az bir ayarı seçin.', ephemeral: true });
                }

                saveDB(db);
                return interaction.reply({ content: `Sistem ayarları kaydedildi:\n${degisenler.join('\n')}`, ephemeral: true });
            }

            if (subCommand === 'log') {
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
                        degisenler.push(`**${optName.toUpperCase()} Log** -> <#${ch.id}>`);
                    }
                }

                if (degisenler.length === 0) {
                    return interaction.reply({ content: 'Lütfen en az bir log kategorisi seçin.', ephemeral: true });
                }

                saveDB(db);
                return interaction.reply({ content: `Log kanalları güncellendi:\n${degisenler.join('\n')}`, ephemeral: true });
            }

            if (subCommand === 'ticket-kur') {
                const targetChannel = interaction.options.getChannel('kanal');
                const customCat = interaction.options.getChannel('kategori');
                const catId = customCat ? customCat.id : (db[guildId].ticketKategori || 'none');

                const pBaslik = interaction.options.getString('panel-baslik');
                const pAciklama = interaction.options.getString('panel-aciklama');
                const pButon = interaction.options.getString('buton-yazisi');
                const pIcMesaj = interaction.options.getString('bilet-ici-mesaj');

                // Eğer yönetici metin kutularını boş bırakıp sadece kanal/kategori seçtiyse, rahat yazması için Form (Modal) açılır
                if (!pBaslik && !pAciklama && !pButon && !pIcMesaj) {
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_ticket_kur_${targetChannel.id}_${catId}`)
                        .setTitle('Ticket Paneli ve Mesaj Kurulumu');

                    const titleInput = new TextInputBuilder()
                        .setCustomId('t_baslik')
                        .setLabel('Panel Başlığı')
                        .setValue('Destek ve Başvuru Merkezi')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const descInput = new TextInputBuilder()
                        .setCustomId('t_aciklama')
                        .setLabel('Panel Açıklaması (Kanalda görünecek metin)')
                        .setValue('Yetkililerle iletişime geçmek, başvuruda bulunmak veya destek almak için aşağıdaki butona tıklayabilirsiniz.')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true);

                    const btnInput = new TextInputBuilder()
                        .setCustomId('t_buton')
                        .setLabel('Buton Üzerindeki Yazı')
                        .setValue('Talep Oluştur')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const welcomeInput = new TextInputBuilder()
                        .setCustomId('t_ic_mesaj')
                        .setLabel('Ticket Açıldığında İçeride Yazacak Mesaj')
                        .setValue('Talebiniz oluşturuldu. Lütfen konuyu detaylı bir şekilde buraya yazın, yetkililer en kısa sürede sizinle ilgilenecektir.')
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

                // Eğer komut üzerinden parametreler girildiyse doğrudan kurar
                const panelId = Date.now().toString(36);
                const finalBaslik = pBaslik || 'Destek ve Başvuru Merkezi';
                const finalAciklama = pAciklama || 'Yetkililerle iletişime geçmek, başvuruda bulunmak veya destek almak için aşağıdaki butona tıklayabilirsiniz.';
                const finalButon = pButon || 'Talep Oluştur';
                const finalIcMesaj = pIcMesaj || 'Talebiniz oluşturuldu. Lütfen konuyu detaylı bir şekilde buraya yazın, yetkililer en kısa sürede sizinle ilgilenecektir.';

                db[guildId].ticketPanels[panelId] = {
                    catId: catId,
                    title: finalBaslik,
                    welcomeMsg: finalIcMesaj
                };
                saveDB(db);

                const embed = new EmbedBuilder()
                    .setTitle(finalBaslik)
                    .setDescription(finalAciklama)
                    .setColor(0x2b2d31)
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_create_${panelId}`)
                        .setLabel(finalButon)
                        .setStyle(ButtonStyle.Primary)
                );

                await targetChannel.send({ embeds: [embed], components: [row] });
                return interaction.reply({ content: `Ticket paneli <#${targetChannel.id}> kanalına başarıyla kuruldu.`, ephemeral: true });
            }

            if (subCommand === 'info') {
                const guildDb = db[guildId] ? db[guildId] : {};
                const getRole = (id) => id ? `<@&${id}>` : 'Atanmamış';
                const getCh = (id) => id ? `<#${id}>` : 'Atanmamış';
                const getUser = (id) => id ? `<@${id}>` : 'Atanmamış';

                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.guild.name} - Sistem Durum Özeti`)
                    .setColor(0x2b2d31)
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .addFields(
                        { name: 'Sunucu Bilgisi', value: `Üye Sayısı: **${interaction.guild.memberCount}**`, inline: false },
                        { name: 'Rol Ayarları', value: `Yetkili: ${getRole(guildDb.yetkiliRol)}\nMuaf: ${getRole(guildDb.muafRol)}\nCezalı (Jail): ${getRole(guildDb.jailRol)}\nSicilli: ${getRole(guildDb.sicilRol)}`, inline: true },
                        { name: 'Özel Kanallar', value: `AI Kanalı: ${getCh(guildDb.aiKanal)}\nYayın Duyuru: ${getCh(guildDb.kickKanal)}\nKick Bot: ${getUser(guildDb.kickBot)}\nOda Oluştur: ${getCh(guildDb.odaKanal)}\nOda Kategori: ${getCh(guildDb.odaKategori)}\nTicket Kategori: ${getCh(guildDb.ticketKategori)}`, inline: true },
                        { name: 'Log Kanalları', value: `**Ceza:** ${getCh(guildDb.logCeza)}\n**Mesaj:** ${getCh(guildDb.logMesaj)}\n**Ses:** ${getCh(guildDb.logSes)}\n**Üye:** ${getCh(guildDb.logUye)}\n**Sunucu:** ${getCh(guildDb.logSunucu)}\n**Güvenlik:** ${getCh(guildDb.logGuvenlik)}`, inline: false },
                        { name: 'Koruma Filtreleri', value: `Link Engeli: **${guildDb.linkEngel ? 'Aktif' : 'Kapalı'}** | Küfür Engeli: **${guildDb.kufurEngel ? 'Aktif' : 'Kapalı'}** | Oto-Cevap: **${guildDb.otoCevap !== false ? 'Aktif' : 'Kapalı'}**`, inline: false }
                    )
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }

        // === DOĞRUDAN MODERASYON KOMUTLARI (/hapis, /af, /sil, /yaz) ===
        if (['hapis', 'af', 'sil', 'yaz'].includes(commandName)) {
            if (!isAdmin && !isYetkili) return interaction.reply({ content: 'Bu komutu kullanma yetkiniz bulunmamaktadır.', ephemeral: true });

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

                if (!db[guildId].users[user.id]) db[guildId].users[user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };

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

                if (db[guildId].jailRol) await member.roles.add(db[guildId].jailRol).catch(() => {});
                if (sicilVerilecek && db[guildId].sicilRol) await member.roles.add(db[guildId].sicilRol).catch(() => {});

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
                            if (db[guildId].jailRol) member.roles.remove(db[guildId].jailRol).catch(() => {});
                            if (db[guildId].sicilRol) member.roles.remove(db[guildId].sicilRol).catch(() => {});
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

            if (commandName === 'yaz') {
                const mesaj = interaction.options.getString('mesaj');
                await interaction.channel.send(mesaj);
                return interaction.reply({ content: 'Mesaj gönderildi.', ephemeral: true });
            }
        }
    }

    // ------------------------------------------------------------------------
    // 2. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ (TEMP VC GİZLİLİK)
    // ------------------------------------------------------------------------
    if (interaction.isStringSelectMenu()) {
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
                await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }).catch(() => {});
            } else if (choice === 'unlock') {
                roomData.locked = false;
                await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true }).catch(() => {});
            } else if (choice === 'invisible') {
                roomData.hidden = true;
                await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(() => {});
            } else if (choice === 'visible') {
                roomData.hidden = false;
                await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true }).catch(() => {});
            } else if (choice === 'close_chat') {
                roomData.chatClosed = true;
                await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false }).catch(() => {});
            } else if (choice === 'open_chat') {
                roomData.chatClosed = false;
                await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: true }).catch(() => {});
            }

            saveDB(db);
            return interaction.update({ 
                embeds: [buildTempVoiceEmbed(roomData)], 
                components: buildTempVoiceComponents(roomData, false) 
            });
        }
    }

    // ------------------------------------------------------------------------
    // 3. BUTON ETKİLEŞİMLERİ (TEMP VC & ÇOKLU TICKET)
    // ------------------------------------------------------------------------
    if (interaction.isButton()) {
        const customId = interaction.customId;

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
                }).catch(() => {});

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
                await channel.delete().catch(() => {});
                return;
            }
        }

        // --- TICKET (DESTEK) BUTONLARI ---
        if (customId.startsWith('ticket_')) {
            if (customId.startsWith('ticket_create_')) {
                const panelKey = customId.replace('ticket_create_', '');
                const panelConfig = db[guildId].ticketPanels ? db[guildId].ticketPanels[panelKey] : null;

                let customCatId = null;
                let welcomeMsg = 'Talebiniz oluşturuldu. Lütfen konuyu detaylı bir şekilde buraya yazın, yetkililer en kısa sürede sizinle ilgilenecektir.';
                let panelTitle = 'Destek ve Başvuru Kanalı';

                if (panelConfig) {
                    customCatId = panelConfig.catId !== 'none' ? panelConfig.catId : (db[guildId].ticketKategori || null);
                    if (panelConfig.welcomeMsg) welcomeMsg = panelConfig.welcomeMsg;
                    if (panelConfig.title) panelTitle = panelConfig.title;
                } else {
                    customCatId = panelKey !== 'none' ? panelKey : (db[guildId].ticketKategori || null);
                }

                // Aynı kullanıcının aynı kategoride/panelde açık talebi var mı kontrol et
                const existingTicket = Object.values(db[guildId].tickets).find(t => t.ownerId === interaction.user.id && t.panelKey === panelKey);
                if (existingTicket && interaction.guild.channels.cache.has(existingTicket.channelId)) {
                    return interaction.reply({ content: `Bu birimde zaten açık bir talebiniz bulunuyor: <#${existingTicket.channelId}>`, ephemeral: true });
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
                        locked: false,
                        createdAt: Date.now()
                    };
                    saveDB(db);

                    const embed = new EmbedBuilder()
                        .setTitle(panelTitle)
                        .setDescription(`Merhaba <@${interaction.user.id}>,\n\n${welcomeMsg}`)
                        .setColor(0x2b2d31)
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_lock').setLabel('Kilitle / Aç').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('ticket_add').setLabel('Üye Ekle').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_remove').setLabel('Üye Çıkar').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('ticket_close').setLabel('Kapat ve Arşivle').setStyle(ButtonStyle.Danger)
                    );

                    const mentionText = db[guildId].yetkiliRol ? `<@${interaction.user.id}> | <@&${db[guildId].yetkiliRol}>` : `<@${interaction.user.id}>`;
                    await ticketChannel.send({ content: mentionText, embeds: [embed], components: [row] });

                    sendLog(interaction.guild, 'logSunucu', { title: 'Yeni Ticket Açıldı', desc: `**Açan Kullanıcı:** <@${interaction.user.id}>\n**Kanal:** <#${ticketChannel.id}>\n**Birim:** ${panelTitle}`, color: 0x57f287 });
                    return interaction.reply({ content: `Talebiniz oluşturuldu: <#${ticketChannel.id}>`, ephemeral: true });
                } catch (e) {
                    return interaction.reply({ content: 'Kanal oluşturulurken bir yetki veya kategori hatası oluştu.', ephemeral: true });
                }
            }

            if (!isAdmin && !isYetkili) {
                return interaction.reply({ content: 'Bu butonları sadece yetkililer kullanabilir.', ephemeral: true });
            }

            const ticketData = db[guildId].tickets[interaction.channel.id];
            if (!ticketData) return interaction.reply({ content: 'Bu kanal kayıtlı bir ticket kanalı değil.', ephemeral: true });

            if (customId === 'ticket_lock') {
                ticketData.locked = !ticketData.locked;
                saveDB(db);
                await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, { SendMessages: !ticketData.locked }).catch(() => {});
                return interaction.reply({ content: ticketData.locked ? 'Kanal kilitlendi (Kullanıcı mesaj yazamaz).' : 'Kanal kilidi açıldı.' });
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
                    `Kanal Adı      : ${interaction.channel.name}`,
                    `Talep Sahibi ID: ${ticketData.ownerId}`,
                    `Kapatan Yetkili: ${interaction.user.tag} (${interaction.user.id})`,
                    `Kapanış Tarihi : ${new Date().toLocaleString('tr-TR')}`,
                    `Toplam Mesaj   : ${sortedMessages.length}`,
                    `====================================================\n`
                ];

                for (const m of sortedMessages) {
                    const timeStr = new Date(m.createdTimestamp).toLocaleString('tr-TR');
                    const content = m.content || (m.embeds.length > 0 ? '[Sistem Paneli / Embed]' : '[Görsel / Dosya]');
                    const attachmentUrls = m.attachments.size > 0 ? ` [Ekler: ${m.attachments.map(a => a.url).join(', ')}]` : '';
                    txtLines.push(`[${timeStr}] ${m.author.tag}: ${content}${attachmentUrls}`);
                }

                const txtBuffer = Buffer.from(txtLines.join('\n'), 'utf-8');
                const attachment = new AttachmentBuilder(txtBuffer, { name: `${interaction.channel.name}-arsiv.txt` });

                sendLog(interaction.guild, 'logMesaj', {
                    title: 'Ticket Kapatıldı ve Arşivlendi',
                    desc: `**Kanal:** \`${interaction.channel.name}\`\n**Talep Sahibi:** <@${ticketData.ownerId}>\n**Kapatan Yetkili:** <@${interaction.user.id}>\n**Arşivlenen Mesaj:** ${sortedMessages.length} adet`,
                    color: 0xed4245
                }, [attachment]);

                delete db[guildId].tickets[interaction.channel.id];
                saveDB(db);

                setTimeout(() => { interaction.channel.delete().catch(() => {}); }, 3000);
            }
        }
    }

    // ------------------------------------------------------------------------
    // 4. MODAL (FORM) ETKİLEŞİMLERİ (TICKET KURULUMU & TEMP VC)
    // ------------------------------------------------------------------------
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_ticket_kur_')) {
            const parts = interaction.customId.replace('modal_ticket_kur_', '').split('_');
            const chId = parts[0];
            const catId = parts[1] || 'none';

            const targetChannel = interaction.guild.channels.cache.get(chId);
            if (!targetChannel) return interaction.reply({ content: 'Hedef kanal bulunamadı.', ephemeral: true });

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
            return interaction.reply({ content: `Ticket paneli <#${targetChannel.id}> kanalına başarıyla kuruldu.`, ephemeral: true });
        }

        if (interaction.customId === 'modal_vc_limit') {
            const val = parseInt(interaction.fields.getTextInputValue('limit_val'));
            if (isNaN(val) || val < 0 || val > 99) return interaction.reply({ content: 'Lütfen 0 ile 99 arasında geçerli bir sayı girin.', ephemeral: true });
            await interaction.channel.setUserLimit(val).catch(() => {});
            return interaction.reply({ content: `Oda kişi sınırı **${val === 0 ? 'Sınırsız' : val}** olarak ayarlandı.`, ephemeral: true });
        }

        if (interaction.customId === 'modal_vc_rename') {
            const newName = interaction.fields.getTextInputValue('name_val').trim();
            await interaction.channel.setName(newName).catch(() => {});
            return interaction.reply({ content: `Oda ismi **${newName}** olarak güncellendi.`, ephemeral: true });
        }
    }

    // ------------------------------------------------------------------------
    // 5. KULLANICI SEÇİM MENÜSÜ (USER SELECT MENU) ETKİLEŞİMLERİ
    // ------------------------------------------------------------------------
    if (interaction.isUserSelectMenu()) {
        const targetId = interaction.values[0];
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) return interaction.update({ content: 'Kullanıcı bulunamadı.', components: [] });

        const channel = interaction.channel;
        const roomData = db[guildId].tempRooms[channel.id];

        if (interaction.customId === 'select_vc_trust') {
            await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, SendMessages: true }).catch(() => {});
            return interaction.update({ content: `<@${targetId}> izinli (Trust) listesine eklendi. Oda kilitli veya gizli olsa bile girebilir.`, components: [] });
        }

        if (interaction.customId === 'select_vc_untrust') {
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
            return interaction.update({ content: `<@${targetId}> kullanıcısının özel oda izinleri kaldırıldı.`, components: [] });
        }

        if (interaction.customId === 'select_vc_block') {
            if (targetId === interaction.user.id) return interaction.update({ content: 'Kendinizi engelleyemezsiniz.', components: [] });
            if (targetMember.voice.channelId === channel.id) await targetMember.voice.disconnect().catch(() => {});
            await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false, SendMessages: false }).catch(() => {});
            return interaction.update({ content: `<@${targetId}> odadan engellendi (Block) ve bağlantısı kesildi.`, components: [] });
        }

        if (interaction.customId === 'select_vc_unblock') {
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
            return interaction.update({ content: `<@${targetId}> kullanıcısının oda engeli kaldırıldı.`, components: [] });
        }

        if (interaction.customId === 'select_vc_kick') {
            if (targetId === interaction.user.id) return interaction.update({ content: 'Kendinizi odadan atamazsınız.', components: [] });
            if (targetMember.voice.channelId !== channel.id) return interaction.update({ content: 'Bu kullanıcı şu an ses odasında değil.', components: [] });
            await targetMember.voice.disconnect().catch(() => {});
            return interaction.update({ content: `<@${targetId}> ses odasından çıkarıldı.`, components: [] });
        }

        if (interaction.customId === 'select_vc_transfer') {
            if (targetId === interaction.user.id || targetMember.user.bot) return interaction.update({ content: 'Geçersiz kullanıcı seçimi.', components: [] });
            if (!roomData) return interaction.update({ content: 'Oda verisi bulunamadı.', components: [] });

            roomData.ownerId = targetId;
            saveDB(db);

            await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, Connect: true, ViewChannel: true, SendMessages: true }).catch(() => {});

            if (roomData.panelMsgId) {
                const panelMsg = await channel.messages.fetch(roomData.panelMsgId).catch(() => null);
                if (panelMsg) {
                    await panelMsg.edit({
                        content: `Oda sahipliği <@${targetId}> kullanıcısına devredildi.`,
                        embeds: [buildTempVoiceEmbed(roomData)],
                        components: buildTempVoiceComponents(roomData, false)
                    }).catch(() => {});
                }
            }
            return interaction.update({ content: `Oda sahipliği başarıyla <@${targetId}> kullanıcısına devredildi.`, components: [] });
        }

        if (interaction.customId === 'select_ticket_add') {
            await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, SendMessages: true, AttachFiles: true, ReadMessageHistory: true }).catch(() => {});
            await interaction.update({ content: `<@${targetId}> kanala eklendi.`, components: [] });
            return channel.send(`<@${targetId}>, <@${interaction.user.id}> tarafından bu talebe eklendi.`);
        }

        if (interaction.customId === 'select_ticket_remove') {
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
            await interaction.update({ content: `<@${targetId}> kanaldan çıkarıldı.`, components: [] });
            return channel.send(`<@${targetId}>, <@${interaction.user.id}> tarafından bu talepten çıkarıldı.`);
        }
    }
});

// ============================================================================
// MESAJ DENETİMİ, KICK DUYURU, AI, OTO-CEVAP, CAPS LOCK VE SPAM KORUMASI
// ============================================================================
client.on('messageCreate', async message => {
    if (!message.guild) return;
    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    // Kick Yayın Duyuru Yakalayıcı
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
                    new ButtonBuilder().setLabel('Yayına Katıl').setStyle(ButtonStyle.Link).setURL(kickLink)
                );
                const duyuruKanali = message.guild.channels.cache.get(db[guildId].kickKanal);
                if (duyuruKanali) {
                    duyuruKanali.send({ 
                        content: '@everyone **Yayındayız! Katılmak için aşağıdaki butona tıklayın.**', 
                        components: [row] 
                    }).catch(() => {});
                }
                return; 
            }
        }
    }

    if (message.author.bot || !message.member) return;

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

    // Yapay Zeka (Standart, ciddi ve doğrudan yanıt veren asistan)
    if (message.mentions.has(client.user) && !message.mentions.everyone && genAI) {
        const aiKanalId = db[guildId].aiKanal;
        if (aiKanalId && message.channel.id !== aiKanalId) {
            return message.reply(`Yapay zeka sohbeti sadece <#${aiKanalId}> kanalında aktiftir.`).then(m => setTimeout(() => m.delete().catch(() => {}), 6000));
        }

        try {
            await message.channel.sendTyping();
            
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash", 
                systemInstruction: "Sen yardımsever, bilgili, net ve doğrudan cevaplar veren bir Discord sunucu asistanısın. Herhangi bir rol yapma (roleplay yapma). Emoji kullanma. Kullanıcılara doğal, ciddi, saygılı ve anlaşılır bir Türkçe ile yardımcı ol."
            });
            
            const userPrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
            
            if (userPrompt.length === 0) {
                return message.reply("Merhaba, nasıl yardımcı olabilirim? Sorunuzu yazabilirsiniz.");
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
                    if (err.message && (err.message.includes("503") || err.message.includes("high demand"))) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        throw err; 
                    }
                }
            }

            if (!success) throw new Error("API 503");
            
            await message.reply(responseText.slice(0, 1990));
            return; 
        } catch (error) {
            await message.reply(`Şu an yapay zeka servisinde geçici bir yoğunluk var, lütfen birazdan tekrar deneyin.`);
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
                if (ayar.etiketle) await message.reply(rastgeleCevap).catch(() => {});
                else await message.channel.send(rastgeleCevap).catch(() => {});
                break;
            }
        }
    }

    if (isProtected) return;

    // Link Koruması
    if (db[guildId].linkEngel) {
        const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels|cdn\.discordapp\.com)/i.test(message.content);
        const hasLink = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi.test(message.content);
        if (hasLink && !isDiscordMedia) {
            await message.delete().catch(() => {});
            await applyJail(message.member, message.guild, "Yasaklı Link Paylaşımı");
            return; 
        }
    }

    // Caps Lock Koruması
    const lettersOnly = message.content.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "");
    if (lettersOnly.length > 5) {
        const upperCount = lettersOnly.replace(/[^A-ZĞÜŞİÖÇ]/g, "").length;
        if ((upperCount / lettersOnly.length) >= 0.75) {
            await message.delete().catch(() => {});
            message.channel.send(`${message.member}, lütfen tamamı büyük harf (Caps Lock) içeren mesajlar yazmayalım.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
            sendLog(message.guild, 'logCeza', { title: 'Büyük Harf (Caps Lock) Uyarısı', desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Mesaj:** ${message.content}`, color: 0xfee75c });
        }
    }

    // Spam Koruması
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
                } catch (e) {}
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
                const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels|cdn\.discordapp\.com)/i.test(newMessage.content);
                const hasLink = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi.test(newMessage.content);
                if (hasLink && !isDiscordMedia) {
                    await newMessage.delete().catch(() => {});
                    await applyJail(newMessage.member, newMessage.guild, "Yasaklı Link Paylaşımı (Düzenlenen Mesaj)");
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

// 3. GEÇİCİ ODA (TEMP VC - KESİN PANEL GÖNDERİMLİ) VE SÜRE HESAPLAMALI SES LOGLARI
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild) return;
    const db = getDB();
    const guildId = newState.guild.id;
    ensureGuildDB(db, guildId);

    // GEÇİCİ ODA OLUŞTURMA
    if (db[guildId].odaKanal && db[guildId].odaKategori) {
        if (newState.channelId === db[guildId].odaKanal && newState.member && !newState.member.user.bot) {
            const member = newState.member;
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
        const oldChannel = oldState.guild.channels.cache.get(oldState.channelId);
        const roomData = db[guildId].tempRooms[oldState.channelId];

        if (oldChannel && roomData) {
            const humanMembers = oldChannel.members.filter(m => !m.user.bot);
            if (humanMembers.size === 0) {
                delete db[guildId].tempRooms[oldChannel.id];
                saveDB(db);
                await oldChannel.delete().catch(() => {});
                sendLog(oldState.guild, 'logSunucu', { title: 'Geçici Ses Odası Silindi', desc: `**Oda Adı:** \`${oldChannel.name}\` boşaldığı için otomatik silindi.`, color: 0xed4245 });
            } else if (oldState.id === roomData.ownerId) {
                if (roomData.panelMsgId) {
                    const panelMsg = await oldChannel.messages.fetch(roomData.panelMsgId).catch(() => null);
                    if (panelMsg) {
                        await panelMsg.edit({ 
                            content: `Oda sahibi (<@${roomData.ownerId}>) odadan ayrıldı. Odadaki üyelerden biri **Sahipliği Al** butonuna basarak odayı devralabilir.`, 
                            embeds: [buildTempVoiceEmbed(roomData)],
                            components: buildTempVoiceComponents(roomData, true) 
                        }).catch(() => {});
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

// 4. ÜYE GİRİŞ / ÇIKIŞ, 15 GÜNLÜK YENİ HESAP ALARMI VE FAKE DAVET TESPİTİ
client.on('guildMemberAdd', async member => {
    const db = getDB();
    const guildId = member.guild.id;
    ensureGuildDB(db, guildId);

    if (member.user.bot) {
        const executor = await getAuditExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
        return sendLog(member.guild, 'logGuvenlik', {
            title: 'Sunucuya Yeni Bir Bot Eklendi',
            desc: `**Eklenen Bot:** <@${member.id}> (${member.user.tag})\n**Ekleyen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
            color: 0xff0000,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    if (!db[guildId].users[member.id]) {
        db[guildId].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, kufurUyari: 0 };
    }
    const userData = db[guildId].users[member.id];

    if (member.manageable) {
        if (userData.jailExpire && Date.now() < userData.jailExpire && db[guildId].jailRol) {
            await member.roles.add(db[guildId].jailRol).catch(() => {});
        }
        if (userData.sicilli && db[guildId].sicilRol) {
            await member.roles.add(db[guildId].sicilRol).catch(() => {});
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
    } catch (e) {}

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

// 5. ÜYE GÜNCELLEMELERİ (İSİM, ROL, BOOST, AVATAR VE ÖZEL DURUM)
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

client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.guild || !newPresence.user || newPresence.user.bot) return;
    const customAct = newPresence.activities.find(a => a.type === 4);
    const newState = customAct && customAct.state ? customAct.state : null;
    const key = `${newPresence.guild.id}-${newPresence.user.id}`;
    const oldState = statusCache.get(key) || null;

    if (oldState !== newState) {
        statusCache.set(key, newState);
        if (newState) {
            sendLog(newPresence.guild, 'logUye', {
                title: 'Özel Durum (Custom Status) Güncellendi',
                desc: `**Kullanıcı:** <@${newPresence.user.id}>\n**Eski Durum:** ${oldState ? `\`${oldState}\`` : '*Yok*'}\n**Yeni Durum:** \`${newState}\``,
                color: 0x9b59b6
            });
        }
    }
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

client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: 'Yeni Kanal Açıldı', desc: `**Kanal:** <#${channel.id}> (\`${channel.name}\`)\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: 'Kanal Silindi', desc: `**Silinen Kanal:** \`${channel.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldChannel.name !== newChannel.name) {
        sendLog(newChannel.guild, 'logSunucu', { title: 'Kanal Adı Değiştirildi', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Adı:** \`${oldChannel.name}\`\n**Yeni Adı:** \`${newChannel.name}\``, color: 0x3498db });
    }
    if (oldChannel.topic !== newChannel.topic) {
        const eskiTopic = oldChannel.topic ? oldChannel.topic : 'Yok';
        const yeniTopic = newChannel.topic ? newChannel.topic : 'Yok';
        sendLog(newChannel.guild, 'logSunucu', { title: 'Kanal Açıklaması (Topic) Değişti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski:** ${eskiTopic}\n**Yeni:** ${yeniTopic}`, color: 0x3498db });
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        sendLog(newChannel.guild, 'logSunucu', { title: 'Kanal Yavaş Mod (Slowmode) Değişti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Süre:** ${oldChannel.rateLimitPerUser} sn\n**Yeni Süre:** ${newChannel.rateLimitPerUser} sn`, color: 0xfee75c });
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
    if (error.code === 10062) return; 
    console.error('Sistem Hatası (Rejection):', error);
});

process.on('uncaughtException', error => {
    console.error('Beklenmeyen Hata (Exception):', error);
});

client.login(process.env.TOKEN);
