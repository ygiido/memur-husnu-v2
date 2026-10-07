const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

// Botun ihtiyaç duyduğu tüm yetkiler (Loglar, Mesaj okuma, Üye takibi vb.)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, // Ses kanalı logları için
        GatewayIntentBits.GuildPresences    // Kick yayını bildirimleri için
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

// Veritabanı dosyamızı kontrol ediyoruz, yoksa oluşturuyoruz
const dbPath = './database.json';
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}));
}

// Bot başarıyla açıldığında terminale bilgi verecek
client.once('ready', () => {
    console.log(`🤖 Sistem aktif! ${client.user.tag} olarak giriş yapıldı.`);
    console.log(`📊 Bot şu an ${client.guilds.cache.size} sunucuda bulunuyor.`);
});

// Hataları terminale yazdırıp botun çökmesini engelliyoruz
process.on('unhandledRejection', error => {
    console.error('Beklenmeyen bir hata oluştu:', error);
});

client.login(process.env.TOKEN);
