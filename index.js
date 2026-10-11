const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        GatewayIntentBits.GuildEmojisAndStickers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

// Yapay Zeka Kurulumu
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const dbPath = './database.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));
const getDB = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));

const spamMap = new Map();

// --- DEVLET MEMURU OTO-CEVAP SİSTEMİ ---
const otoCevaplar = [
    { tetikleyiciler: ["as", "a.s", "aleyküm selam", "aleykümselam", "aleykum selam"], cevaplar: ["Hoş bulduk. Evrak kayıt bölümüne hoş geldiniz, buyurun.", "Hoş bulduk, mesaimiz devam ediyor.", "Görevinin başındayız, buyrun."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["sa", "s.a", "selam", "selamun aleyküm", "sea", "selamın aleyküm"], cevaplar: ["Aleykümselam. Devlet dairesine hoş geldiniz.", "Aleykümselam, mesai an itibarıyla yoğun, buyurun işleminiz neydi?", "Aleykümselam, evraklarınızı hazırladıysanız işleme alalım."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["günaydın", "gunaydin", "hayırlı sabahlar", "sabah şerifleriniz hayrolsun"], cevaplar: ["Günaydın. Mesaimiz başlamıştır, evraklarınızı hazırlayabilirsiniz.", "Günaydın vatandaş, sabah sabah dilekçe yoktur inşallah?"], etiketle: true, tamKelime: false },
    { tetikleyiciler: ["iyi geceler", "iyi akşamlar", "iyi aksamlar", "hayırlı geceler"], cevaplar: ["İyi geceler. Mesai saatleri dışındayız ama nöbetçi memurumuz buralarda.", "İyi akşamlar. Gecenin bu saatinde evrak kabul etmiyoruz ama dinliyorum."], etiketle: false, tamKelime: false },
    { tetikleyiciler: ["hg", "hoş geldin", "hoşgeldin"], cevaplar: ["Hoş bulduk. Dairede durumlar nasıl?", "Sağ ol vatandaş, masamıza yeni geçtik."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["bb", "görüşürüz", "gorusuruz", "ben kaçar", "çıkıyorum", "allaha emanet", "baybay"], cevaplar: ["Dosyanı kapattım, selametle.", "Allah'a emanet ol. Haftaya evrakların aslıyla gel."], etiketle: false, tamKelime: true },
    { tetikleyiciler: ["nasılsın", "naber", "nasilsin", "ne haber", "napıyorsun", "nabıyon"], cevaplar: ["657'ye tabi memur nasıl olsun, sabahtan beri evrak mühürlüyoruz. Sen nasılsın?", "Çay-evrak-mühür üçgeninde yuvarlanıp gidiyoruz."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["teşekkürler", "sağ ol", "sağol", "eyvallah", "teşekkür ederim", "eyv"], cevaplar: ["Ne demek vatandaş, kamu hizmeti görevimiz.", "Eyvallah, devletin memuruna teşekkür edilmez, görev yapılır."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["lan", "amk", "aq", "sg", "sus", "kes", "aptal", "mal"], cevaplar: ["Vatandaş! Devlet dairesinde böyle kelimeler kullanılmaz, işlem başlatırım.", "Üslubumuza dikkat edelim, tutanak tutturmak istemezsin."], etiketle: true, tamKelime: true },
    { tetikleyiciler: ["çay", "kahve", "sigara", "çorba", "molası"], cevaplar: ["Çay bardağı soğumadan evrak imzalamam, doldur usta oradan.", "Mesai arası çay molası memurun hakkıdır."], etiketle: false, tamKelime: false }
];

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
    if (!db[guild.id].users[member.id]) db[guild.id].users[member.id] = { jailCount: 0, minorJailCount: 0, sicilli: false };

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
        desc: `**Kullanıcı:** <@${member.id}>\n**Sebep:** ${reason}\n**Süre:** ${durationMins} dakika\n**Toplam İhlali:** ${userData.jailCount}\n**Sicil Dosyası:** İşlendi 📜`,
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
                            desc: `**Kullanıcı:** <@${member.id}>\nKullanıcının uzaklaştırma süresi doldu ve serbest bırakıldı.`,
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
    console.log(`🤖 Sistem aktif! ${client.user.tag} (Evrak Kayıt) giriş yaptı.`);
    
    // --- YAPAY ZEKA BAĞLANTI TESTİ ---
    if (process.env.GEMINI_API_KEY) {
        console.log("✅ Yapay Zeka (Gemini) başarıyla bağlandı!");
    } else {
        console.log("❌ DİKKAT: GEMINI_API_KEY bulunamadı! Yapay zeka çalışmayacak. Lütfen Render ortam değişkenlerini kontrol edin.");
    }
    // ---------------------------------

    const commands = [
        {
            name: 'ayar',
            description: 'Botun temel sistemlerini ayarlar (Sadece Yöneticiler).',
            options: [
                { name: 'yetkili-rol', type: 8, description: 'Botu yönetecek makam yetkilisi (@rol)' },
                { name: 'muaf-rol', type: 8, description: 'İşlemlerden muaf tutulacak rol (@rol)' },
                { name: 'jail-rol', type: 8, description: 'Uzaklaştırma (Hapis) alanlara verilecek rol (@rol)' },
                { name: 'sicil-rol', type: 8, description: 'Sicili kirlenenlere verilecek mühürlü rol (@rol)' },
                { name: 'log-ceza', type: 7, description: 'Ceza ve Adli Sicil arşiv kanalı (#kanal)' },
                { name: 'log-genel', type: 7, description: 'Genel Evrak Kayıt (Log) arşiv kanalı (#kanal)' },
                { name: 'kick-bot', type: 6, description: 'Duyurusu pusuya düşürülecek Kick botu (@bot)' },
                { name: 'kick-kanal', type: 7, description: 'Memur Hüsnü\'nün onaylı duyuru yapacağı kanal (#kanal)' },
                { name: 'link-engel', type: 5, description: 'Link paylaşımı yasaklansın mı? (True/False)' },
                { name: 'oto-cevap', type: 5, description: 'Memur vatandaşlarla sohbet etsin mi? (True/False)' }
            ]
        },
        { name: 'info', description: 'Kurum istatistiklerini ve sistem ayarlarını gösterir.' },
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
            description: 'Daire adına resmi bir metin yazdırırsınız.',
            options: [{ name: 'mesaj', type: 3, description: 'Yazdırılacak metin', required: true }]
        },
        {
            name: 'sil',
            description: 'Belirtilen miktarda evrakı/mesajı imha eder.',
            options: [{ name: 'miktar', type: 4, description: 'İmha edilecek mesaj sayısı (1-100)', required: true }]
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
        if (!isAdmin) return interaction.reply({ content: '❌ Bu işlemi sadece Kurum Müdürleri (Yöneticiler) yapabilir.', ephemeral: true });
        if (!db[guildId]) db[guildId] = { users: {} };
        const opts = ['yetkili-rol', 'muaf-rol', 'jail-rol', 'sicil-rol', 'log-ceza', 'log-genel', 'kick-bot', 'kick-kanal'];
        opts.forEach(opt => {
            const val = interaction.options.get(opt);
            if (val) db[guildId][opt.replace(/-([a-z])/g, g => g[1].toUpperCase())] = val.value;
        });
        
        const linkEngel = interaction.options.getBoolean('link-engel');
        if (linkEngel !== null) db[guildId].linkEngel = linkEngel;
        
        const otoCevap = interaction.options.getBoolean('oto-cevap');
        if (otoCevap !== null) db[guildId].otoCevap = otoCevap;
        
        saveDB(db);
        return interaction.reply({ content: '✅ Kurum sistem ayarları evraka işlendi ve kaydedildi!', ephemeral: true });
    }

    if (['info', 'yaz', 'sil', 'af', 'hapis'].includes(interaction.commandName)) {
        if (!isAdmin && !isYetkili) return interaction.reply({ content: '❌ Bu arşive erişim yetkiniz bulunmamaktadır.', ephemeral: true });

        if (interaction.commandName === 'info') {
            const guildDb = db[guildId] || {};
            const getRole = (id) => id ? `<@&${id}>` : '❌ Atanmamış';
            const getChannel = (id) => id ? `<#${id}>` : '❌ Atanmamış';
            const getUser = (id) => id ? `<@${id}>` : '❌ Atanmamış';

            const embed = new EmbedBuilder()
                .setTitle(`🏛️ ${interaction.guild.name} - Kurum Otomasyon Paneli`)
                .setColor(0x2b2d31)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '📌 Nüfus İstatistikleri', value: `👥 Kayıtlı Vatandaş: **${interaction.guild.memberCount}**`, inline: false },
                    { name: '⚙️ Makam ve Yaptırım Rolleri', value: `👑 Yetkili Makam: ${getRole(guildDb.yetkiliRol)}\n🛡️ Dokunulmaz: ${getRole(guildDb.muafRol)}\n🚔 Uzaklaştırma: ${getRole(guildDb.jailRol)}\n📜 Sicili Bozuk: ${getRole(guildDb.sicilRol)}`, inline: false },
                    { name: '📂 Arşiv Müdürlüğü (Log)', value: `🔨 Adli Sicil Arşivi: ${getChannel(guildDb.logCeza)}\n📋 Genel Evrak Arşivi: ${getChannel(guildDb.logGenel)}\n🎥 Onaylı Yayın Kanalı: ${getChannel(guildDb.kickKanal)}\n🤖 Takip Edilen Bot: ${getUser(guildDb.kickBot)}`, inline: false },
                    { name: '🛡️ Kurum Kuralları', value: `🔗 Link Paylaşımı Engeli: **${guildDb.linkEngel ? '✅ Aktif' : '❌ Kapalı'}**\n💬 Memur Sohbeti: **${guildDb.otoCevap !== false ? '✅ Aktif' : '❌ Kapalı'}**`, inline: false }
                ).setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'hapis') {
            const user = interaction.options.getUser('kullanici');
            const sayi = interaction.options.getInteger('sayi');
            const kavram = interaction.options.getString('kavram');
            const sebep = interaction.options.getString('sebep');
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!member) return interaction.reply({ content: '❌ Vatandaş sistemde bulunamadı.', ephemeral: true });

            let sureMs = 0;
            if (kavram === 'saniye') sureMs = sayi * 1000;
            if (kavram === 'dakika') sureMs = sayi * 60 * 1000;
            if (kavram === 'saat') sureMs = sayi * 60 * 60 * 1000;
            if (kavram === 'gun') sureMs = sayi * 24 * 60 * 60 * 1000;

            const sureDk = sureMs / (1000 * 60);

            if (!db[guildId].users) db[guildId].users = {};
            if (!db[guildId].users[user.id]) db[guildId].users[user.id] = { jailCount: 0, minorJailCount: 0, sicilli: false };

            let userData = db[guildId].users[user.id];
            userData.jailExpire = Date.now() + sureMs;
            userData.jailCount += 1;

            let sicilVerilecek = false;
            let sicilDurumMesaji = "";

            if (sureDk > 10) {
                sicilVerilecek = true;
                sicilDurumMesaji = "İşlendi 📜 (İhlal 10 dakikadan uzun)";
            } else {
                userData.minorJailCount = (userData.minorJailCount || 0) + 1;
                if (userData.minorJailCount >= 11) {
                    sicilVerilecek = true;
                    sicilDurumMesaji = `İşlendi 📜 (Sınır aşıldı: ${userData.minorJailCount}/11)`;
                } else {
                    sicilDurumMesaji = `Temiz 🟢 (Hafif Suç - Sınır: ${userData.minorJailCount}/11)`;
                }
            }

            if (sicilVerilecek) userData.sicilli = true;
            saveDB(db);

            if (db[guildId].jailRol) await member.roles.add(db[guildId].jailRol).catch(() => {});
            if (sicilVerilecek && db[guildId].sicilRol) await member.roles.add(db[guildId].sicilRol).catch(() => {});

            sendLog(interaction.guild, 'logCeza', {
                title: '🚨 Manuel Uzaklaştırma İşlemi',
                desc: `**İşlemi Yapan:** <@${interaction.user.id}>\n**Vatandaş:** <@${user.id}>\n**Süre:** ${sayi} ${kavram}\n**Gerekçe:** ${sebep}\n\n**Sicil Dosyası:** ${sicilDurumMesaji}`,
                color: 0xed4245,
                thumbnail: user.displayAvatarURL()
            });

            return interaction.reply({ content: `✅ <@${user.id}> adlı vatandaşa ${sayi} ${kavram} işlem uygulandı.`, ephemeral: true });
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
                    sendLog(interaction.guild, 'logCeza', { title: '🕊️ Mahkeme Kararı: Af (Beraat)', desc: `<@${user.id}> adlı vatandaşın adli sicili ve dosyaları tamamen temizlendi.`, color: 0x57f287 });
                    return interaction.reply({ content: `${user.tag} adlı vatandaşın sicili temizlendi.`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `❌ **${user.tag}** adlı vatandaşın zaten kaydı temiz.`, ephemeral: true });
                }
            } else {
                db[guildId].users = {};
                saveDB(db);
                sendLog(interaction.guild, 'logCeza', { title: '🕊️ Kanun Hükmünde Kararname: Genel Af', desc: `Kurumdaki **TÜM** vatandaşların ceza ve sicil kayıtları imha edilmiştir.`, color: 0x57f287 });
                return interaction.reply({ content: 'Tüm siciller sıfırlandı.', ephemeral: true });
            }
        }
        
        if (interaction.commandName === 'yaz') {
            const mesaj = interaction.options.getString('mesaj');
            await interaction.channel.send(mesaj);
            return interaction.reply({ content: 'Evrak kanala iletildi.', ephemeral: true });
        }

        if (interaction.commandName === 'sil') {
            const miktar = interaction.options.getInteger('miktar');
            if (miktar < 1 || miktar > 100) return interaction.reply({ content: '1 ile 100 arasında bir sayı girin.', ephemeral: true });
            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            return interaction.reply({ content: `${miktar} adet evrak imha edildi.`, ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (!message.guild) return;
    const db = getDB();
    const guildId = message.guild.id;
    if (!db[guildId]) return;

    // --- KICK BOT PUSU SİSTEMİ ---
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
                    new ButtonBuilder().setLabel('🔴 Kurum Onaylı Yayına Katıl').setStyle(ButtonStyle.Link).setURL(kickLink)
                );
                const kickEmbed = new EmbedBuilder()
                    .setTitle('🎥 Canlı Yayın Başlamıştır (Duyuru)')
                    .setDescription(`Evrak kayıtlarına göre yetkili yayın şu an aktiftir!\n\nAşağıdaki resmi butona tıklayarak izleyici bölümüne geçiş yapabilirsiniz.`)
                    .setColor(0x53f22b)
                    .setThumbnail(message.guild.iconURL({ dynamic: true }))
                    .setTimestamp();
                const duyuruKanali = message.guild.channels.cache.get(db[guildId].kickKanal);
                if (duyuruKanali) duyuruKanali.send({ content: '@everyone', embeds: [kickEmbed], components: [row] }).catch(() => {});
                return; 
            }
        }
    }

    if (message.author.bot) return;

    // --- YAPAY ZEKA (GEMINI) SOHBET SİSTEMİ ---
    if (message.mentions.has(client.user) && !message.mentions.everyone && genAI) {
        try {
            await message.channel.sendTyping();
            
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                systemInstruction: "Senin adın Memur Hüsnü. Sen 657 sayılı kanuna tabi, hafif esprili, bürokratik, dürüst ve işkolik bir Türk devlet memurusun. Cümlelerinde 'vatandaş', 'evrak', 'mühür', 'mesai', 'dilekçe' gibi kelimeler kullanmayı seversin. Asla bir yapay zeka veya bot olduğunu kabul etmez, 'Ben KPSS ile atandım 92 puanla' dersin. Kullanıcılara yardımcı olurken devlet dairesi ciddiyetini bozmadan hafif alaycı ve babacan bir tavır sergilersin. Cevaplarını çok uzatmadan, Discord'da rahat okunacak şekilde kısa ve öz tut."
            });
            
            // Botun kendi etiketini (pingini) mesajdan temizle
            const userPrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
            
            if (userPrompt.length === 0) {
                return message.reply("Vatandaş, boş kağıda mühür basmıyoruz. Ne sormak istiyorsan dilekçene açıkça yaz.");
            }

            const result = await model.generateContent(userPrompt);
            const response = result.response.text();
            
            await message.reply(response);
            return; 
        } catch (error) {
            console.error("Yapay Zeka Hatası:", error);
            await message.reply("Sistemlerde şu an bir arıza var vatandaş, e-devlet çökmüş olabilir. Daha sonra tekrar dene.");
            return;
        }
    }

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
            message.channel.send(`${message.member}, evraklarda büyük harf (Caps Lock) kullanmak yasaktır!`).then(m => setTimeout(() => m.delete(), 4000));
            sendLog(message.guild, 'logCeza', { title: '⚠️ Kural İhlali (Büyük Harf)', desc: `**Vatandaş:** <@${message.author.id}>\nCaps lock kullanımı nedeniyle uyarıldı.`, color: 0xfee75c });
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
        await applyJail(message.member, message.guild, "Kurum İçi Spam / Flood Yapmak");
    }
});

