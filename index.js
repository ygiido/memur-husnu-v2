const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// Kibar Memur Oto-Cevapları
const otoCevaplar = [
    { tetikleyiciler: ["as", "a.s", "aleyküm selam", "aleykümselam", "aleykum selam"], cevaplar: ["Hoş bulduk efendim. Evrak kayıt bölümüne hoş geldiniz, buyurun.", "Hoş bulduk, mesaimiz devam ediyor. Nasıl yardımcı olabilirim?", "Görevinin başındayız vatandaş, buyurun."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["sa", "s.a", "selam", "selamun aleyküm", "sea", "selamın aleyküm"], cevaplar: ["Aleykümselam efendim. Dairemize hoş geldiniz.", "Aleykümselam, buyurun işleminiz neydi?", "Aleykümselam vatandaş, hoş geldiniz."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["günaydın", "gunaydin", "hayırlı sabahlar", "sabah şerifleriniz hayrolsun"], cevaplar: ["Günaydın efendim. Mesaimiz başlamıştır, harika bir gün dilerim.", "Günaydın vatandaş, hoş geldiniz. Çayımız yeni demlendi."], etiketle: true, tamKelime: false },
    { tetikleyiciler: ["iyi geceler", "iyi akşamlar", "iyi aksamlar", "hayırlı geceler"], cevaplar: ["İyi geceler efendim. Nöbetçi memur olarak görev başındayım.", "İyi akşamlar, huzurlu istirahatler dilerim."], etiketle: false, tamKelime: false },
    { tetikleyiciler: ["hg", "hoş geldin", "hoşgeldin"], cevaplar: ["Hoş bulduk, çok teşekkür ederim. Dairede durumlar nasıl?", "Sağ olun efendim, masamıza geçtik."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["bb", "görüşürüz", "gorusuruz", "ben kaçar", "çıkıyorum", "allaha emanet", "baybay"], cevaplar: ["Dosyanızı kapattım, sağlıcakla kalın.", "Allah'a emanet olun, yine bekleriz."], etiketle: false, tamKelime: true },
    { tetikleyiciler: ["nasılsın", "naber", "nasilsin", "ne haber", "napıyorsun", "nabıyon"], cevaplar: ["Çok şükür efendim, evraklarımızı düzenliyoruz. Siz nasılsınız?", "Teşekkür ederim, görevimizin başındayız. Sizi sormalı?"], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["teşekkürler", "sağ ol", "sağol", "eyvallah", "teşekkür ederim", "eyv"], cevaplar: ["Rica ederim efendim, kamu hizmeti bizim görevimiz.", "Ne demek, her zaman yardıma hazırız."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["lan", "sus", "kes", "aptal", "mal", "salak"], cevaplar: ["Efendim, lütfen üslubumuza dikkat edelim. Resmi dairedeyiz.", "Sevgili vatandaşım, birbirimize karşı daha nazik olalım lütfen."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["çay", "kahve", "sigara", "çorba", "molası"], cevaplar: ["Buyurun efendim, çayımız taze. Bir bardak da size doldurayım.", "Mesai arası sıcak bir çay gibisi yok, afiyet olsun."], etiketle: false, tamKelime: false }
];

// Denetim Kaydı (Audit Log) Okuyucu
async function getAuditExecutor(guild, actionType, targetId = null) {
    try {
        const fetchedLogs = await guild.fetchAuditLogs({ limit: 5, type: actionType });
        const logEntry = fetchedLogs.entries.find(entry => 
            (Date.now() - entry.createdTimestamp < 10000) && 
            (!targetId || entry.target?.id === targetId)
        );
        return logEntry ? logEntry.executor : null;
    } catch (e) {
        return null;
    }
}

// Log Gönderici
async function sendLog(guild, logCategory, options) {
    if (!guild) return;
    const db = getDB();
    if (!db[guild.id] || !db[guild.id][logCategory]) return;
    const channelId = db[guild.id][logCategory];
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(options.title)
            .setDescription(options.desc)
            .setColor(options.color || 0x2b2d31)
            .setTimestamp();
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.footer) embed.setFooter({ text: options.footer });
        channel.send({ embeds: [embed] }).catch(() => {});
    }
}

// Otomatik Hapis (Jail) Sistemi
async function applyJail(member, guild, reason) {
    const db = getDB();
    if (!db[guild.id]) db[guild.id] = {};
    if (!db[guild.id].users) db[guild.id].users = {};
    if (!db[guild.id].users[member.id]) db[guild.id].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, aiOnay: false, kufurUyari: 0 };

    let userData = db[guild.id].users[member.id];
    userData.jailCount += 1;
    userData.sicilli = true; 

    const durations = [15, 30, 60, 180];
    let durationMins = durations[userData.jailCount - 1] || 180; 
    userData.jailExpire = Date.now() + (durationMins * 60 * 1000);
    saveDB(db);

    if (db[guild.id].jailRol) await member.roles.add(db[guild.id].jailRol).catch(() => {});
    if (db[guild.id].sicilRol) await member.roles.add(db[guild.id].sicilRol).catch(() => {});

    sendLog(guild, 'logCeza', {
        title: '🚨 Otomatik Hapis (Uzaklaştırma)',
        desc: `**Vatandaş:** <@${member.id}> (\`${member.id}\`)\n**Sebep:** ${reason}\n**Süre:** ${durationMins} dakika\n**Toplam İhlali:** ${userData.jailCount}\n**Sicil Dosyası:** İşlendi 📜`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
}

// Hapis Süresi Kontrolü
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
                            desc: `**Vatandaş:** <@${member.id}>\nKullanıcının uzaklaştırma süresi doldu ve serbest bırakıldı.`,
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
    
    if (process.env.GEMINI_API_KEY) {
        console.log("✅ Yapay Zeka (Gemini 1.5 Flash) başarıyla bağlandı!");
    } else {
        console.log("❌ DİKKAT: GEMINI_API_KEY bulunamadı!");
    }

    // Davetleri önbelleğe al (Invite Tracker için)
    client.guilds.cache.forEach(async guild => {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(firstInvites.map(inv => [inv.code, inv.uses])));
        } catch (e) {}
    });

    const commands = [
        {
            name: 'ayar',
            description: 'Botun temel sistem ve kural ayarlarını yapar (Sadece Yöneticiler).',
            options: [
                { name: 'yetkili-rol', type: 8, description: 'Botu yönetecek makam yetkilisi (@rol)' },
                { name: 'muaf-rol', type: 8, description: 'Ceza işlemlerinden muaf tutulacak rol (@rol)' },
                { name: 'jail-rol', type: 8, description: 'Uzaklaştırma (Hapis) alanlara verilecek rol (@rol)' },
                { name: 'sicil-rol', type: 8, description: 'Sicili kirlenenlere verilecek mühürlü rol (@rol)' },
                { name: 'kick-bot', type: 6, description: 'Duyurusu yakalanacak Kick botu (@bot)' },
                { name: 'kick-kanal', type: 7, description: 'Yayındayız duyurusunun yapılacağı kanal (#kanal)' },
                { name: 'ai-kanal', type: 7, description: 'Memur Hüsnü (AI) ile sohbet edilecek kanal (#kanal)' },
                { name: 'link-engel', type: 5, description: 'Link paylaşımı yasaklansın mı? (True/False)' },
                { name: 'kufur-engel', type: 5, description: 'Küfür filtresi ve 3 uyarılı ceza sistemi (True/False)' },
                { name: 'oto-cevap', type: 5, description: 'Memur vatandaşlarla sohbet etsin mi? (True/False)' }
            ]
        },
        {
            name: 'log',
            description: 'Ultra detaylı log kanallarını kategorilere göre ayarlar (Sadece Yöneticiler).',
            options: [
                { name: 'ceza', type: 7, description: 'Adli Sicil: Hapis, Af, Uyarı, Ban, Kick, Timeout logları (#kanal)' },
                { name: 'mesaj', type: 7, description: 'İletişim: Silinen, düzenlenen mesajlar, Pin ve Ghost Ping logları (#kanal)' },
                { name: 'ses', type: 7, description: 'Toplantı: Ses giriş-çıkış, kamera, yayın, sağırlaştırma/susturma logları (#kanal)' },
                { name: 'uye', type: 7, description: 'Nüfus: Katılan (Davet detaylı), ayrılan, rol, isim, avatar ve Boost logları (#kanal)' },
                { name: 'sunucu', type: 7, description: 'İdari: Kanal, rol, alt başlık (thread), emoji, sticker ve sunucu ayar logları (#kanal)' },
                { name: 'guvenlik', type: 7, description: 'İstihbarat: Webhook, yeni eklenen botlar ve davet linki logları (#kanal)' }
            ]
        },
        { name: 'info', description: 'Kurum istatistiklerini, kural ve log kanalı ayarlarını gösterir.' },
        { name: 'sartname', description: 'Yapay zeka (AI) kullanım şartnamesini ve onay butonunu kanala gönderir (Yönetici).' },
        {
            name: 'af',
            description: 'Kişinin veya herkesin sicilini temizler (Dava Düşürür).',
            options: [{ name: 'kullanici', type: 6, description: 'Sicili temizlenecek kişi (Boş bırakılırsa herkesi affeder)' }]
        },
        {
            name: 'hapis',
            description: 'Kullanıcıyı manuel olarak uzaklaştırır (Süre & Sebep).',
            options: [
                { name: 'kullanici', type: 6, description: 'Uzaklaştırılacak kişi', required: true },
                { name: 'sayi', type: 4, description: 'Ceza süresi (Sayı)', required: true },
                { name: 'kavram', type: 3, description: 'Süre birimi', required: true, choices: [
                    { name: 'Saniye', value: 'saniye' },
                    { name: 'Dakika', value: 'dakika' },
                    { name: 'Saat', value: 'saat' },
                    { name: 'Gün', value: 'gun' }
                ]},
                { name: 'sebep', type: 3, description: 'İşlem sebebi', required: true }
            ]
        },
        {
            name: 'yaz',
            description: 'Bot adına bir metin yazdırırsınız.',
            options: [{ name: 'mesaj', type: 3, description: 'Yazdırılacak metin', required: true }]
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
    const db = getDB();
    const guildId = interaction.guildId;
    
    // Islak İmza Buton Kontrolü
    if (interaction.isButton()) {
        if (interaction.customId === 'ai_onay_btn') {
            if (!db[guildId]) db[guildId] = {};
            if (!db[guildId].users) db[guildId].users = {};
            if (!db[guildId].users[interaction.user.id]) {
                db[guildId].users[interaction.user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, aiOnay: false, kufurUyari: 0 };
            }
            
            db[guildId].users[interaction.user.id].aiOnay = true;
            saveDB(db);
            
            return interaction.reply({ content: '✅ Islak imzanız kurum arşivine kaydedilmiştir. Artık Memur Hüsnü ile tahsis edilen gişeden işlem yapabilirsiniz.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    
    const isYetkili = db[guildId]?.yetkiliRol && interaction.member.roles.cache.has(db[guildId].yetkiliRol);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    // /ayar KOMUTU
    if (interaction.commandName === 'ayar') {
        if (!isAdmin) return interaction.reply({ content: '❌ Bu işlemi sadece Kurum Müdürleri (Yöneticiler) yapabilir.', ephemeral: true });
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
        return interaction.reply({ content: '✅ Kurum sistem ayarları başarıyla kaydedildi!', ephemeral: true });
    }

    // /log KOMUTU (YENİ KATEGORİ SİSTEMİ)
    if (interaction.commandName === 'log') {
        if (!isAdmin) return interaction.reply({ content: '❌ Log kanallarını sadece Yöneticiler ayarlayabilir.', ephemeral: true });
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
                degisenler.push(`**${optName.toUpperCase()}** ➔ <#${ch.id}>`);
            }
        }

        if (degisenler.length === 0) {
            return interaction.reply({ content: '⚠️ Lütfen en az bir log kategorisi seçip kanal etiketleyin.', ephemeral: true });
        }

        saveDB(db);
        return interaction.reply({ content: `✅ **Log Kanalları Güncellendi:**\n${degisenler.join('\n')}`, ephemeral: true });
    }

    // /sartname KOMUTU
    if (interaction.commandName === 'sartname') {
        if (!isAdmin) return interaction.reply({ content: '❌ Bu işlemi sadece Yöneticiler yapabilir.', ephemeral: true });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ai_onay_btn')
                .setLabel('Kuralları Okudum, Kabul Ediyorum (İmzala)')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🖋️')
        );

        const embed = new EmbedBuilder()
            .setTitle('📜 DANIŞMA BİRİMİ (AI) KULLANIM ŞARTNAMESİ')
            .setDescription(`Vatandaşların dikkatine!\n\nMemur Hüsnü ile işlem yapmadan (yapay zeka sistemini kullanmadan) önce aşağıdaki kuralları kabul etmeniz gerekmektedir:\n\n**1.** Spam, flood ve gereksiz etiketleme yapmak kesinlikle yasaktır.\n**2.** Kurum içi ahlaka aykırı ve argolu ifadeler kullanmak sicilinize işlenir.\n**3.** İşlemler sadece yetkililerin belirlediği "Danışma Kanalı" gişesinde yapılır.\n\nSistemi kullanabilmek için aşağıdaki butona tıklayarak **ıslak imza** atmanız zorunludur. İmza atmayanların işlemleri yanıtlanmayacaktır.`)
            .setColor(0x2b2d31)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setFooter({ text: 'Onaylayan kullanıcıların kaydı kurum arşivine işlenecektir.' });

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Şartname başarıyla gişeye asıldı.', ephemeral: true });
    }

    // YETKİLİ KOMUTLARI (/info, /hapis, /af, /yaz, /sil)
    if (['info', 'yaz', 'sil', 'af', 'hapis'].includes(interaction.commandName)) {
        if (!isAdmin && !isYetkili) return interaction.reply({ content: '❌ Bu komutu kullanma yetkiniz bulunmamaktadır.', ephemeral: true });

        if (interaction.commandName === 'info') {
            const guildDb = db[guildId] || {};
            const getRole = (id) => id ? `<@&${id}>` : '❌ Atanmamış';
            const getChannel = (id) => id ? `<#${id}>` : '❌ Atanmamış';
            const getUser = (id) => id ? `<@${id}>` : '❌ Atanmamış';

            const embed = new EmbedBuilder()
                .setTitle(`🏛️ ${interaction.guild.name} - Sistem ve Log Paneli`)
                .setColor(0x2b2d31)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '📌 Nüfus', value: `👥 Üye Sayısı: **${interaction.guild.memberCount}**`, inline: false },
                    { name: '⚙️ Rol Ayarları', value: `👑 Yetkili: ${getRole(guildDb.yetkiliRol)}\n🛡️ Muaf: ${getRole(guildDb.muafRol)}\n🚔 Hapis (Jail): ${getRole(guildDb.jailRol)}\n📜 Sicilli: ${getRole(guildDb.sicilRol)}`, inline: true },
                    { name: '🤖 Özel Kanallar', value: `💬 AI Danışma: ${getChannel(guildDb.aiKanal)}\n🎥 Yayın Duyuru: ${getChannel(guildDb.kickKanal)}\n🤖 Kick Bot: ${getUser(guildDb.kickBot)}`, inline: true },
                    { name: '📂 Log Kanalları (/log)', value: `🔨 **Ceza:** ${getChannel(guildDb.logCeza)}\n💬 **Mesaj:** ${getChannel(guildDb.logMesaj)}\n🔊 **Ses:** ${getChannel(guildDb.logSes)}\n👤 **Üye:** ${getChannel(guildDb.logUye)}\n🏢 **Sunucu:** ${getChannel(guildDb.logSunucu)}\n🛡️ **Güvenlik:** ${getChannel(guildDb.logGuvenlik)}`, inline: false },
                    { name: '🛡️ Kurallar', value: `🔗 Link Engeli: **${guildDb.linkEngel ? '✅ Aktif' : '❌ Kapalı'}** | 🤬 Küfür Engeli: **${guildDb.kufurEngel ? '✅ Aktif' : '❌ Kapalı'}** | 💬 Oto-Sohbet: **${guildDb.otoCevap !== false ? '✅ Aktif' : '❌ Kapalı'}**`, inline: false }
                ).setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'hapis') {
            const user = interaction.options.getUser('kullanici');
            const sayi = interaction.options.getInteger('sayi');
            const kavram = interaction.options.getString('kavram');
            const sebep = interaction.options.getString('sebep');
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!member) return interaction.reply({ content: '❌ Kullanıcı bulunamadı.', ephemeral: true });

            let sureMs = 0;
            if (kavram === 'saniye') sureMs = sayi * 1000;
            if (kavram === 'dakika') sureMs = sayi * 60 * 1000;
            if (kavram === 'saat') sureMs = sayi * 60 * 60 * 1000;
            if (kavram === 'gun') sureMs = sayi * 24 * 60 * 60 * 1000;

            const sureDk = sureMs / (1000 * 60);

            if (!db[guildId].users) db[guildId].users = {};
            if (!db[guildId].users[user.id]) db[guildId].users[user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, aiOnay: false, kufurUyari: 0 };

            let userData = db[guildId].users[user.id];
            userData.jailExpire = Date.now() + sureMs;
            userData.jailCount += 1;

            let sicilVerilecek = false;
            let sicilDurumMesaji = "";

            if (sureDk > 10) {
                sicilVerilecek = true;
                sicilDurumMesaji = "İşlendi 📜 (10 dakikadan uzun ceza)";
            } else {
                userData.minorJailCount = (userData.minorJailCount || 0) + 1;
                if (userData.minorJailCount >= 11) {
                    sicilVerilecek = true;
                    sicilDurumMesaji = `İşlendi 📜 (Sınır aşıldı: ${userData.minorJailCount}/11)`;
                } else {
                    sicilDurumMesaji = `Temiz 🟢 (Hafif İhlal: ${userData.minorJailCount}/11)`;
                }
            }

            if (sicilVerilecek) userData.sicilli = true;
            saveDB(db);

            if (db[guildId].jailRol) await member.roles.add(db[guildId].jailRol).catch(() => {});
            if (sicilVerilecek && db[guildId].sicilRol) await member.roles.add(db[guildId].sicilRol).catch(() => {});

            sendLog(interaction.guild, 'logCeza', {
                title: '🚨 Manuel Uzaklaştırma (Hapis)',
                desc: `**Yetkili:** <@${interaction.user.id}>\n**Vatandaş:** <@${user.id}>\n**Süre:** ${sayi}${kavram}\n**Sebep:** ${sebep}\n**Sicil:** ${sicilDurumMesaji}`,
                color: 0xed4245,
                thumbnail: user.displayAvatarURL()
            });

            return interaction.reply({ content: `✅ <@${user.id}> adlı kullanıcıya ${sayi}${kavram} uzaklaştırma uygulandı.`, ephemeral: true });
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
                    sendLog(interaction.guild, 'logCeza', { title: '🕊️ Sicil Affı (Beraat)', desc: `**Yetkili:** <@${interaction.user.id}>\n**Affedilen:** <@${user.id}>\nKullanıcının tüm ceza ve sicil kayıtları temizlendi.`, color: 0x57f287 });
                    return interaction.reply({ content: `${user.tag} adlı kullanıcının sicili temizlendi.`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `❌ **${user.tag}** adlı kullanıcının kaydı zaten temiz.`, ephemeral: true });
                }
            } else {
                db[guildId].users = {};
                saveDB(db);
                sendLog(interaction.guild, 'logCeza', { title: '🕊️ Genel Af İlan Edildi', desc: `**Yetkili:** <@${interaction.user.id}>\nSunucudaki **TÜM** üyelerin ceza ve sicil kayıtları sıfırlandı.`, color: 0x57f287 });
                return interaction.reply({ content: 'Tüm siciller sıfırlandı.', ephemeral: true });
            }
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
            sendLog(interaction.guild, 'logMesaj', { title: '🧹 Yetkili Mesaj Silme (/sil)', desc: `**Yetkili:** <@${interaction.user.id}>\n**Kanal:** <#${interaction.channel.id}>\n**Miktar:** ${miktar} adet mesaj silindi.`, color: 0xed4245 });
            return interaction.reply({ content: `${miktar} adet mesaj silindi.`, ephemeral: true });
        }
    }
});

