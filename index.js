const { Client, GatewayIntentBits, Partials, PermissionsBitField, ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

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

const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
const getDB = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));

const spamMap = new Map();

const otoCevaplar = [
    {
        tetikleyiciler: ["sa", "s.a", "selam", "selamun aleyküm", "selamın aleyküm", "sea", "selamlar"],
        cevaplar: ["Aleykümselam vatandaş, hoş geldin.", "Aleykümselam, devriye an itibarıyla huzurlu, buyur.", "Aleykümselam! Asayiş berkemal, keyifler nasıl?"],
        etiketle: true,
        tamKelime: true
    },
    {
        tetikleyiciler: ["günaydın", "gunaydin", "hayırlı sabahlar", "sabah şerifleriniz hayrolsun"],
        cevaplar: ["Günaydın! Mesai başladı, asayiş berkemal.", "Günaydın vatandaş, sabah sabah vukuat yoktur inşallah?"],
        etiketle: true,
        tamKelime: false
    },
    {
        tetikleyiciler: ["iyi geceler", "iyi akşamlar", "iyi aksamlar", "hayırlı geceler", "hayırlı akşamlar"],
        cevaplar: ["İyi geceler. Mahalle bizde, sen rahat uyu.", "İyi akşamlar. Gecenin bu saatinde şüpheli hareketler yapmayalım."],
        etiketle: false,
        tamKelime: false
    },
    {
        tetikleyiciler: ["hg", "hoş geldin", "hoşgeldin", "hoş geldik"],
        cevaplar: ["Hoş bulduk. Karakol durumları nasıl?", "Sağ ol vatandaş, devriyedeyiz."],
        etiketle: true,
        tamKelime: true
    },
    {
        tetikleyiciler: ["memur bey", "hüsnü", "memur hüsnü", "hüsnü bey", "memur amca"],
        cevaplar: ["Buyur vatandaş, bir şikayet mi var?", "Görev başındayım, dinliyorum.", "Amirime bildirmelik bir durum mu var?"],
        etiketle: true,
        tamKelime: false
    },
    {
        tetikleyiciler: ["bb", "görüşürüz", "gorusuruz", "ben kaçar", "çıkıyorum"],
        cevaplar: ["Dikkatli git, sağa sola takılma.", "Hadi bakalım, Allah'a emanet ol."],
        etiketle: false,
        tamKelime: true
    },
    {
        tetikleyiciler: ["nasılsın", "naber", "nasilsin", "ne haber", "nasılsınız"],
        cevaplar: ["Devletin memuru nasıl olsun, 7/24 nöbetteyiz şükür. Sen nasılsın?", "Çok şükür iyiyiz, asayişi sağlıyoruz. Senden naber?"],
        etiketle: true,
        tamKelime: true
    }
];

