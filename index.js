const { Client, GatewayIntentBits, Partials, PermissionsBitField, ActivityType } = require('discord.js');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

// Render'ın botu uyanık tutması için gereken web sunucusu
http.createServer((req, res) => res.end('Bot aktif!')).listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

// Veritabanı Fonksiyonları
const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
const getDB = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));

// Spam Algılama Haritası
const spamMap = new Map();

// --- LOG GÖNDERME YARDIMCISI ---
async function sendLog(guild, logType, messageContent) {
    const db = getDB();
    if (!db[guild.id] || !db[guild.id][logType]) return;
    const channelId = db[guild.id][logType];
    const channel = guild.channels.cache.get(channelId);
    if (channel) channel.send(messageContent).catch(() => {});
}

// --- JAIL (HAPİS) FONKSİYONU ---
async function applyJail(member, guild, reason) {
    const db = getDB();
    if (!db[guild.id]) db[guild.id] = {};
    if (!db[guild.id].users) db[guild.id].users = {};
    if (!db[guild.id].users[member.id]) db[guild.id].users[member.id] = { jailCount: 0, sicilli: false };

    let userData = db[guild.id].users[member.id];
    userData.jailCount += 1;
    userData.sicilli = true;

    const durations = [15, 30, 60, 180];
    let durationMins = durations[userData.jailCount - 1] || 180; 
    let expireTime = Date.now() + (durationMins * 60 * 1000);
    userData.jailExpire = expireTime;

    saveDB(db);

    const jailRoleId = db[guild.id].jailRol;
    const sicilRoleId = db[guild.id].sicilRol;

    if (jailRoleId) await member.roles.add(jailRoleId).catch(() => {});
    if (sicilRoleId) await member.roles.add(sicilRoleId).catch(() => {});

    sendLog(guild, 'logCeza', `🚨 **${member.user.tag}** jaile atıldı!\n**Sebep:** ${reason}\n**Süre:** ${durationMins} dakika\n**Kaçıncı İhlali:** ${userData.jailCount}`);
}

// --- OTOMATİK JAİL ÇIKIŞI KONTROLÜ ---
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
                        sendLog(guild, 'logCeza', `🔓 **${member.user.tag}** adlı kullanıcının jail süresi doldu. (Sicil rolü kalıcıdır).`);
                    }
                }
            }
        }
    });
    if (updated) saveDB(db);
}, 60000);

// --- BOT HAZIR OLDUĞUNDA ---
client.once('ready', async () => {
    console.log(`🤖 Sistem aktif! ${client.user.tag} giriş yaptı.`);
    
    // 🧹 ESKİ REPLİT HAYALETLERİNİ TEMİZLEME KODU
    await client.application.commands.set([]);
    console.log("🧹 Eski global komutlar tamamen silindi!");
    
    // Yeni Komutlarımız
    const commands = [
        {
            name: 'ayar',
            description: 'Botun temel sistemlerini ayarlar (Sadece Yöneticiler).',
            options: [
                { name: 'yetkili-rol', type: 8, description: 'Botu yönetecek yetkili rolü (@rol)' },
                { name: 'muaf-rol', type: 8, description: 'Engellerden muaf tutulacak rol (@rol)' },
                { name: 'jail-rol', type: 8, description: 'Hapse atılanlara verilecek ceza rolü (@rol)' },
                { name: 'sicil-rol', type: 8, description: 'Sicili kirli olanlara verilecek kalıcı rol (@rol)' },
                { name: 'log-ceza', type: 7, description: 'Uyarı ve ceza kayıtlarının kanalı (#kanal)' },
                { name: 'log-genel', type: 7, description: 'Genel sunucu kayıtlarının kanalı (#kanal)' },
                { name: 'log-ses', type: 7, description: 'Ses ve yayın kayıtlarının kanalı (#kanal)' },
                { name: 'link-engel', type: 5, description: 'Link engeli aktif edilsin mi? (True/False)' }
            ]
        },
        {
            name: 'af',
            description: 'Kişiyi veya herkesi affeder (Sicil ve Jail temizler).',
            options: [{ name: 'kullanici', type: 6, description: 'Affedilecek kişi (Boş bırakılırsa herkesi affeder)' }]
        },
        {
            name: 'yaz',
            description: 'Bota istediğiniz bir mesajı yazdırırsınız.',
            options: [{ name: 'mesaj', type: 3, description: 'Yazdırılacak mesaj', required: true }]
        },
        {
            name: 'sil',
            description: 'Belirtilen miktarda mesajı siler.',
            options: [{ name: 'miktar', type: 4, description: 'Silinecek mesaj sayısı (1-100)', required: true }]
        }
    ];

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands).catch(() => {});
    }
});