// MESAJ OLAYLARI (KICK DUYURU, KÜFÜR ENGEL, AI SOHBET, KORUMA)
client.on('messageCreate', async message => {
    if (!message.guild) return;
    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    // --- DÜMDÜZ VE BASİT KICK DUYURU SİSTEMİ ---
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
                const embedDesc = message.embeds[0].description || "";
                const embedUrl = message.embeds[0].url || "";
                const embedMatch = embedDesc.match(/(https?:\/\/kick\.com\/[^\s]+)/i);
                kickLink = embedUrl.includes('kick.com') ? embedUrl : (embedMatch ? embedMatch[0] : null);
            }
            if (kickLink) {
                await message.delete().catch(() => {});
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('🔴 Yayına Gel').setStyle(ButtonStyle.Link).setURL(kickLink)
                );
                const duyuruKanali = message.guild.channels.cache.get(db[guildId].kickKanal);
                if (duyuruKanali) {
                    duyuruKanali.send({ 
                        content: '@everyone 🟢 **Yayındayız! Katılmak için aşağıdaki butona tıkla.**', 
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
    const isProtected = isAdmin || isYetkili || isMuaf;

    // --- KÜFÜR ENGEL SİSTEMİ ---
    if (db[guildId].kufurEngel && !isProtected) {
        const lowerContent = message.content.toLocaleLowerCase('tr-TR');
        const kufurRegex = /(?:^|\s|[.,!?])(amk|aq|amq|sg|oç|orospu|siktir|piç|yavşak|amına|sokuk|göt|amcık|pezevenk|sik|yarrak|yarak|kahpe|sikim|sikerim|gavat)(?:$|\s|[.,!?])/i;
        
        if (kufurRegex.test(lowerContent)) {
            await message.delete().catch(() => {});
            
            if (!db[guildId].users) db[guildId].users = {};
            if (!db[guildId].users[message.author.id]) db[guildId].users[message.author.id] = { jailCount: 0, minorJailCount: 0, sicilli: false, aiOnay: false, kufurUyari: 0 };
            
            let userData = db[guildId].users[message.author.id];
            userData.kufurUyari = (userData.kufurUyari || 0) + 1;
            saveDB(db);

            if (userData.kufurUyari < 3) {
                message.channel.send(`<@${message.author.id}>, Lütfen üslubumuza dikkat edelim, sunucuda küfür ve argo yasaktır. (**${userData.kufurUyari}/3 Uyarı**)`).then(m => setTimeout(() => m.delete(), 6000));
                sendLog(message.guild, 'logCeza', { title: '⚠️ Küfür/Argo Uyarısı', desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Uyarı Sayısı:** ${userData.kufurUyari}/3\n**Silinen Mesaj:** ${message.content}`, color: 0xfee75c });
            } else {
                userData.kufurUyari = 0;
                saveDB(db);
                await applyJail(message.member, message.guild, "Küfür / Hakaret (3. İhlal)");
            }
            return;
        }
    }

    // --- KİBAR VE DÜZGÜN MEMUR HÜSNÜ (AI - GEMINI 1.5 FLASH) ---
    if (message.mentions.has(client.user) && !message.mentions.everyone && genAI) {
        
        const aiKanalId = db[guildId].aiKanal;
        if (aiKanalId && message.channel.id !== aiKanalId) {
            return message.reply(`Efendim, danışma işlemlerimiz sadece <#${aiKanalId}> kanalından yapılmaktadır. Lütfen oraya teşrif edin.`).then(m => setTimeout(() => m.delete(), 6000));
        }

        const userData = db[guildId].users ? db[guildId].users[message.author.id] : null;
        if (!userData || !userData.aiOnay) {
            return message.reply(`Efendim, size yardımcı olabilmem için öncelikle ilgili kanaldan **"Danışma Birimi Kullanım Şartnamesi"**ni okuyup yeşil butona tıklayarak onay vermeniz gerekmektedir.`);
        }

        try {
            await message.channel.sendTyping();
            
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash", 
                systemInstruction: "Senin adın Memur Hüsnü. Sen son derece kibar, beyefendi, yardımsever, işini severek yapan, bilgili ve güler yüzlü bir devlet memurusun. Asla yapay zeka olduğunu söyleme, kendinden kıdemli bir danışma memuru olarak bahset.\n\nKullanıcılara 'efendim', 'değerli vatandaşım', 'dostum' gibi nazik hitaplar kullan. Asla huysuzluk yapma, kimseyi tersleme, 'sıra var' veya 'evrağını yırtarım' gibi kaba cümleler kurma.\n\nSana sorulan her türlü soruyu (yazılım, genel kültür, tavsiye, günlük sohbet) en doğru, anlaşılır, kibar ve çözüm odaklı şekilde yanıtla. Cevapların Discord'da rahat okunacak şekilde derli toplu ve öz olsun."
            });
            
            const userPrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
            
            if (userPrompt.length === 0) {
                return message.reply("Buyurun efendim, size nasıl yardımcı olabilirim? Sorunuzu yazabilirsiniz.");
            }

            const result = await model.generateContent(userPrompt);
            const response = result.response.text();
            
            await message.reply(response);
            return; 
        } catch (error) {
            console.log("HATA YAKALANDI: ", error.message);
            await message.reply(`Efendim, şu an sistemlerimizde geçici bir yoğunluk var, lütfen birazdan tekrar deneyiniz.`);
            return;
        }
    }

    // OTO CEVAP SİSTEMİ
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

    // LİNK ENGEL
    if (db[guildId].linkEngel) {
        const isDiscordMedia = /(tenor\.com|giphy\.com|discordapp\.com\/attachments|discord\.com\/channels)/i.test(message.content);
        const hasLink = /(https?:\/\/[^\s]+)/g.test(message.content);
        if (hasLink && !isDiscordMedia) {
            await message.delete().catch(() => {});
            await applyJail(message.member, message.guild, "Yasaklı Link Paylaşımı");
            return; 
        }
    }

    // CAPS LOCK ENGEL
    const lettersOnly = message.content.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, "");
    if (lettersOnly.length > 5) {
        const upperCount = lettersOnly.replace(/[^A-ZĞÜŞİÖÇ]/g, "").length;
        if ((upperCount / lettersOnly.length) >= 0.75) {
            await message.delete().catch(() => {});
            message.channel.send(`${message.member}, lütfen tamamı büyük harf (Caps Lock) olan mesajlar yazmayalım.`).then(m => setTimeout(() => m.delete(), 4000));
            sendLog(message.guild, 'logCeza', { title: '⚠️ Büyük Harf (Caps Lock) Uyarısı', desc: `**Kullanıcı:** <@${message.author.id}>\n**Kanal:** <#${message.channel.id}>\n**Mesaj:** ${message.content}`, color: 0xfee75c });
        }
    }

    // SPAM / FLOOD ENGEL
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
// ULTRA DETAYLI LOG SİSTEMİ ("BİRİ NEFES ALSA LOGLASIN")
// ============================================================================

// --- 1. MESAJ LOGLARI (logMesaj) ---
client.on('messageDelete', async message => {
    if (!message.guild || (message.author && message.author.bot)) return;
    
    const executor = await getAuditExecutor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const silenBilgisi = executor ? `<@${executor.id}> (Yetkili)` : (message.author ? `<@${message.author.id}> (Kendisi)` : 'Bilinmiyor');
    const content = message.content || "[Görsel veya Embed İçerik]";
    const attachments = message.attachments.size > 0 ? `\n**Ekler:** ${message.attachments.map(a => a.url).join('\n')}` : '';

    // Ghost Ping (Hayalet Etiket) Kontrolü
    if (message.mentions && (message.mentions.users.size > 0 || message.mentions.roles.size > 0 || message.mentions.everyone)) {
        sendLog(message.guild, 'logMesaj', {
            title: '👻 Hayalet Etiket (Ghost Ping) Yakalandı!',
            desc: `**Atan Kişi:** <@${message.author?.id}>\n**Kanal:** <#${message.channel.id}>\n**Silinen Mesaj:**\n${content}`,
            color: 0xff0000
        });
    }

    sendLog(message.guild, 'logMesaj', {
        title: '🗑️ Mesaj Silindi',
        desc: `**Mesaj Sahibi:** <@${message.author ? message.author.id : 'Bilinmiyor'}>\n**Silen Kişi:** ${silenBilgisi}\n**Kanal:** <#${message.channel.id}>\n\n**İçerik:**\n${content}${attachments}`,
        color: 0xed4245
    });
});

client.on('messageUpdate', (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot) return;
    
    // Mesaj Sabitleme (Pin) Kontrolü
    if (!oldMessage.pinned && newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: '📌 Mesaj Sabitlendi', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${oldMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0x3498db });
    }
    if (oldMessage.pinned && !newMessage.pinned) {
        return sendLog(oldMessage.guild, 'logMesaj', { title: '📍 Mesaj Sabitlemesi Kaldırıldı', desc: `**Kanal:** <#${oldMessage.channel.id}>\n**Mesaj Sahibi:** <@${oldMessage.author.id}>\n[Mesaja Git](${newMessage.url})`, color: 0xe67e22 });
    }

    if (oldMessage.content === newMessage.content) return;
    sendLog(oldMessage.guild, 'logMesaj', {
        title: '✏️ Mesaj Düzenlendi',
        desc: `**Yazan:** <@${oldMessage.author.id}>\n**Kanal:** <#${oldMessage.channel.id}> ([Mesaja Git](${newMessage.url}))\n\n**Eski Hal:**\n${oldMessage.content || '[Boş]'}\n\n**Yeni Hal:**\n${newMessage.content || '[Boş]'}`,
        color: 0xfee75c
    });
});

client.on('messageDeleteBulk', messages => {
    const firstMsg = messages.first();
    if (!firstMsg || !firstMsg.guild) return;
    sendLog(firstMsg.guild, 'logMesaj', {
        title: '🧹 Toplu Mesaj Silindi',
        desc: `**Kanal:** <#${firstMsg.channel.id}>\n**Silinen Miktar:** ${messages.size} adet mesaj.`,
        color: 0xed4245
    });
});

client.on('messageReactionRemoveAll', (message) => {
    if (!message.guild) return;
    sendLog(message.guild, 'logMesaj', {
        title: '🧼 Mesaj Tepkileri (Emojiler) Temizlendi',
        desc: `**Kanal:** <#${message.channel.id}>\n[Mesaja Git](${message.url})`,
        color: 0xe67e22
    });
});

// --- 2. SES LOGLARI (logSes) ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild || oldState.member?.user.bot) return;
    const member = newState.member;

    if (!oldState.channelId && newState.channelId) {
        sendLog(newState.guild, 'logSes', { title: '🔊 Ses Kanalına Katıldı', desc: `**Üye:** <@${member.id}>\n**Kanal:** <#${newState.channelId}>`, color: 0x57f287, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId && !newState.channelId) {
        sendLog(oldState.guild, 'logSes', { title: '🔇 Ses Kanalından Ayrıldı', desc: `**Üye:** <@${member.id}>\n**Ayrıldığı Kanal:** <#${oldState.channelId}>`, color: 0xed4245, thumbnail: member.user.displayAvatarURL() });
    } else if (oldState.channelId !== newState.channelId) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberMove);
        const tasiyan = executor && executor.id !== member.id ? `\n**Taşıyan Yetkili:** <@${executor.id}>` : '';
        sendLog(newState.guild, 'logSes', { title: '🔀 Ses Kanalı Değiştirdi', desc: `**Üye:** <@${member.id}>\n**Eski Kanal:** <#${oldState.channelId}>\n**Yeni Kanal:** <#${newState.channelId}>${tasiyan}`, color: 0xfee75c });
    }

    // Yetkili Susturma / Sağırlaştırma
    if (!oldState.serverMute && newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: '🛑 Yetkili Tarafından Susturuldu (Server Mute)', desc: `**Üye:** <@${member.id}>\n**Susturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverMute && !newState.serverMute) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: '🔊 Yetkili Susturması Kaldırıldı', desc: `**Üye:** <@${member.id}>\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }
    if (!oldState.serverDeaf && newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: '🙉 Yetkili Tarafından Sağırlaştırıldı (Server Deafen)', desc: `**Üye:** <@${member.id}>\n**Sağırlaştıran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
    }
    if (oldState.serverDeaf && !newState.serverDeaf) {
        const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        sendLog(newState.guild, 'logSes', { title: '👂 Yetkili Sağırlaştırması Kaldırıldı', desc: `**Üye:** <@${member.id}>\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
    }

    // Kendi Mikrofon ve Kulaklığı
    if (!oldState.selfMute && newState.selfMute) sendLog(newState.guild, 'logSes', { title: '🎙️ Mikrofonunu Kapattı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfMute && !newState.selfMute) sendLog(newState.guild, 'logSes', { title: '🎙️ Mikrofonunu Açtı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });
    if (!oldState.selfDeaf && newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: '🎧 Kulaklığını Kapattı (Sağırlaştı)', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x95a5a6 });
    if (oldState.selfDeaf && !newState.selfDeaf) sendLog(newState.guild, 'logSes', { title: '🎧 Kulaklığını Açtı', desc: `<@${member.id}> (<#${newState.channelId}>)`, color: 0x2ecc71 });

    // Yayın ve Kamera
    if (!oldState.streaming && newState.streaming) sendLog(newState.guild, 'logSes', { title: '📺 Ekran Paylaşımı Başlattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında yayın açtı.`, color: 0x3498db });
    if (oldState.streaming && !newState.streaming) sendLog(newState.guild, 'logSes', { title: '📺 Ekran Paylaşımını Kapattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalındaki yayınını sonlandırdı.`, color: 0xe67e22 });
    if (!oldState.selfVideo && newState.selfVideo) sendLog(newState.guild, 'logSes', { title: '📷 Kamerasını Açtı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında kamera açtı.`, color: 0x3498db });
    if (oldState.selfVideo && !newState.selfVideo) sendLog(newState.guild, 'logSes', { title: '📷 Kamerasını Kapattı', desc: `<@${member.id}>, <#${newState.channelId}> kanalında kamerasını kapattı.`, color: 0xe67e22 });
});

// --- 3. ÜYE VE NÜFUS LOGLARI (logUye, logCeza, logGuvenlik) ---
client.on('guildMemberAdd', async member => {
    // Bot Eklendiyse Güvenlik Loguna At
    if (member.user.bot) {
        const executor = await getAuditExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
        return sendLog(member.guild, 'logGuvenlik', {
            title: '🤖 Sunucuya Yeni Bir Bot Eklendi!',
            desc: `**Eklenen Bot:** <@${member.id}> (${member.user.tag})\n**Ekleyen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
            color: 0xff0000,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    // Davet Takibi (Invite Tracker)
    let inviteMsg = "Davet eden bulunamadı (Özel URL veya süresi dolmuş).";
    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = invitesCache.get(member.guild.id) || new Map();
        const usedInvite = newInvites.find(inv => inv.uses > (oldInvites.get(inv.code) || 0));
        
        newInvites.forEach(inv => oldInvites.set(inv.code, inv.uses));
        invitesCache.set(member.guild.id, oldInvites);

        if (usedInvite && usedInvite.inviter) {
            inviteMsg = `<@${usedInvite.inviter.id}> (\`${usedInvite.code}\` koduyla - Toplam **${usedInvite.uses}** kullanım)`;
        }
    } catch (e) {}

    const hesapYasi = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    sendLog(member.guild, 'logUye', {
        title: '📥 Sunucuya Katıldı',
        desc: `**Üye:** <@${member.id}> (${member.user.tag})\n**Hesap Kuruluş:** ${hesapYasi} gün önce\n**Davet Eden:** ${inviteMsg}`,
        color: 0x57f287,
        thumbnail: member.user.displayAvatarURL()
    });
});

client.on('guildMemberRemove', async member => {
    // Kick mi yedi yoksa kendisi mi çıktı kontrolü
    const executor = await getAuditExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (executor) {
        return sendLog(member.guild, 'logCeza', {
            title: '🥾 Sunucudan Atıldı (KICK)',
            desc: `**Atılan Üye:** <@${member.id}> (${member.user.tag})\n**Atan Yetkili:** <@${executor.id}>`,
            color: 0xed4245,
            thumbnail: member.user.displayAvatarURL()
        });
    }

    sendLog(member.guild, 'logUye', {
        title: '📤 Sunucudan Ayrıldı',
        desc: `**Üye:** <@${member.id}> (${member.user.tag})\nSunucudan kendi isteğiyle ayrıldı.`,
        color: 0xed4245,
        thumbnail: member.user.displayAvatarURL()
    });
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const guild = newMember.guild;

    // Discord Native Timeout (Zaman Aşımı) Kontrolü
    if (!oldMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const bitis = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;
        sendLog(guild, 'logCeza', {
            title: '⏳ Zaman Aşımı (Timeout) Uygulandı',
            desc: `**Üye:** <@${newMember.id}>\n**Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Bitiş Süresi:** ${bitis}`,
            color: 0xed4245,
            thumbnail: newMember.user.displayAvatarURL()
        });
    } else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        sendLog(guild, 'logCeza', {
            title: '🔊 Zaman Aşımı (Timeout) Kaldırıldı',
            desc: `**Üye:** <@${newMember.id}>\n**İşlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Süresi Doldu / Bilinmiyor'}`,
            color: 0x57f287
        });
    }

    // Takma Ad (Nickname) Değişimi
    if (oldMember.nickname !== newMember.nickname) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
        sendLog(guild, 'logUye', {
            title: '👤 Sunucu İçi İsim Değiştirildi',
            desc: `**Üye:** <@${newMember.id}>\n**Değiştiren:** ${executor ? `<@${executor.id}>` : 'Kendisi'}\n**Eski İsim:** ${oldMember.nickname \vert{}\vert{} oldMember.user.username}\n**Yeni İsim:** ${newMember.nickname || newMember.user.username}`,
            color: 0x3498db
        });
    }

    // Sunucu İçi Avatar Değişimi
    if (oldMember.avatar !== newMember.avatar) {
        sendLog(guild, 'logUye', {
            title: '🖼️ Sunucu Özel Avatarı Değişti',
            desc: `**Üye:** <@${newMember.id}> sunucu içi profil fotoğrafını güncelledi.`,
            color: 0x3498db,
            thumbnail: newMember.displayAvatarURL()
        });
    }

    // Nitro Boost Kontrolü
    if (!oldMember.premiumSince && newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: '💎 Sunucuya Takviye (Boost) Yapıldı!', desc: `<@${newMember.id}> sunucumuza Nitro takviyesi yaptı!`, color: 0xf47fff, thumbnail: newMember.user.displayAvatarURL() });
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
        sendLog(guild, 'logUye', { title: '💔 Sunucu Takviyesi (Boost) Çekildi', desc: `<@${newMember.id}> kullanıcısının sunucu takviyesi sona erdi.`, color: 0x95a5a6 });
    }

    // Rol Verilme / Alınma
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    
    if (addedRoles.size > 0 || removedRoles.size > 0) {
        const executor = await getAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        const yetkili = executor ? `<@${executor.id}>` : 'Sistem / Bilinmiyor';

        if (addedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: '🏷️ Rol Verildi', desc: `**Üye:** <@${newMember.id}>\n**Veren Yetkili:** ${yetkili}\n**Verilen Rol:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0x57f287 });
        }
        if (removedRoles.size > 0) {
            sendLog(guild, 'logUye', { title: '🗑️ Rol Alındı', desc: `**Üye:** <@${newMember.id}>\n**Alan Yetkili:** ${yetkili}\n**Alınan Rol:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0xed4245 });
        }
    }
});

// Genel Kullanıcı Profili (Username/Avatar) Değişimi
client.on('userUpdate', (oldUser, newUser) => {
    if (oldUser.bot) return;
    client.guilds.cache.forEach(guild => {
        if (!guild.members.cache.has(newUser.id)) return;
        if (oldUser.username !== newUser.username) {
            sendLog(guild, 'logUye', { title: '🌐 Discord Kullanıcı Adı Değişti', desc: `**Kullanıcı:** <@${newUser.id}>\n**Eski Adı:** ${oldUser.username}\n**Yeni Adı:** ${newUser.username}`, color: 0x3498db });
        }
        if (oldUser.avatar !== newUser.avatar) {
            sendLog(guild, 'logUye', { title: '📸 Discord Profil Fotoğrafı Değişti', desc: `**Kullanıcı:** <@${newUser.id}> genel profil fotoğrafını değiştirdi.`, color: 0x3498db, thumbnail: newUser.displayAvatarURL() });
        }
    });
});

// --- 4. CEZA (BAN/UNBAN) LOGLARI (logCeza) ---
client.on('guildBanAdd', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: '🚫 Sunucudan Yasaklandı (BAN)',
        desc: `**Yasaklanan:** ${ban.user.tag} (<@${ban.user.id}>)\n**Yasaklayan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x992d22,
        thumbnail: ban.user.displayAvatarURL()
    });
});

client.on('guildBanRemove', async ban => {
    const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    sendLog(ban.guild, 'logCeza', {
        title: '🕊️ Yasak Kaldırıldı (UNBAN)',
        desc: `**Kullanıcı:** ${ban.user.tag} (<@${ban.user.id}>)\n**Yasağı Kaldıran Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`,
        color: 0x57f287,
        thumbnail: ban.user.displayAvatarURL()
    });
});

// --- 5. SUNUCU VE İDARİ LOGLAR (logSunucu) ---
client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: '📁 Yeni Kanal Açıldı', desc: `**Kanal:** <#${channel.id}> (\`${channel.name}\`)\n**Açan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    sendLog(channel.guild, 'logSunucu', { title: '🗑️ Kanal Silindi', desc: `**Silinen Kanal:** \`${channel.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldChannel.name !== newChannel.name) {
        sendLog(newChannel.guild, 'logSunucu', { title: '✏️ Kanal Adı Değiştirildi', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Adı:** \`${oldChannel.name}\`\n**Yeni Adı:** \`${newChannel.name}\``, color: 0x3498db });
    }
    if (oldChannel.topic !== newChannel.topic) {
        sendLog(newChannel.guild, 'logSunucu', { title: '📝 Kanal Açıklaması (Topic) Değişti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski:** ${oldChannel.topic \vert{}\vert{} 'Yok'}\n**Yeni:** ${newChannel.topic || 'Yok'}`, color: 0x3498db });
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        sendLog(newChannel.guild, 'logSunucu', { title: '⏳ Kanal Yavaş Mod (Slowmode) Değişti', desc: `**Kanal:** <#${newChannel.id}>\n**Yetkili:** ${yetkili}\n**Eski Süre:** ${oldChannel.rateLimitPerUser} sn\n**Yeni Süre:** ${newChannel.rateLimitPerUser} sn`, color: 0xfee75c });
    }
});

client.on('roleCreate', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    sendLog(role.guild, 'logSunucu', { title: '🏷️ Yeni Rol Oluşturuldu', desc: `**Rol:** <@&${role.id}> (\`${role.name}\`)\n**Oluşturan Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('roleDelete', async role => {
    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    sendLog(role.guild, 'logSunucu', { title: '🗑️ Rol Silindi', desc: `**Silinen Rol:** \`${role.name}\`\n**Silen Yetkili:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldRole.name !== newRole.name) {
        sendLog(newRole.guild, 'logSunucu', { title: '✏️ Rol Adı Değişti', desc: `**Rol:** <@&${newRole.id}>\n**Yetkili:** ${yetkili}\n**Eski Adı:** ${oldRole.name}\n**Yeni Adı:** ${newRole.name}`, color: 0x3498db });
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        sendLog(newRole.guild, 'logSunucu', { title: '⚠️ Rol İzinleri Değiştirildi', desc: `**Rol:** <@&${newRole.id}>\n**Değiştiren Yetkili:** ${yetkili}\nRolün yetki ayarlarıyla oynandı!`, color: 0xfee75c });
    }
});

client.on('threadCreate', thread => {
    sendLog(thread.guild, 'logSunucu', { title: '🧵 Alt Başlık (Thread) Açıldı', desc: `**Başlık:** <#${thread.id}> (\`${thread.name}\`)\n**Açan:** <@${thread.ownerId}>`, color: 0x57f287 });
});

client.on('threadDelete', thread => {
    sendLog(thread.guild, 'logSunucu', { title: '🗑️ Alt Başlık (Thread) Silindi', desc: `**Silinen Başlık:** \`${thread.name}\``, color: 0xed4245 });
});

client.on('emojiCreate', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: '😀 Emoji Eklendi', desc: `**Emoji:** ${emoji} (\`${emoji.name}\`)\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('emojiDelete', async emoji => {
    const executor = await getAuditExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    sendLog(emoji.guild, 'logSunucu', { title: '🗑️ Emoji Silindi', desc: `**Silinen Emoji:** \`${emoji.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('stickerCreate', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: '🏷️ Çıkartma (Sticker) Eklendi', desc: `**Sticker:** \`${sticker.name}\`\n**Ekleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0x57f287 });
});

client.on('stickerDelete', async sticker => {
    const executor = await getAuditExecutor(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
    sendLog(sticker.guild, 'logSunucu', { title: '🗑️ Çıkartma (Sticker) Silindi', desc: `**Silinen Sticker:** \`${sticker.name}\`\n**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}`, color: 0xed4245 });
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const executor = await getAuditExecutor(newGuild, AuditLogEvent.GuildUpdate);
    const yetkili = executor ? `<@${executor.id}>` : 'Bilinmiyor';

    if (oldGuild.name !== newGuild.name) {
        sendLog(newGuild, 'logSunucu', { title: '🏢 Sunucu Adı Değiştirildi', desc: `**Yetkili:** ${yetkili}\n**Eski Adı:** ${oldGuild.name}\n**Yeni Adı:** ${newGuild.name}`, color: 0x3498db });
    }
    if (oldGuild.icon !== newGuild.icon) {
        sendLog(newGuild, 'logSunucu', { title: '🖼️ Sunucu İkonu Değiştirildi', desc: `**Yetkili:** ${yetkili}\nSunucu profil resmi güncellendi.`, color: 0x3498db, thumbnail: newGuild.iconURL() });
    }
});

