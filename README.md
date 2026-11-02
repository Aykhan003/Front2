# FlightReservationSystem.Frontend

Flight Reservation System üçün veb interfeys (HTML + CSS + vanilla JavaScript, quraşdırma tələb etmir).

## İşə salma

- `index.html` faylını brauzerdə açın, **və ya**
- VS Code-da **Live Server** genişlənməsi ilə: `index.html` → sağ klik → *Open with Live Server*.

## Struktur

| Fayl | Məzmun |
|---|---|
| `index.html` | Səhifə skeleti, sidebar, modal |
| `css/style.css` | Bütün dizayn |
| `js/data.js` | Entity-lər, enum-lar, demo məlumatlar, `Store` (localStorage) |
| `js/app.js` | `Service` (biznes qaydaları) + səhifələr |

## Səhifələr

İdarə paneli · Uçuşlar (axtarış, oturacaq xəritəsi ilə bron) · Rezervasiyalar (təsdiq, ləğv, bilet əlavəsi) · Biletlər · Sərnişinlər · Təyyarələr · Hava limanları · Qiymət qaydaları · Hesabatlar

## Biznes qaydaları

C# `Business` qatındakı qaydalar JS-də təkrarlanıb: oturacaq düzümü (business sıraları əvvəl, A/B/C), sinfə uyğun oturacaq, eyni oturacağın iki dəfə satılmaması, `min(oturacaq sayı, AvailableSeatLimit)` limiti, endirimli qiymət hesablanması, 24 saatdan sonra `Pending → Expired`, uçuş/rezervasiya ləğvində kaskad ləğv, üst-üstə düşən uçuşlar və `Maintenance` təyyarə yoxlaması, yalnız `Confirmed` rezervasiyalardan gəlir hesabatı.

## Qeyd

Hazırkı backend konsol tətbiqi olduğu üçün frontend məlumatları brauzerin `localStorage`-ində saxlayır (sol aşağıdakı düymə ilə demo məlumatları sıfırlamaq olar). Gələcəkdə ASP.NET Core Web API layihəsi əlavə edilsə, yalnız `js/data.js` içindəki `Store` metodlarını `fetch()` çağırışları ilə əvəz etmək kifayətdir.