// --- KOMUT KULLANIMI (SLASH COMMANDS) ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const db = getDB();
    const guildId = interaction.guildId;
    const isYetkili = db[guildId]?.yetkiliRol && interaction.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === 'ayar') {
        if (!isAdmin) return interaction.reply({ content: '❌ Bunu sadece sunucu yöneticileri yapabilir.', ephemeral: true });
        
        if (!db[guildId]) db[guildId] = { users: {} };
        const opts = ['yetkili-rol', 'muaf-rol', 'jail-rol', 'sicil-rol', 'log-ceza', 'log-genel', 'log-ses'];
        opts.forEach(opt => {
            const val = interaction.options.get(opt);
            if (val) db[guildId][opt.replace(/-([a-z])/g, g => g[1].toUpperCase())] = val.value;
        });
        
        const linkEngel = interaction.options.getBoolean('link-engel');
        if (linkEngel !== null) db[guildId].linkEngel = linkEngel;
        
        saveDB(db);
        return interaction.reply({ content: '✅ Sunucu ayarları başarıyla kaydedildi!', ephemeral: true });
    }

    if (interaction.commandName === 'yaz' || interaction.commandName === 'sil' || interaction.commandName === 'af') {
        if (!isAdmin && !isYetkili) return interaction.reply({ content: '❌ Bu komutu kullanmaya yetkiniz yok.', ephemeral: true });

        if (interaction.commandName === 'yaz') {
            const mesaj = interaction.options.getString('mesaj');
            await interaction.channel.send(mesaj);
            return interaction.reply({ content: 'Mesaj gönderildi.', ephemeral: true });
        }

        if (interaction.commandName === 'sil') {
            const miktar = interaction.options.getInteger('miktar');
            if (miktar < 1 || miktar > 100) return interaction.reply({ content: '1 ile 100 arasında bir sayı girin.', ephemeral: true });
            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            return interaction.reply({ content: `${miktar} adet mesaj silindi.`, ephemeral: true });
        }

        if (interaction.commandName === 'af') {
            const user = interaction.options.getUser('kullanici');
            if (!db[guildId]) return interaction.reply({ content: 'Veritabanı bulunamadı.', ephemeral: true });
            
            if (user) {
                if (db[guildId].users && db[guildId].users[user.id]) {
                    delete db[guildId].users[user.id];
                    saveDB(db);
                    const member = await interaction.guild.members.fetch(user.id).catch(()=>{});
                    if(member) {
                        if(db[guildId].jailRol) member.roles.remove(db[guildId].jailRol).catch(()=>{});
                        if(db[guildId].sicilRol) member.roles.remove(db[guildId].sicilRol).catch(()=>{});
                    }
                    sendLog(interaction.guild, 'logCeza', `🕊️ **${user.tag}** adlı kullanıcının tüm cezaları ve sicili affedildi.`);
                    return interaction.reply({ content: `${user.tag} başarıyla affedildi.`, ephemeral: true });
                }
            } else {
                db[guildId].users = {};
                saveDB(db);
                sendLog(interaction.guild, 'logCeza', `🕊️ Sunucudaki **TÜM** cezalar ve siciller affedildi.`);
                return interaction.reply({ content: 'Tüm siciller ve hapis cezaları sıfırlandı.', ephemeral: true });
            }
        }
    }
});

