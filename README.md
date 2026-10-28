# Memur Hüsnü v2.0 - Gelişmiş Discord Yönetim Botu

Gelişmiş moderasyon, 6 kategorili ultra detaylı log, dinamik geçici ses odaları, ön formlu çoklu destek/başvuru (ticket) sistemi ve akıllı güvenlik filtrelerine sahip kurumsal Discord yönetim botu.

---

## 🚀 Öne Çıkan Özellikler

### 1. 🧭 Görsel Kontrol Paneli (`/panel`)
- Komut ezberletmeyen, tamamen buton ve açılır menülerden (`SelectMenu`, `Modal`) oluşan interaktif yönetim dashboard'u.
- **Sistem Ayarları:** Yetkili, Muaf, Cezalı (Jail) ve Sicilli rollerini arayüzden tek tıkla seçme.
- **Log Ayarları:** 6 farklı log kategorisini ilgili kanallarla bağlama.
- **Ticket Kurulumu:** İstenen kategori ve kanala özel başvuru/destek kutusu konuşlandırma.

### 2. 🛡️ Güvenlik ve Kademeli Ceza Sistemi
- **Anti-Bypass Küfür & Argo Motoru:** Leetspeak, harf uzatmaları ve gizleme taktiklerini normalize eden filtreleme; 1. ve 2. ihlalde kendini imha eden uyarı mesajı, 3. ihlalde otomatik hapis (jail).
- **Kademeli Spam / Flood Koruması:** 3 saniye içinde 4 mesajda ilk ihlalde 3 dakika zaman aşımı (timeout), tekrarlanması halinde hapis cezası.
- **Caps Lock Koruması:** %75'in üzerinde büyük harf içeren mesajları anında siler ve uyarır (yeni mesaj ve düzenlemelerde aktiftir).
- **Yasaklı Link Koruması:** Tenor ve Giphy gibi Discord medya linkleri hariç harici bağlantıları silerek cezalandırır.
- **Otomatik Tahliye Döngüsü:** Süresi biten cezalı kullanıcıların rollerini otomatik olarak kaldırır.
- **Akıllı Sicil Puanı:** 10 dakikadan uzun cezalarda veya 11 hafif ihlal sınırını aşanlara sicil kaydı ve sicilli rolü işler.

### 3. 🎙️ Dinamik Geçici Ses Odaları (Temp Voice)
- Belirlenen odaya bağlanan kullanıcıya anında özel bir ses odası oluşturup taşır.
- **Oda Kontrol Paneli:** Odayı kilitleme/açma, görünür/gizli yapma, sohbeti açma/kapatma, isim değiştirme (5 dk cooldown), kişi sınırı koyma, güvenilen kullanıcı ekleme (`Trust`), engelleme (`Block`), oda devri.
- **Sahiplik Devri (Claim):** Oda sahibi sesten ayrılırsa odadaki diğer üyelere sahipliği alma butonu sunulur.
- **Otomatik Temizlik:** Boşalan odaları anında siler; bot açılışında hayalet boş odaları temizler.

### 4. 🎫 Ön Formlu (Modal) Destek & Başvuru (Ticket) Sistemi
- Çoklu kanal desteği: Farklı birimler için (Örn: Yetkili Başvuru, Şikayet, Teknik Destek) bağımsız kutular.
- Talep oluşturan kullanıcıya interaktif konu ve detay formu (Modal) sunar.
- Yetkili yönetim butonları: "Talebi Üstlen (Claim)", "Kilitle/Aç", "Üye Ekle/Çıkar", "Kapat ve Arşivle".
- Bilet kapatıldığında tüm konuşma geçmişini `.txt` dosyası olarak Mesaj Log kanalına arşivler.

### 5. 📜 6 Kategorili Detaylı Log Sistemi
1. **Ceza Log:** Ban, Unban, Kick, Timeout, Hapis, Af ve filtre cezaları.
2. **Mesaj Log:** Silinen mesajlar (silinen fotoğrafları CDN'den indirip kanıt olarak geri yükler), düzenlenen mesajlar, hayalet etiketler (Ghost Ping) ve Ticket arşivleri.
3. **Ses Log:** Giriş-çıkışlar, odada geçirilen net süre (mesai takibi), yetkili susturma/sağırlaştırma, ekran paylaşımı ve kamera takibi.
4. **Üye Log:** Katılanlar (davet eden kişi ve kullanım sayısıyla), ayrılanlar, takma ad, sunucu içi ve global profil resmi değişiklikleri, rol alıp vermeler, Nitro Boost takviyeleri.
5. **Sunucu Log:** Kanal, rol, emoji, çıkartma işlemleri ve kritik rol izinleri eklendiğinde kırmızı alarm sistemi.
6. **Güvenlik Log:** 15 günden yeni açılmış şüpheli hesap girişi alarmları, 24 saat dolmadan çıkan fake davetler, sunucuya eklenen botlar ve webhook işlemleri.

---

## 🛠️ Kurulum ve Çalıştırma

### Gereksinimler
- **Node.js:** v18.0.0 veya üzeri
- **NPM:** Node ile birlikte gelir

### Adımlar

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. `.env` dosyasını oluşturun veya açıp Discord Bot Token'ınızı ekleyin:
   ```env
   TOKEN=DISCORD_BOT_TOKENINIZ
   PORT=3000
   ```

3. Botu başlatın:
   ```bash
   npm start
   ```

---

## ⚙️ Discord Geliştirici Portalı Gereksinimleri
Botun sorunsuz çalışması için Discord Developer Portal üzerinden aşağıdaki **Privileged Gateway Intents** seçeneklerinin açık olması gereklidir:
- **Presence Intent**
- **Server Members Intent**
- **Message Content Intent**