// --- YENİLENEN EMBED LOG SİSTEMİ ---
async function sendLog(guild, logType, options) {
    const db = getDB();
    if (!db[guild.id] || !db[guild.id][logType]) return;
    const channelId = db[guild.id][logType];
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(options.title)
            .setDescription(options.desc)
            .setColor(options.color || 0x2b2d31)
            .setTimestamp();
        
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        
        channel.send({ embeds: [embed] }).catch(() => {});
    }
}

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

    sendLog(guild, 'logCeza', {
        title: '🚨 Hapise Atıldı!',
        desc: `**Kullanıcı:** <@${member.id}>\n**Sebep:** ${reason}\n**Ceza Süresi:** ${durationMins} dakika\n**Toplam İhlali:** ${userData.jailCount}`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
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
                            title: '🔓 Tahliye Edildi',
                            desc: `**Kullanıcı:** <@${member.id}>\nKullanıcının hapis süresi doldu ve serbest bırakıldı. (Sicil rolü kalıcıdır).`,
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
    console.log(`🤖 Sistem aktif! ${client.user.tag} giriş yaptı.`);
    
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
                { name: 'log-ses', type: 7, description: 'Ses loglarının atılacağı kanal (#kanal)' },
                { name: 'kick-kanal', type: 7, description: 'Kick duyurularının atılacağı kanal (#kanal)' },
                { name: 'kick-kisi', type: 6, description: 'Sadece bu kişinin Kick yayınları duyurulur (@kullanıcı)' },
                { name: 'link-engel', type: 5, description: 'Link engeli aktif edilsin mi? (True/False)' }
            ]
        },
        { name: 'info', description: 'Sunucu istatistiklerini ve bot ayarlarını gösterir.' },
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

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const db = getDB();
    const guildId = interaction.guildId;
    const isYetkili = db[guildId]?.yetkiliRol && interaction.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === 'ayar') {
        if (!isAdmin) return interaction.reply({ content: '❌ Bunu sadece sunucu yöneticileri yapabilir.', ephemeral: true });
        
        if (!db[guildId]) db[guildId] = { users: {} };
        const opts = ['yetkili-rol', 'muaf-rol', 'jail-rol', 'sicil-rol', 'log-ceza', 'log-genel', 'log-ses', 'kick-kanal', 'kick-kisi'];
        opts.forEach(opt => {
            const val = interaction.options.get(opt);
            if (val) db[guildId][opt.replace(/-([a-z])/g, g => g[1].toUpperCase())] = val.value;
        });
        
        const linkEngel = interaction.options.getBoolean('link-engel');
        if (linkEngel !== null) db[guildId].linkEngel = linkEngel;
        
        saveDB(db);
        return interaction.reply({ content: '✅ Sunucu ayarları başarıyla kaydedildi!', ephemeral: true });
    }

    if (['info', 'yaz', 'sil', 'af'].includes(interaction.commandName)) {
        if (!isAdmin && !isYetkili) return interaction.reply({ content: '❌ Bu komutu kullanmaya yetkiniz yok.', ephemeral: true });

        if (interaction.commandName === 'info') {
            const guildDb = db[guildId] || {};
            const voiceChannels = interaction.guild.channels.cache.filter(c => c.isVoiceBased());
            let membersInVoice = 0;
            voiceChannels.forEach(c => membersInVoice += c.members.size);

            const getRole = (id) => id ? `<@&${id}>` : '❌ Ayarlanmamış';
            const getChannel = (id) => id ? `<#${id}>` : '❌ Ayarlanmamış';
            const getUser = (id) => id ? `<@${id}>` : '❌ Ayarlanmamış';

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${interaction.guild.name} - Yönetim Paneli`)
                .setColor(0x2b2d31)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '📌 İstatistikler', value: `👥 Üye: **${interaction.guild.memberCount}**\n🎤 Seste: **${membersInVoice}**`, inline: false },
                    { name: '⚙️ Roller', value: `👑 Yetkili: ${getRole(guildDb.yetkiliRol)}\n🛡️ Muaf: ${getRole(guildDb.muafRol)}\n🚔 Jail: ${getRole(guildDb.jailRol)}\n📜 Sicil: ${getRole(guildDb.sicilRol)}`, inline: false },
                    { name: '📂 Kanallar', value: `🔨 Ceza: ${getChannel(guildDb.logCeza)}\n📋 Genel: ${getChannel(guildDb.logGenel)}\n🎙️ Ses: ${getChannel(guildDb.logSes)}\n🎥 Kick Kanalı: ${getChannel(guildDb.kickKanal)}\n👤 Kick Yayıncısı: ${getUser(guildDb.kickKisi)}`, inline: false },
                    { name: '🛡️ Güvenlik', value: `🔗 Link Engeli: **${guildDb.linkEngel ? '✅ Aktif' : '❌ Kapalı'}**`, inline: false }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

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
                    sendLog(interaction.guild, 'logCeza', { title: '🕊️ Özel Af Çıktı', desc: `<@${user.id}> adlı kullanıcının tüm cezaları ve sicili affedildi.`, color: 0x57f287 });
                    return interaction.reply({ content: `${user.tag} başarıyla affedildi.`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `❌ **${user.tag}** adlı kullanıcının cezası bulunmuyor.`, ephemeral: true });
                }
            } else {
                db[guildId].users = {};
                saveDB(db);
                sendLog(interaction.guild, 'logCeza', { title: '🕊️ Genel Af Çıktı', desc: `Sunucudaki **TÜM** cezalar ve siciller sıfırlandı.`, color: 0x57f287 });
                return interaction.reply({ content: 'Tüm siciller sıfırlandı.', ephemeral: true });
            }
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const lowerContent = message.content.toLocaleLowerCase('tr-TR');
    for (const ayar of otoCevaplar) {
        let eslesti = false;
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

    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    const isMuaf = db[guildId].muafRol && message.member.roles.cache.has(db[guildId].muafRol);
    const isYetkili = db[guildId].yetkiliRol && message.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (isAdmin || isYetkili || isMuaf) return;

    if (db[guildId].linkEngel) {
        const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels)/i.test(message.content);
        const hasLink = /(https?:\/\/[^\s]+)/g.test(message.content);
        if (hasLink && !isDiscordMedia) {
            await message.delete().catch(() => {});
            await applyJail(message.member, message.guild, "Yasaklı Link Paylaşımı");
            return; 
        }
    }

    const lettersOnly = message.content.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "");
    if (lettersOnly.length > 5) {
        const upperCount = lettersOnly.replace(/[^A-ZĞÜŞİÖÇ]/g, "").length;
        if ((upperCount / lettersOnly.length) >= 0.75) {
            await message.delete().catch(() => {});
            message.channel.send(`${message.member}, lütfen büyük harf kullanımına dikkat et!`).then(m => setTimeout(() => m.delete(), 4000));
            sendLog(message.guild, 'logCeza', { title: '⚠️ Caps Lock Uyarısı', desc: `**Kullanıcı:** <@${message.author.id}>\nCaps lock kullanımı nedeniyle uyarıldı.`, color: 0xfee75c });
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

// --- GENEL LOGLAR (EMBED OLARAK GÜNCELLENDİ VE YENİLERİ EKLENDİ) ---

client.on('guildMemberAdd', member => {
    sendLog(member.guild, 'logGenel', { title: '📥 Üye Katıldı', desc: `<@${member.id}> sunucuya giriş yaptı. Hoş geldin!`, color: 0x57f287, thumbnail: member.user.displayAvatarURL() });
});

client.on('guildMemberRemove', member => {
    sendLog(member.guild, 'logGenel', { title: '📤 Üye Ayrıldı', desc: `**${member.user.tag}** sunucudan ayrıldı.`, color: 0xed4245, thumbnail: member.user.displayAvatarURL() });
});

client.on('messageDelete', message => {
    if (!message.guild || (message.author && message.author.bot)) return;
    const content = message.content ? message.content : "[İçerik yok veya sadece görsel]";
    sendLog(message.guild, 'logGenel', { title: '🗑️ Mesaj Silindi', desc: `**Kullanıcı:** <@${message.author ? message.author.id : 'Bilinmiyor'}>\n**Kanal:** <#${message.channel.id}>\n\n**Silinen İçerik:**\n${content}`, color: 0xed4245 });
});