// LOG EVENTLERİ
client.on('guildUpdate', (oldGuild, newGuild) => { if (oldGuild.name !== newGuild.name) sendLog(newGuild, 'logGenel', { title: '🏢 Kurum Adı Güncellendi', desc: `Eski: **${oldGuild.name}**\nYeni: **${newGuild.name}**`, color: 0x3498db }); if (oldGuild.icon !== newGuild.icon) sendLog(newGuild, 'logGenel', { title: '🖼️ Kurum Logosu Değişti', desc: `Sunucu ikonu güncellendi.`, color: 0x3498db, thumbnail: newGuild.iconURL() }); });
client.on('roleCreate', role => { sendLog(role.guild, 'logGenel', { title: '🏷️ Yeni Rol (Makam) Oluşturuldu', desc: `<@&${role.id}> (\`${role.name}\`)`, color: 0x57f287 }); });
client.on('roleDelete', role => { sendLog(role.guild, 'logGenel', { title: '🗑️ Rol (Makam) İptal Edildi', desc: `**${role.name}** rolü silindi.`, color: 0xed4245 }); });
client.on('roleUpdate', (oldRole, newRole) => { if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) sendLog(newRole.guild, 'logGenel', { title: '⚠️ Rol İzinleri Değiştirildi', desc: `<@&${newRole.id}> rolünün yetkileriyle oynandı. Lütfen kontrol ediniz.`, color: 0xfee75c }); });
client.on('channelCreate', channel => { sendLog(channel.guild, 'logGenel', { title: '📁 Yeni Evrak Kanalı Açıldı', desc: `<#${channel.id}> (\`${channel.name}\`)`, color: 0x57f287 }); });
client.on('channelDelete', channel => { sendLog(channel.guild, 'logGenel', { title: '🗑️ Kanal Kapatıldı', desc: `**${channel.name}** kanalı silindi.`, color: 0xed4245 }); });
client.on('channelUpdate', (oldChannel, newChannel) => { if (oldChannel.name !== newChannel.name) sendLog(newChannel.guild, 'logGenel', { title: '✏️ Kanal Adı Değişti', desc: `Eski: **${oldChannel.name}**\nYeni: <#${newChannel.id}>`, color: 0x3498db }); });
client.on('emojiCreate', emoji => { sendLog(emoji.guild, 'logGenel', { title: '😀 Emoji Kaydedildi', desc: `**${emoji.name}** emojisi eklendi. ${emoji}`, color: 0x57f287 }); });
client.on('inviteCreate', invite => { sendLog(invite.guild, 'logGenel', { title: '🔗 Davet Linki Basıldı', desc: `**Basan Memur:** <@${invite.inviterId}>\n**Link:** ${invite.url}\n**Kanal:** <#${invite.channelId}>`, color: 0x57f287 }); });
client.on('guildBanAdd', ban => { sendLog(ban.guild, 'logCeza', { title: '🚫 Sınır Dışı Edildi (BAN)', desc: `**Vatandaş:** ${ban.user.tag}\nSunucudan kalıcı olarak uzaklaştırıldı.`, color: 0x992d22, thumbnail: ban.user.displayAvatarURL() }); });
client.on('guildBanRemove', ban => { sendLog(ban.guild, 'logCeza', { title: '🕊️ Sınır İhlali Affı (UNBAN)', desc: `**Vatandaş:** ${ban.user.tag}\nKullanıcının sunucuya giriş yasağı kaldırıldı.`, color: 0x57f287 }); });
client.on('guildMemberAdd', member => { sendLog(member.guild, 'logGenel', { title: '📥 Kuruma Giriş Yaptı', desc: `<@${member.id}> kuruma kayıt oldu.`, color: 0x57f287, thumbnail: member.user.displayAvatarURL() }); });
client.on('guildMemberRemove', member => { sendLog(member.guild, 'logGenel', { title: '📤 Kurumdan Ayrıldı', desc: `**${member.user.tag}** ayrıldı.`, color: 0xed4245, thumbnail: member.user.displayAvatarURL() }); });
client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) sendLog(newMember.guild, 'logGenel', { title: '👤 Sicil Adı Değiştirildi', desc: `**Vatandaş:** <@${newMember.id}>\n**Eski:** ${oldMember.nickname || oldMember.user.username}\n**Yeni:** ${newMember.nickname || newMember.user.username}`, color: 0x3498db });
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    if (addedRoles.size > 0) sendLog(newMember.guild, 'logGenel', { title: '🏷️ Makam / Rol Verildi', desc: `**Vatandaş:** <@${newMember.id}>\n**Verilen:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0x57f287 });
    if (removedRoles.size > 0) sendLog(newMember.guild, 'logGenel', { title: '🗑️ Makam / Rol Geri Alındı', desc: `**Vatandaş:** <@${newMember.id}>\n**Alınan:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`, color: 0xed4245 });
});
client.on('messageDelete', message => {
    if (!message.guild || (message.author && message.author.bot)) return;
    const content = message.content ? message.content : "[İçerik yok veya sadece görsel]";
    sendLog(message.guild, 'logGenel', { title: '🗑️ Evrak İmha Edildi', desc: `**Yazan:** <@${message.author ? message.author.id : 'Bilinmiyor'}>\n**Kanal:** <#${message.channel.id}>\n\n**İçerik:**\n${content}`, color: 0xed4245 });
});
client.on('messageDeleteBulk', messages => {
    const guild = messages.first().guild;
