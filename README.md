# Forum

Node.js ile yazılmış, FiveM topluluklarına yönelik modern bir Türkçe forum yazılımı. Kategoriler, konu önekleri, bildirimler, özel mesajlar ve tam bir yönetim paneli içerir. Harici veritabanı sunucusu gerektirmez; her şey tek bir SQLite dosyasında tutulur.

## Özellikler

**Forum**
- Kategoriler ve forumlar, forum bazında yazma yetkisi (herkes / yetkililer / sadece admin)
- Konu önekleri (Script, Paylaşım, Soru, Çözüldü…) ve öneke göre filtreleme
- Ana sayfada sekmeli son konular tablosu (yeni mesajlar, yeni konular, en çok cevap, tepki, görüntülenme)
- Gündem şeridi, sabit ve öne çıkarılmış konular, benzer konular
- BBCode editörü: kalın, italik, bağlantı, resim, alıntı, kod, spoiler, YouTube videosu
- `@kullanıcı` etiketleme, alıntılama, tepkiler, arama

**Üyeler**
- Kayıt / giriş, profil sayfası, hakkında ve konum bilgisi
- Avatar ve kapak görseli yükleme (tarayıcıda kırpma ve WebP'ye dönüştürme)
- Bildirimler: cevap, alıntı, etiket, tepki, rol değişikliği
- Çok kişili özel mesajlaşma (sohbete kişi ekleme, sohbetten ayrılma)
- Çevrim içi üyeler ve misafir sayısı

**Yönetim paneli**
- Genel bakış istatistikleri
- Forum yapısı: kategori ve forum ekleme, düzenleme, sıralama, yetki ayarları
- Konu öneklerini yönetme
- Kullanıcılar: rol, ünvan, isim rengi, yasaklama, şifre sıfırlama, silme
- Moderasyon: konu sabitleme, öne çıkarma, kilitleme, taşıma, yeniden adlandırma, silme
- Site ayarları ve işlem kayıtları

**Güvenlik**
- scrypt ile şifre saklama
- Tüm formlarda CSRF koruması
- Yüklenen dosyalarda içerik (magic byte) kontrolü, yalnızca JPG / PNG / GIF / WebP

## Gereksinimler

- [Node.js](https://nodejs.org) **22.13 veya üzeri** (yerleşik `node:sqlite` modülü kullanılıyor)

## Kurulum

```bash
git clone <depo-adresi>
cd forumsitesi
npm install
npm start
```

Site `http://localhost:3000` adresinde açılır. Geliştirme sırasında dosya değişince otomatik yeniden başlatmak için:

```bash
npm run dev
```

İlk çalıştırmada `data/forum.db` veritabanı oluşturulur; örnek kategoriler, forumlar ve önekler eklenir.

## Varsayılan yönetici hesabı

| Kullanıcı adı | Şifre   |
|---------------|---------|
| `admin`       | `admin` |

> ⚠️ Siteyi yayına almadan önce bu şifreyi **Hesap ayarları** sayfasından mutlaka değiştir.

## Ortam değişkenleri

| Değişken         | Açıklama                                          | Varsayılan            |
|------------------|---------------------------------------------------|-----------------------|
| `PORT`           | Sunucunun dinleyeceği port                         | `3000`                |
| `SESSION_SECRET` | Oturum çerezlerini imzalayan gizli anahtar         | Otomatik üretilir ve veritabanına kaydedilir |

## Proje yapısı

```
src/
  server.js          Express uygulaması, oturum, CSRF, ortak değişkenler
  db.js              SQLite şeması, geçişler ve ilk kurulum verisi
  helpers.js         BBCode, tarih ve metin yardımcıları
  middleware.js      Giriş / yetki kontrolleri
  notify.js          Bildirim mantığı
  conversations.js   Özel mesaj sorguları
  presence.js        Çevrim içi misafir takibi
  uploads.js         Görsel yükleme ve doğrulama
  routes/            auth, forum, members, conversations, admin
views/               EJS şablonları
public/              CSS ve istemci JavaScript'i
data/                Veritabanı ve yüklenen dosyalar (git'e dahil değil)
```

## Kullanılan teknolojiler

Express · EJS · node:sqlite · cookie-session · multer

## Yedekleme

Tüm veriler `data/` klasöründedir. Sunucuyu durdurup bu klasörü kopyalamak yedek almak için yeterlidir.