// --- MESAJ DENETİMİ (Link, Caps, Flood) ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    const isMuaf = db[guildId].muafRol && message.member.roles.cache.has(db[guildId].muafRol);
    const isYetkili = db[guildId].yetkiliRol && message.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (isAdmin || isYetkili || isMuaf) return;

    // 1. LİNK ENGEL SİSTEMİ
    if (db[guildId].linkEngel) {
        const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels)/i.test(message.content);
        const hasLink = /(https?:\/\/[^\s]+)/g.test(message.content);
        
        if (hasLink && !isDiscordMedia) {
            await message.delete().catch(() => {});
            await applyJail(message.member, message.guild, "Yasaklı Link Paylaşımı");
            return; 
        }
    }

    // 2. CAPS LOCK ENGEL SİSTEMİ
    const lettersOnly = message.content.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "");
    if (lettersOnly.length > 5) {
        const upperCount = lettersOnly.replace(/[^A-ZĞÜŞİÖÇ]/g, "").length;
        if ((upperCount / lettersOnly.length) >= 0.75) {
            await message.delete().catch(() => {});
            message.channel.send(`${message.member}, lütfen büyük harf kullanımına dikkat et!`).then(m => setTimeout(() => m.delete(), 4000));
            sendLog(message.guild, 'logCeza', `⚠️ **${message.author.tag}** caps lock kullanımı nedeniyle uyarıldı.`);
        }
    }

    // 3. FLOOD VE SPAM ENGEL SİSTEMİ (3 Saniyede 4 Mesaj)
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

// --- GENEL LOGLAR VE BİLDİRİMLER ---
client.on('guildMemberAdd', member => sendLog(member.guild, 'logGenel', `📥 **${member.user.tag}** sunucuya katıldı.`));
client.on('guildMemberRemove', member => sendLog(member.guild, 'logGenel', `📤 **${member.user.tag}** sunucudan ayrıldı.`));

client.on('voiceStateUpdate', (oldState, newState) => {
    if (!oldState.channelId && newState.channelId) {
        sendLog(newState.guild, 'logSes', `🔊 **${newState.member.user.tag}**, \`${newState.channel.name}\` ses kanalına katıldı.`);
    } else if (oldState.channelId && !newState.channelId) {
        sendLog(oldState.guild, 'logSes', `🔇 **${oldState.member.user.tag}**, \`${oldState.channel.name}\` ses kanalından ayrıldı.`);
    }
});

client.on('messageDelete', message => {
    if (!message.guild || (message.author && message.author.bot)) return;
    const content = message.content ? message.content : "[İçerik yok veya sadece görsel]";
    sendLog(message.guild, 'logGenel', `🗑️ **${message.author ? message.author.tag : 'Bilinmeyen Kullanıcı'}** adlı kişinin \`${message.channel.name}\` kanalındaki mesajı silindi.\n**İçerik:** ${content}`);
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.activities) return;
    const activity = newPresence.activities.find(act => act.type === ActivityType.Streaming);
    if (activity && (!oldPresence || !oldPresence.activities.find(act => act.name === activity.name))) {
        if (activity.url && activity.url.includes("kick.com")) {
            sendLog(newPresence.guild, 'logSes', `🎥 **${newPresence.member.user.tag}** Kick'te yayına başladı!\nLink: ${activity.url}`);
        } else {
            sendLog(newPresence.guild, 'logSes', `🎥 **${newPresence.member.user.tag}** yayına başladı: ${activity.name}\nLink: ${activity.url || "Belirtilmedi"}`);
        }
    }
});

client.login(process.env.TOKEN);