// YENİ: Mesaj Düzenleme Logu
client.on('messageUpdate', (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // Görsel yüklenmesi gibi boş güncellemeleri atlar
    
    sendLog(oldMessage.guild, 'logGenel', {
        title: '✏️ Mesaj Düzenlendi',
        desc: `**Kullanıcı:** <@${oldMessage.author.id}>\n**Kanal:** <#${oldMessage.channel.id}>\n\n**Eski Hal:**\n${oldMessage.content || '[Yok]'}\n\n**Yeni Hal:**\n${newMessage.content || '[Yok]'}`,
        color: 0xfee75c
    });
});

// YENİ: Takma Ad Değişikliği Logu
client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
        sendLog(newMember.guild, 'logGenel', {
            title: '👤 Takma Ad Değiştirildi',
            desc: `**Kullanıcı:** <@${newMember.id}>\n**Eski İsim:** ${oldMember.nickname || oldMember.user.username}\n**Yeni İsim:** ${newMember.nickname || newMember.user.username}`,
            color: 0x3498db,
            thumbnail: newMember.user.displayAvatarURL()
        });
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (!oldState.channelId && newState.channelId) {
        sendLog(newState.guild, 'logSes', { title: '🔊 Sese Katıldı', desc: `<@${newState.member.id}>, <#${newState.channel.id}> kanalına giriş yaptı.`, color: 0x57f287 });
    } else if (oldState.channelId && !newState.channelId) {
        sendLog(oldState.guild, 'logSes', { title: '🔇 Sesten Ayrıldı', desc: `<@${oldState.member.id}>, <#${oldState.channel.id}> kanalından çıkış yaptı.`, color: 0xed4245 });
    } else if (oldState.channelId !== newState.channelId) {
        sendLog(newState.guild, 'logSes', { title: '🔀 Ses Kanalı Değiştirdi', desc: `<@${newState.member.id}>, <#${oldState.channel.id}> kanalından çıkıp <#${newState.channel.id}> kanalına geçti.`, color: 0xfee75c });
    }
});

// KICK DUYURU EVENTİ (EMBED OLARAK GÜNCELLENDİ)
client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.activities || !newPresence.guild) return;

    const db = getDB();
    const guildId = newPresence.guild.id;
    
    if (!db[guildId] || !db[guildId].kickKisi || !db[guildId].kickKanal) return;
    if (newPresence.userId !== db[guildId].kickKisi) return;

    const activity = newPresence.activities.find(act => act.type === ActivityType.Streaming);
    
    if (activity && (!oldPresence || !oldPresence.activities.find(act => act.name === activity.name))) {
        if (activity.url && activity.url.includes("kick.com")) {
            sendLog(newPresence.guild, 'kickKanal', {
                title: '🎥 Canlı Yayın Başladı!',
                desc: `Hey! <@${newPresence.userId}> şu an Kick'te yayında. Hadi sen de gel!\n\n🔗 **[Yayına Gitmek İçin Buraya Tıkla](${activity.url})**`,
                color: 0x53f22b,
                thumbnail: newPresence.member.user.displayAvatarURL()
            });
        }
    }
});

client.login(process.env.TOKEN);