// --- 6. GÜVENLİK VE İSTİHBARAT LOGLARI (logGuvenlik) ---
client.on('webhookUpdate', async channel => {
    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookCreate) || await getAuditExecutor(channel.guild, AuditLogEvent.WebhookDelete);
    sendLog(channel.guild, 'logGuvenlik', {
        title: '🚨 Webhook İşlemi Tespit Edildi!',
        desc: `**Kanal:** <#${channel.id}>\n**İşlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\nKanaldaki webhook'lar oluşturuldu, güncellendi veya silindi!`,
        color: 0xff0000
    });
});

client.on('inviteCreate', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id) || new Map();
    oldInvites.set(invite.code, invite.uses);
    invitesCache.set(invite.guild.id, oldInvites);

    sendLog(invite.guild, 'logGuvenlik', {
        title: '🔗 Yeni Davet Linki Oluşturuldu',
        desc: `**Oluşturan:** <@${invite.inviterId}>\n**Kanal:** <#${invite.channelId}>\n**Kod:** \`${invite.code}\`\n**Maks. Kullanım:** ${invite.maxUses === 0 ? 'Sınırsız' : invite.maxUses}`,
        color: 0x57f287
    });
});

client.on('inviteDelete', invite => {
    if (!invite.guild) return;
    const oldInvites = invitesCache.get(invite.guild.id);
    if (oldInvites) oldInvites.delete(invite.code);

    sendLog(invite.guild, 'logGuvenlik', {
        title: '🗑️ Davet Linki Silindi / Süresi Doldu',
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
