# Ipari MAP – 3D épületnavigáció

Készítette: **Lakatos Bence, 12/C**

Böngészőben futó, forgatható 3D modell az iskola három alaprajzából (földszint, 1. és 2. emelet, plusz az I‑szárny tetőtere), útvonaltervezéssel és körbenézhető folyosófotókkal.

## Indítás

A modulok és a `fetch()` miatt webszerverről kell megnyitni (fájlként, dupla kattintással nem megy):

```bash
# a repó gyökeréből
python3 -m http.server 8000
# majd böngészőben: http://localhost:8000/
```

GitHub Pages-en (Settings → Pages → *Deploy from a branch* → `main` / root) közvetlenül működik. A fotók a `photos/` mappában vannak (1600 px-es WebP másolatok a [BalintQ/IpariTerkep](https://github.com/BalintQ/IpariTerkep) repó folyosófotóiból); a helyük az `index.html` `data-photo-base` attribútumában átállítható.

## Mit tud

- **3D modell**: szintenként színezett termek, folyosók, lépcsőkapcsolatok; *Mind* nézetben a szintek szétnyitva (csúszka), vagy egy szint kiválasztva.
- **Keresés / útvonal**: „Honnan” és „Hová” mező (teremszám, név, pl. *titkárság*, *könyvtár*, *büfé*), lépésenkénti útleírás, idő- és távolságbecslés. Bármelyik teremre kattintva: *Útvonal ide* / *Innen indulok*.
- **Tanári folyosó szabály** (2. em., F221–F225 előtti folyosó):
  - *Diák* módban az útvonal **nem halad át** a tanári folyosón; ha emiatt kerülni kell, a panel jelzi, mennyivel hosszabb.
  - Ha a cél (vagy az indulás) a tanári folyosón van – titkárság, igazgató, igazgatóhelyettesek, nagy tanári –, az **ügyintézés** miatt beléphet, a panel ezt jelzi.
  - A csak tanároknak szóló helyiségekhez (tanári WC-k, tanári pihenő, tanári konyha) diák módban nem tervez útvonalat.
  - *Tanár* módban minden folyosó használható.
- **Legközelebbi mosdó / kijárat** egy gombnyomással, az indulási ponttól számítva.
- **Fotók**: a kék pontok a folyosókon készült fotók. Kattintásra a kamera „beugrik” a modellbe a fotó helyére, majd megnyílik a kép, amelyen húzással körbe lehet nézni és nagyítani lehet. A sarokban kis térkép mutatja, hol és melyik irányba készült. Útvonaltervezés után a „Fotó a célnál” gomb megmutatja a cél környékét.
- **Súgó**: első megnyitáskor (és a fejléc „?” gombjával) rövid útmutató jelenik meg, hogy az iskolát nem ismerők is eligazodjanak.

## Adatok szerkesztése

Minden a `data/building.json`-ban van, ezt a `tools/build.py` állítja elő:

| Fájl | Tartalom |
|---|---|
| `tools/alaprajz/*.jpg` | a három alaprajz |
| `tools/rooms.py` | termek (név, típus, alaprajzi terület), folyosó-középvonalak, lépcsők, bejáratok, a tanári folyosó jelölése |
| `tools/photos.py` | minden fotó helye (alaprajzi pixel) és nézési iránya (0 = fel/észak, 90 = jobbra/kelet …) |

```bash
pip install numpy opencv-python
python3 tools/build.py
```

Feltöltés előtt futtasd le a `python3 tools/stamp.py` parancsot is. Ez új verziószámot ír az `index.html`-be és a `version.json`-ba, így a látogatók böngészője a gyorsítótárban lévő régi fájlok helyett magától az újat tölti be.

**Fontos tudnivalók**

- Az alaprajzok sematikusak, és a szintek rajzai nem pontosan fedik egymást; a szinteket a lépcsőházaknál illesztettük össze, így a modell arányai közelítők.
- A fotók helyét és irányát a képek tartalma (ajtótáblák, lépcsők, ablakok) alapján becsültük – ha valamelyik rossz helyen van, a `tools/photos.py`-ban egy sor átírásával javítható.
- Az **I‑szárny tetőtere** (I202–I204, tanári, női és férfi WC, lépcső) nincs rajta az alaprajzokon; az elrendezése egy kézi vázlat alapján készült, a három tanterem mérete becsült.
- A „t.sz.” rövidítést az alaprajzról vettük át változtatás nélkül.

A Three.js (MIT licenc) a `vendor/` mappában van, így a térkép CDN nélkül is fut.
