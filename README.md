## KSG Goverment - Kadrioru Saksa Gümnaasiumi Korrakaitse Portaal

Ametlik veebisüsteem KSG Goverment ohvitseridele ja kodanikele.

> Ohvitseride sisselogimise koodid on salajased ja jagatakse otse ohvitseridele.

---

## Käivitamine Lokaalses Arvutis

```bash
npm install
node server.js
```

Ava brauser: http://localhost:3000

---

## Render.com Üles Laadimine

1. Loo konto [render.com](https://render.com)
2. Loo uus GitHub repo ja laadi sellesse failid üles
3. Render → "New Web Service" → ühenda GitHub repo
4. Build command: `npm install`
5. Start command: `node server.js`
6. Kliki **Deploy**!

---

## Kaardistus (Kõik Vahelehe Funktsioonid)

| Vahelehekülg | Kes näeb | Kirjeldus |
|---|---|---|
| 📢 Teated | Kõik | Ametlikud KSG teadaanded |
| 📁 Toimikud | Kõik (5-koodiga) / Ohvitserid kõiki | Juhtumite koodipõhine vaataja |
| 📝 Kandideeri | Kõik | 5-sammune avaldus ohvitseriks |
| 🛡️ Ohvitseride Koosseis | Kõik | Näitab kõiki ohvitsere |
| 📋 Avalduste Ülevaatus | Ainult ohvitserid | Kinnita/lükka tagasi avaldusi |
| 👥 Kasutajate Haldus | Ainult ohvitserid | Hoiata/bänni/kustuta kasutajaid |
| ⭐ Roger Juhtkond | Ainult Roger | Kõik koodid, nominatsioonid, ohvitseride distsipliin |
