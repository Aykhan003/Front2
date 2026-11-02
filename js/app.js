// =====================================================================
//  Service layer — Business qatındakı qaydaların JS versiyası
// =====================================================================

class BusinessError extends Error {}
const fail = msg => { throw new BusinessError(msg); };

const Seats = {
  letters: ["A", "B", "C"],
  // Əvvəlcə business, sonra economy oturacaqları; hər sırada A, B, C
  layout(aircraft) {
    const seats = [];
    const total = aircraft.businessClassSeats + aircraft.economyClassSeats;
    for (let i = 0; i < total; i++) {
      seats.push({
        number: `${Math.floor(i / 3) + 1}${this.letters[i % 3]}`,
        row: Math.floor(i / 3) + 1,
        classType: i < aircraft.businessClassSeats ? 1 : 0,
      });
    }
    return seats;
  },
  classOf(aircraft, seatNumber) {
    const s = this.layout(aircraft).find(x => x.number === seatNumber.toUpperCase());
    return s ? s.classType : null;
  },
};

const Service = {
  flightView(f) {
    return {
      ...f,
      aircraft: Store.get("aircraft", f.aircraftId),
      from: Store.get("airports", f.departureAirportId),
      to: Store.get("airports", f.arrivalAirportId),
    };
  },

  rule(flightId, classType) {
    return Store.all("flightPriceRules").find(r => r.flightId === Number(flightId) && r.classType === Number(classType));
  },

  // ReportService.ApplyDiscountAsync
  price(flightId, classType) {
    const r = this.rule(flightId, classType);
    if (!r) return null;
    return { base: r.basePrice, final: round2(r.basePrice * (1 - r.discountPercentage / 100)), discount: r.discountPercentage };
  },

  activeTickets(flightId) {
    return Store.all("tickets").filter(t => t.flightId === Number(flightId) && t.status !== 2);
  },

  takenSeats(flightId) {
    return new Set(this.activeTickets(flightId).map(t => t.seatNumber));
  },

  classLimit(flight, classType) {
    const ac = Store.get("aircraft", flight.aircraftId);
    const seats = classType === 1 ? ac.businessClassSeats : ac.economyClassSeats;
    const r = this.rule(flight.id, classType);
    return r ? Math.min(seats, r.availableSeatLimit) : 0;
  },

  availableInClass(flight, classType) {
    const sold = this.activeTickets(flight.id).filter(t => t.classType === classType).length;
    return Math.max(0, this.classLimit(flight, classType) - sold);
  },

  availableSeatCount(flightId) {
    const f = Store.get("flights", flightId);
    return this.availableInClass(f, 0) + this.availableInClass(f, 1);
  },

  soldTicketCount(flightId) {
    return this.confirmedTickets().filter(t => t.flightId === Number(flightId)).length;
  },

  confirmedTickets() {
    return Store.all("tickets").filter(t => {
      const r = Store.get("reservations", t.reservationId);
      return t.status !== 2 && r && r.status === 1;
    });
  },

  flightRevenue(flightId) {
    return round2(this.confirmedTickets().filter(t => t.flightId === Number(flightId)).reduce((s, t) => s + t.finalPrice, 0));
  },

  totalRevenue() {
    return round2(this.confirmedTickets().reduce((s, t) => s + t.finalPrice, 0));
  },

  recalcReservation(resId) {
    const total = Store.all("tickets").filter(t => t.reservationId === resId && t.status !== 2).reduce((s, t) => s + t.finalPrice, 0);
    Store.update("reservations", resId, { totalPrice: round2(total) });
  },

  // 24 saat təsdiqlənməyən və ya uçuşu yola düşmüş Pending rezervasiyalar → Expired
  expirePending() {
    const now = Date.now();
    let count = 0;
    Store.all("reservations").filter(r => r.status === 0).forEach(r => {
      const f = Store.get("flights", r.flightId);
      const tooOld = now - new Date(r.reservationDate).getTime() > 24 * 3600 * 1000;
      const departed = f && new Date(f.departureTime).getTime() <= now;
      if (tooOld || departed) {
        Store.update("reservations", r.id, { status: 3 });
        Store.all("tickets").filter(t => t.reservationId === r.id).forEach(t => Store.update("tickets", t.id, { status: 2 }));
        count++;
      }
    });
    return count;
  },

  validateFlight(data, id = null) {
    if (!data.flightNumber.trim()) fail("Uçuş nömrəsi boş ola bilməz.");
    const dup = Store.all("flights").find(f => f.flightNumber.toLowerCase() === data.flightNumber.trim().toLowerCase() && f.id !== id);
    if (dup) fail("Bu uçuş nömrəsi artıq mövcuddur.");
    if (data.departureAirportId === data.arrivalAirportId) fail("Yola düşmə və çatma hava limanı eyni ola bilməz.");
    const dep = new Date(data.departureTime), arr = new Date(data.arrivalTime);
    if (isNaN(dep) || isNaN(arr)) fail("Tarixləri düzgün daxil edin.");
    if (arr <= dep) fail("Çatma vaxtı yola düşmə vaxtından sonra olmalıdır.");
    const ac = Store.get("aircraft", data.aircraftId);
    if (!ac) fail("Təyyarə tapılmadı.");
    if (ac.status === 1) fail("Texniki baxışda (Maintenance) olan təyyarəyə uçuş təyin edilə bilməz.");
    if (ac.status === 2) fail("İstismardan çıxarılmış (Retired) təyyarəyə uçuş təyin edilə bilməz.");
    const overlap = Store.all("flights").find(f =>
      f.id !== id && f.aircraftId === ac.id && f.status !== 4 &&
      new Date(f.departureTime) < arr && new Date(f.arrivalTime) > dep);
    if (overlap) fail(`Bu təyyarənin ${overlap.flightNumber} uçuşu ilə vaxtı üst-üstə düşür.`);
  },

  cancelFlight(id) {
    Store.update("flights", id, { status: 4 });
    Store.all("reservations").filter(r => r.flightId === id && (r.status === 0 || r.status === 1)).forEach(r => {
      Store.update("reservations", r.id, { status: 2, cancelReason: "Uçuş ləğv edildi" });
    });
    Store.all("tickets").filter(t => t.flightId === id && t.status === 0).forEach(t => Store.update("tickets", t.id, { status: 2 }));
  },

  checkSeat(flight, seatNumber, classType, pending = []) {
    const ac = Store.get("aircraft", flight.aircraftId);
    const cls = Seats.classOf(ac, seatNumber);
    if (cls === null) fail(`${seatNumber} oturacağı bu təyyarədə yoxdur.`);
    if (cls !== classType) fail(`${seatNumber} oturacağı ${Enums.ClassType[classType]} sinfinə uyğun deyil.`);
    if (this.takenSeats(flight.id).has(seatNumber) || pending.includes(seatNumber)) fail(`${seatNumber} oturacağı artıq tutulub.`);
    if (!this.rule(flight.id, classType)) fail(`Bu uçuş üçün ${Enums.ClassType[classType]} qiymət qaydası yoxdur.`);
    const pendingSameClass = pending.filter(s => Seats.classOf(ac, s) === classType).length;
    if (this.availableInClass(flight, classType) - pendingSameClass <= 0) fail(`${Enums.ClassType[classType]} sinfində satış limiti dolub.`);
  },

  createReservation(passengerId, flightId, seats) {
    const p = Store.get("passengers", passengerId);
    if (!p) fail("Sərnişin tapılmadı.");
    const f = Store.get("flights", flightId);
    if (!f) fail("Uçuş tapılmadı.");
    if (f.status !== 0) fail("Yalnız Scheduled statusunda olan uçuşlara rezervasiya etmək olar.");
    if (new Date(f.departureTime) <= new Date()) fail("Uçuş artıq yola düşüb.");
    if (!seats.length) fail("Ən azı bir oturacaq seçin.");
    const ac = Store.get("aircraft", f.aircraftId);
    const checked = [];
    seats.forEach(s => { this.checkSeat(f, s, Seats.classOf(ac, s), checked); checked.push(s); });

    const res = Store.add("reservations", {
      reservationCode: "RSV-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      passengerId: p.id, flightId: f.id, reservationDate: new Date().toISOString(),
      totalPrice: 0, cancelReason: null, status: 0,
    });
    seats.forEach(s => {
      const cls = Seats.classOf(ac, s);
      const pr = this.price(f.id, cls);
      Store.add("tickets", { reservationId: res.id, flightId: f.id, seatNumber: s, classType: cls, basePrice: pr.base, finalPrice: pr.final, status: 0 });
    });
    this.recalcReservation(res.id);
    return res;
  },

  confirmReservation(id) {
    const r = Store.get("reservations", id);
    if (r.status !== 0) fail("Yalnız Pending rezervasiya təsdiqlənə bilər.");
    Store.update("reservations", id, { status: 1 });
  },

  cancelReservation(id, reason) {
    const r = Store.get("reservations", id);
    if (r.status === 2 || r.status === 3) fail("Bu rezervasiya artıq bağlıdır.");
    if (!reason.trim()) fail("Ləğv səbəbi boş ola bilməz.");
    Store.update("reservations", id, { status: 2, cancelReason: reason.trim() });
    Store.all("tickets").filter(t => t.reservationId === id && t.status === 0).forEach(t => Store.update("tickets", t.id, { status: 2 }));
    this.recalcReservation(id);
  },

  addTicket(resId, seatNumber) {
    const r = Store.get("reservations", resId);
    if (r.status !== 1) fail("Bilet yalnız təsdiqlənmiş (Confirmed) rezervasiyaya əlavə edilə bilər.");
    const f = Store.get("flights", r.flightId);
    if (f.status !== 0 || new Date(f.departureTime) <= new Date()) fail("Bu uçuşa artıq bilet satılmır.");
    const ac = Store.get("aircraft", f.aircraftId);
    const cls = Seats.classOf(ac, seatNumber);
    this.checkSeat(f, seatNumber, cls);
    const pr = this.price(f.id, cls);
    Store.add("tickets", { reservationId: r.id, flightId: f.id, seatNumber, classType: cls, basePrice: pr.base, finalPrice: pr.final, status: 0 });
    this.recalcReservation(r.id);
  },

  cancelTicket(id) {
    const t = Store.get("tickets", id);
    if (t.status !== 0) fail("Yalnız aktiv bilet ləğv edilə bilər.");
    Store.update("tickets", id, { status: 2 });
    this.recalcReservation(t.reservationId);
  },
};

// =====================================================================
//  UI helpers
// =====================================================================

const $ = s => document.querySelector(s);
const view = $("#view");
const round2 = n => Math.round(n * 100) / 100;
const money = n => `₼${Number(n).toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = iso => new Date(iso).toLocaleDateString("az-AZ", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = iso => new Date(iso).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
const fmtDT = iso => `${fmtDate(iso)} ${fmtTime(iso)}`;
const toLocalInput = iso => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const duration = (a, b) => { const m = Math.round((new Date(b) - new Date(a)) / 60000); return `${Math.floor(m / 60)}s ${m % 60}d`; };

const badgeMap = {
  AircraftStatus: ["b-ok", "b-warn", "b-mute"],
  FlightStatus: ["b-info", "b-warn", "b-biz", "b-ok", "b-bad", "b-warn"],
  ReservationStatus: ["b-warn", "b-ok", "b-bad", "b-mute"],
  TicketStatus: ["b-ok", "b-mute", "b-bad"],
  ClassType: ["b-info", "b-biz"],
};
const badge = (en, v) => `<span class="badge ${badgeMap[en][v]}">${Enums[en][v]}</span>`;

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = "toast"), 2800);
}

function openModal(title, html, wide = false) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal .modal").classList.toggle("wide", wide);
  $("#modal").classList.add("open");
}
function closeModal() { $("#modal").classList.remove("open"); }
$("#modalClose").onclick = closeModal;
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

function guard(fn) {
  try { fn(); return true; }
  catch (e) {
    if (e instanceof BusinessError) {
      const box = document.querySelector("#modal.open .error-box");
      if (box) { box.textContent = e.message; box.classList.add("show"); } else toast(e.message, true);
      return false;
    }
    throw e;
  }
}

const options = (list, sel, label) => list.map(x => `<option value="${x.id}" ${Number(sel) === x.id ? "selected" : ""}>${esc(label(x))}</option>`).join("");
const enumOptions = (en, sel) => Enums[en].map((n, i) => `<option value="${i}" ${Number(sel) === i ? "selected" : ""}>${n}</option>`).join("");

// =====================================================================
//  Generic CRUD (Aircraft, Airport, Passenger, Price rules)
// =====================================================================

const entities = {
  aircraft: {
    title: "Təyyarə",
    fields: [
      { key: "model", label: "Model" },
      { key: "registrationNumber", label: "Qeydiyyat nömrəsi" },
      { key: "businessClassSeats", label: "Business oturacaq", type: "number" },
      { key: "economyClassSeats", label: "Economy oturacaq", type: "number" },
      { key: "status", label: "Status", type: "enum", enum: "AircraftStatus" },
    ],
    columns: [
      ["Model", a => `<b>${esc(a.model)}</b>`],
      ["Qeydiyyat", a => `<span class="mono">${esc(a.registrationNumber)}</span>`],
      ["Tutum", a => a.capacity],
      ["Business / Economy", a => `${a.businessClassSeats} / ${a.economyClassSeats}`],
      ["Uçuşlar", a => Store.all("flights").filter(f => f.aircraftId === a.id).length],
      ["Status", a => badge("AircraftStatus", a.status)],
    ],
    validate(d, id) {
      if (!d.model.trim() || !d.registrationNumber.trim()) fail("Model və qeydiyyat nömrəsi boş ola bilməz.");
      if (Store.all("aircraft").some(a => a.registrationNumber.toLowerCase() === d.registrationNumber.trim().toLowerCase() && a.id !== id)) fail("Bu qeydiyyat nömrəsi artıq mövcuddur.");
      if (d.businessClassSeats < 0 || d.economyClassSeats <= 0) fail("Oturacaq sayları müsbət olmalıdır.");
      d.capacity = d.businessClassSeats + d.economyClassSeats;
    },
    canDelete: id => !Store.all("flights").some(f => f.aircraftId === id) || fail("Uçuşu olan təyyarə silinə bilməz."),
  },
  airports: {
    title: "Hava limanı",
    fields: [
      { key: "name", label: "Ad", full: true },
      { key: "code", label: "IATA kodu" },
      { key: "city", label: "Şəhər" },
      { key: "country", label: "Ölkə" },
    ],
    columns: [
      ["Kod", a => `<span class="mono"><b>${esc(a.code)}</b></span>`],
      ["Ad", a => esc(a.name)],
      ["Şəhər", a => esc(a.city)],
      ["Ölkə", a => esc(a.country)],
      ["Uçuşlar", a => Store.all("flights").filter(f => f.departureAirportId === a.id || f.arrivalAirportId === a.id).length],
    ],
    validate(d, id) {
      if (!d.name.trim() || !d.city.trim() || !d.country.trim()) fail("Bütün sahələri doldurun.");
      d.code = d.code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(d.code)) fail("Kod 3 hərfdən ibarət olmalıdır.");
      if (Store.all("airports").some(a => a.code === d.code && a.id !== id)) fail("Bu kod artıq mövcuddur.");
    },
    canDelete: id => !Store.all("flights").some(f => f.departureAirportId === id || f.arrivalAirportId === id) || fail("Uçuşlarda istifadə olunan hava limanı silinə bilməz."),
  },
  passengers: {
    title: "Sərnişin",
    fields: [
      { key: "fullName", label: "Ad Soyad", full: true },
      { key: "passportNumber", label: "Pasport nömrəsi" },
      { key: "dateOfBirth", label: "Doğum tarixi", type: "date" },
      { key: "email", label: "E-poçt", type: "email" },
      { key: "phoneNumber", label: "Telefon" },
    ],
    columns: [
      ["Ad Soyad", p => `<b>${esc(p.fullName)}</b>`],
      ["Pasport", p => `<span class="mono">${esc(p.passportNumber)}</span>`],
      ["E-poçt", p => esc(p.email)],
      ["Telefon", p => esc(p.phoneNumber)],
      ["Rezervasiya", p => Store.all("reservations").filter(r => r.passengerId === p.id).length],
    ],
    extraActions: p => `<button class="btn ghost sm" onclick="showPassenger(${p.id})">Bax</button>`,
    validate(d, id) {
      if (!d.fullName.trim() || !d.passportNumber.trim()) fail("Ad və pasport nömrəsi boş ola bilməz.");
      if (!/^\S+@\S+\.\S+$/.test(d.email)) fail("E-poçt düzgün deyil.");
      if (!d.dateOfBirth || new Date(d.dateOfBirth) >= new Date()) fail("Doğum tarixi keçmişdə olmalıdır.");
      if (Store.all("passengers").some(p => p.passportNumber.toLowerCase() === d.passportNumber.trim().toLowerCase() && p.id !== id)) fail("Bu pasport nömrəsi artıq mövcuddur.");
    },
    canDelete: id => !Store.all("reservations").some(r => r.passengerId === id) || fail("Rezervasiyası olan sərnişin silinə bilməz."),
  },
  flightPriceRules: {
    title: "Qiymət qaydası",
    fields: [
      { key: "flightId", label: "Uçuş", type: "ref", table: "flights", text: f => `${f.flightNumber} · ${Store.get("airports", f.departureAirportId).code} → ${Store.get("airports", f.arrivalAirportId).code}` },
      { key: "classType", label: "Sinif", type: "enum", enum: "ClassType" },
      { key: "basePrice", label: "Baza qiyməti (₼)", type: "number" },
      { key: "discountPercentage", label: "Endirim (%)", type: "number" },
      { key: "availableSeatLimit", label: "Satış limiti (oturacaq)", type: "number" },
    ],
    columns: [
      ["Uçuş", r => { const f = Store.get("flights", r.flightId); return `<span class="mono"><b>${esc(f.flightNumber)}</b></span>`; }],
      ["Sinif", r => badge("ClassType", r.classType)],
      ["Baza", r => money(r.basePrice)],
      ["Endirim", r => r.discountPercentage ? `<span class="badge b-ok">-${r.discountPercentage}%</span>` : `<span class="muted">—</span>`],
      ["Yekun", r => `<b>${money(r.basePrice * (1 - r.discountPercentage / 100))}</b>`],
      ["Limit", r => r.availableSeatLimit],
    ],
    validate(d, id) {
      if (d.basePrice <= 0) fail("Baza qiyməti müsbət olmalıdır.");
      if (d.discountPercentage < 0 || d.discountPercentage > 100) fail("Endirim 0 ilə 100 arasında olmalıdır.");
      if (d.availableSeatLimit <= 0) fail("Satış limiti müsbət olmalıdır.");
      if (Store.all("flightPriceRules").some(r => r.flightId === d.flightId && r.classType === d.classType && r.id !== id)) fail("Bu uçuş və sinif üçün qayda artıq mövcuddur.");
    },
    canDelete: () => true,
  },
};

function renderCrud(table) {
  const e = entities[table];
  const q = (renderCrud.q ||= {})[table] || "";
  const rows = Store.all(table).filter(x => JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
  view.innerHTML = `
    <div class="toolbar">
      <input id="crudSearch" placeholder="Axtar..." value="${esc(q)}" style="width:260px">
      <div class="spacer"></div>
      <button class="btn" onclick="crudForm('${table}')">+ Yeni ${e.title.toLowerCase()}</button>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>#</th>${e.columns.map(c => `<th>${c[0]}</th>`).join("")}<th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => `<tr>
            <td class="muted mono">${r.id}</td>
            ${e.columns.map(c => `<td>${c[1](r)}</td>`).join("")}
            <td><div class="actions">
              ${e.extraActions ? e.extraActions(r) : ""}
              <button class="btn ghost sm" onclick="crudForm('${table}', ${r.id})">Redaktə</button>
              <button class="btn danger sm" onclick="crudDelete('${table}', ${r.id})">Sil</button>
            </div></td></tr>`).join("") : `<tr><td colspan="99" class="empty">Məlumat tapılmadı</td></tr>`}
        </tbody>
      </table>
    </div>`;
  const s = $("#crudSearch");
  s.oninput = () => { renderCrud.q[table] = s.value; renderCrud(table); const n = $("#crudSearch"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
}

function crudForm(table, id = null) {
  const e = entities[table];
  const row = id ? Store.get(table, id) : {};
  const input = f => {
    const v = row[f.key] ?? "";
    if (f.type === "enum") return `<select name="${f.key}">${enumOptions(f.enum, v)}</select>`;
    if (f.type === "ref") return `<select name="${f.key}">${options(Store.all(f.table), v, f.text)}</select>`;
    return `<input name="${f.key}" type="${f.type || "text"}" value="${esc(v)}" ${f.type === "number" ? 'step="any"' : ""}>`;
  };
  openModal(`${id ? "Redaktə" : "Yeni"}: ${e.title}`, `
    <form class="form" id="crudForm">
      ${e.fields.map(f => `<label class="${f.full ? "full" : ""}">${f.label}${input(f)}</label>`).join("")}
      <div class="error-box"></div>
      <div class="form-actions">
        <button type="button" class="btn ghost" onclick="closeModal()">İmtina</button>
        <button class="btn">Yadda saxla</button>
      </div>
    </form>`);
  $("#crudForm").onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = {};
    e.fields.forEach(f => {
      const v = fd.get(f.key);
      data[f.key] = ["number", "enum", "ref"].includes(f.type) ? Number(v) : v;
    });
    if (guard(() => {
      e.validate(data, id);
      id ? Store.update(table, id, data) : Store.add(table, data);
    })) { closeModal(); toast(`${e.title} yadda saxlanıldı`); render(); }
  };
}

function crudDelete(table, id) {
  const e = entities[table];
  if (guard(() => { e.canDelete(id); Store.remove(table, id); })) { toast(`${e.title} silindi`); render(); }
}

// =====================================================================
//  Pages
// =====================================================================

const pages = {
  dashboard: { title: "İdarə paneli", render: renderDashboard },
  flights: { title: "Uçuşlar", render: renderFlights },
  reservations: { title: "Rezervasiyalar", render: renderReservations },
  tickets: { title: "Biletlər", render: renderTickets },
  passengers: { title: "Sərnişinlər", render: () => renderCrud("passengers") },
  aircraft: { title: "Təyyarələr", render: () => renderCrud("aircraft") },
  airports: { title: "Hava limanları", render: () => renderCrud("airports") },
  pricerules: { title: "Qiymət qaydaları", render: () => renderCrud("flightPriceRules") },
  reports: { title: "Hesabatlar", render: renderReports },
};
let current = "dashboard";

function render() {
  Service.expirePending();
  $("#pageTitle").textContent = pages[current].title;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.page === current));
  pages[current].render();
}
function go(page) { current = page; render(); }

document.querySelectorAll("#nav a").forEach(a => (a.onclick = () => go(a.dataset.page)));
$("#resetData").onclick = () => { Store.reset(); toast("Demo məlumatları bərpa olundu"); render(); };

// ---------- Dashboard ----------
function renderDashboard() {
  const flights = Store.all("flights").map(f => Service.flightView(f));
  const upcoming = flights.filter(f => new Date(f.departureTime) > new Date() && f.status !== 4).sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
  const res = Store.all("reservations");
  const pending = res.filter(r => r.status === 0);
  view.innerHTML = `
    <div class="grid g4">
      <div class="card stat dark"><div class="label">Ümumi gəlir</div><div class="value">${money(Service.totalRevenue())}</div><div class="hint">təsdiqlənmiş biletlər</div></div>
      <div class="card stat"><div class="label">Qarşıdakı uçuşlar</div><div class="value">${upcoming.length}</div><div class="hint">${flights.length} uçuşdan</div></div>
      <div class="card stat"><div class="label">Rezervasiyalar</div><div class="value">${res.length}</div><div class="hint">${pending.length} gözləmədə</div></div>
      <div class="card stat"><div class="label">Sərnişinlər</div><div class="value">${Store.all("passengers").length}</div><div class="hint">${Service.confirmedTickets().length} satılmış bilet</div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card">
        <h3>Qarşıdakı uçuşlar</h3>
        <div class="flight-list">${upcoming.slice(0, 4).map(flightCard).join("") || `<div class="empty">Qarşıdakı uçuş yoxdur</div>`}</div>
      </div>
      <div class="card">
        <h3>Doluluq</h3>
        <div class="bar-list">
          ${upcoming.map(f => {
            const cap = Service.classLimit(f, 0) + Service.classLimit(f, 1);
            const sold = cap - Service.availableSeatCount(f.id);
            const pct = cap ? Math.round(sold / cap * 100) : 0;
            return `<div class="bar-item"><div class="top"><span class="mono"><b>${esc(f.flightNumber)}</b> ${f.from.code}→${f.to.code}</span><span class="muted">${sold}/${cap} · ${pct}%</span></div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
          }).join("") || `<div class="empty">—</div>`}
        </div>
        <h3 class="mt">Gözləmədə olan rezervasiyalar</h3>
        ${pending.map(r => { const p = Store.get("passengers", r.passengerId); const f = Store.get("flights", r.flightId);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0ede6">
            <div><span class="mono">${r.reservationCode}</span><div class="muted" style="font-size:12px">${esc(p.fullName)} · ${esc(f.flightNumber)}</div></div>
            <button class="btn success sm" onclick="confirmRes(${r.id})">Təsdiqlə</button></div>`; }).join("") || `<div class="muted">Yoxdur</div>`}
      </div>
    </div>`;
}

function flightCard(f) {
  const eco = Service.price(f.id, 0), biz = Service.price(f.id, 1);
  const cheapest = [eco, biz].filter(Boolean).sort((a, b) => a.final - b.final)[0];
  const bookable = f.status === 0 && new Date(f.departureTime) > new Date();
  return `<div class="flight">
    <div>
      <div class="route">
        <div class="ap"><div class="code">${f.from.code}</div><div class="time">${fmtTime(f.departureTime)}</div><div class="city">${esc(f.from.city)}</div></div>
        <div class="line"><span>✈ ${duration(f.departureTime, f.arrivalTime)}</span></div>
        <div class="ap" style="text-align:right"><div class="code">${f.to.code}</div><div class="time">${fmtTime(f.arrivalTime)}</div><div class="city">${esc(f.to.city)}</div></div>
      </div>
      <div class="flight-meta">
        <span class="mono"><b>${esc(f.flightNumber)}</b></span>
        <span class="muted">${fmtDate(f.departureTime)}</span>
        <span class="muted">${esc(f.aircraft.model)}</span>
        ${badge("FlightStatus", f.status)}
        <span class="muted">${Service.availableSeatCount(f.id)} boş yer</span>
      </div>
    </div>
    <div class="price-col">
      ${cheapest ? `<div class="from">başlayan qiymət</div>${cheapest.discount ? `<div class="old">${money(cheapest.base)}</div>` : ""}<div class="price">${money(cheapest.final)}</div>` : `<div class="muted">Qiymət yoxdur</div>`}
      <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">
        <button class="btn ghost sm" onclick="flightDetails(${f.id})">Ətraflı</button>
        ${bookable ? `<button class="btn sm" onclick="bookFlight(${f.id})">Bron et</button>` : ""}
      </div>
    </div>
  </div>`;
}

// ---------- Flights ----------
const flightFilter = { from: "", to: "", date: "", cls: "", min: "", max: "", status: "" };

function renderFlights() {
  const ap = Store.all("airports");
  const ff = flightFilter;
  view.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="toolbar" style="margin:0">
        <select id="fFrom"><option value="">Haradan</option>${options(ap, ff.from, a => `${a.code} · ${a.city}`)}</select>
        <select id="fTo"><option value="">Haraya</option>${options(ap, ff.to, a => `${a.code} · ${a.city}`)}</select>
        <input id="fDate" type="date" value="${ff.date}">
        <select id="fCls"><option value="">İstənilən sinif</option>${enumOptions("ClassType", ff.cls === "" ? -1 : ff.cls)}</select>
        <input id="fMin" type="number" placeholder="Min ₼" value="${ff.min}" style="width:90px">
        <input id="fMax" type="number" placeholder="Max ₼" value="${ff.max}" style="width:90px">
        <select id="fStatus"><option value="">Bütün statuslar</option>${enumOptions("FlightStatus", ff.status === "" ? -1 : ff.status)}</select>
        <button class="btn ghost" id="fClear">Təmizlə</button>
        <div class="spacer"></div>
        <button class="btn dark" onclick="flightForm()">+ Yeni uçuş</button>
      </div>
    </div>
    <div class="flight-list" id="flightList"></div>`;
  const bind = (id, key) => ($(id).onchange = $(id).oninput = () => { ff[key] = $(id).value; drawFlights(); });
  bind("#fFrom", "from"); bind("#fTo", "to"); bind("#fDate", "date"); bind("#fCls", "cls");
  bind("#fMin", "min"); bind("#fMax", "max"); bind("#fStatus", "status");
  $("#fClear").onclick = () => { Object.keys(ff).forEach(k => (ff[k] = "")); renderFlights(); };
  drawFlights();
}

function drawFlights() {
  const ff = flightFilter;
  const list = Store.all("flights").map(f => Service.flightView(f)).filter(f => {
    if (ff.from && f.departureAirportId !== Number(ff.from)) return false;
    if (ff.to && f.arrivalAirportId !== Number(ff.to)) return false;
    if (ff.date && toLocalInput(f.departureTime).slice(0, 10) !== ff.date) return false;
    if (ff.status !== "" && f.status !== Number(ff.status)) return false;
    const classes = ff.cls === "" ? [0, 1] : [Number(ff.cls)];
    const prices = classes.map(c => Service.price(f.id, c)).filter(Boolean).map(p => p.final);
    if (ff.cls !== "" && !prices.length) return false;
    if (ff.min && !prices.some(p => p >= Number(ff.min))) return false;
    if (ff.max && !prices.some(p => p <= Number(ff.max))) return false;
    return true;
  }).sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
  $("#flightList").innerHTML = list.map(flightCard).join("") || `<div class="card empty">Axtarışa uyğun uçuş tapılmadı</div>`;
}

function flightForm(id = null) {
  const f = id ? Store.get("flights", id) : { departureTime: new Date(Date.now() + 86400000).toISOString(), arrivalTime: new Date(Date.now() + 86400000 + 3 * 3600000).toISOString(), status: 0 };
  const ap = Store.all("airports");
  openModal(id ? "Uçuşu redaktə et" : "Yeni uçuş", `
    <form class="form" id="flightForm">
      <label>Uçuş nömrəsi<input name="flightNumber" value="${esc(f.flightNumber || "")}" placeholder="J2-123"></label>
      <label>Təyyarə<select name="aircraftId">${options(Store.all("aircraft"), f.aircraftId, a => `${a.model} · ${a.registrationNumber} (${Enums.AircraftStatus[a.status]})`)}</select></label>
      <label>Haradan<select name="departureAirportId">${options(ap, f.departureAirportId, a => `${a.code} · ${a.city}`)}</select></label>
      <label>Haraya<select name="arrivalAirportId">${options(ap, f.arrivalAirportId ?? ap[1]?.id, a => `${a.code} · ${a.city}`)}</select></label>
      <label>Yola düşmə<input type="datetime-local" name="departureTime" value="${toLocalInput(f.departureTime)}"></label>
      <label>Çatma<input type="datetime-local" name="arrivalTime" value="${toLocalInput(f.arrivalTime)}"></label>
      ${id ? `<label>Status<select name="status">${enumOptions("FlightStatus", f.status)}</select></label>` : ""}
      <div class="error-box"></div>
      <div class="form-actions">
        <button type="button" class="btn ghost" onclick="closeModal()">İmtina</button>
        <button class="btn">Yadda saxla</button>
      </div>
    </form>`);
  $("#flightForm").onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = {
      flightNumber: fd.get("flightNumber").trim(),
      aircraftId: Number(fd.get("aircraftId")),
      departureAirportId: Number(fd.get("departureAirportId")),
      arrivalAirportId: Number(fd.get("arrivalAirportId")),
      departureTime: new Date(fd.get("departureTime")).toISOString(),
      arrivalTime: new Date(fd.get("arrivalTime")).toISOString(),
      status: id ? Number(fd.get("status")) : 0,
    };
    if (guard(() => {
      Service.validateFlight(data, id);
      if (id) {
        const wasCancelled = data.status === 4 && f.status !== 4;
        Store.update("flights", id, { ...data, status: wasCancelled ? f.status : data.status });
        if (wasCancelled) Service.cancelFlight(id);
      } else Store.add("flights", data);
    })) { closeModal(); toast("Uçuş yadda saxlanıldı"); render(); }
  };
}

function flightDetails(id) {
  const f = Service.flightView(Store.get("flights", id));
  const ac = f.aircraft;
  const taken = Service.takenSeats(id);
  const tix = Service.activeTickets(id);
  openModal(`${f.flightNumber} · ${f.from.code} → ${f.to.code}`, `
    <div class="booking">
      <div>${seatMapHtml(ac, taken, [], false)}</div>
      <div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="card stat"><div class="label">Gəlir</div><div class="value" style="font-size:22px">${money(Service.flightRevenue(id))}</div></div>
          <div class="card stat"><div class="label">Satılmış</div><div class="value" style="font-size:22px">${Service.soldTicketCount(id)}</div></div>
          <div class="card stat"><div class="label">Boş (Economy)</div><div class="value" style="font-size:22px">${Service.availableInClass(f, 0)}</div></div>
          <div class="card stat"><div class="label">Boş (Business)</div><div class="value" style="font-size:22px">${Service.availableInClass(f, 1)}</div></div>
        </div>
        <p class="muted" style="margin:14px 0 6px">${fmtDT(f.departureTime)} → ${fmtDT(f.arrivalTime)}<br>${esc(ac.model)} · ${esc(ac.registrationNumber)} · ${badge("FlightStatus", f.status)}</p>
        <h3 style="font-family:'Space Grotesk';margin:14px 0 8px">Sərnişin siyahısı</h3>
        <div style="max-height:180px;overflow:auto">
        ${tix.map(t => { const r = Store.get("reservations", t.reservationId); const p = Store.get("passengers", r.passengerId);
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ede6"><span><span class="mono"><b>${t.seatNumber}</b></span> ${esc(p.fullName)}</span>${badge("ReservationStatus", r.status)}</div>`; }).join("") || `<div class="muted">Hələ bilet yoxdur</div>`}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          ${f.status !== 4 ? `<button class="btn danger" onclick="cancelFlightUi(${id})">Uçuşu ləğv et</button>` : ""}
          <button class="btn ghost" onclick="flightForm(${id})">Redaktə</button>
        </div>
      </div>
    </div>`, true);
}

function cancelFlightUi(id) {
  Service.cancelFlight(id);
  closeModal();
  toast("Uçuş, onun rezervasiyaları və biletləri ləğv edildi");
  render();
}

// ---------- Seat map & booking ----------
function seatMapHtml(ac, taken, selected, interactive, onlyClass = null) {
  const seats = Seats.layout(ac);
  const rows = {};
  seats.forEach(s => (rows[s.row] ||= []).push(s));
  let html = `<div class="seatmap">`;
  let lastCls = null;
  Object.entries(rows).forEach(([rn, rs]) => {
    const cls = rs[0].classType;
    if (cls !== lastCls) { html += `<div class="cabin-label">${cls === 1 ? "Business" : "Economy"}</div>`; lastCls = cls; }
    html += `<div class="seat-row"><span class="rn">${rn}</span>${rs.map(s => {
      const isTaken = taken.has(s.number);
      const dim = onlyClass !== null && s.classType !== onlyClass;
      const c = ["seat", s.classType === 1 ? "biz" : "", isTaken ? "taken" : "", selected.includes(s.number) ? "sel" : "", dim ? "dimmed" : ""].join(" ");
      return `<button class="${c}" data-seat="${s.number}" ${!interactive || isTaken || dim ? "disabled" : ""}>${s.number}</button>`;
    }).join("")}</div>`;
  });
  html += `</div><div class="legend"><span><i></i>Economy</span><span><i style="background:var(--biz-soft);border-color:#cdb8f3"></i>Business</span><span><i style="background:#d9d5cc"></i>Tutulub</span>${interactive ? `<span><i style="background:var(--accent)"></i>Seçilib</span>` : ""}</div>`;
  return html;
}

function bookFlight(id, presetPassenger = null) {
  const f = Service.flightView(Store.get("flights", id));
  const ac = f.aircraft;
  const taken = Service.takenSeats(id);
  let selected = [];

  const draw = () => {
    const lines = selected.map(s => { const cls = Seats.classOf(ac, s); const p = Service.price(id, cls); return { s, cls, p }; });
    const total = lines.reduce((sum, l) => sum + (l.p ? l.p.final : 0), 0);
    $("#seatHost").innerHTML = seatMapHtml(ac, taken, selected, true);
    $("#seatHost").querySelectorAll(".seat:not([disabled])").forEach(b => (b.onclick = () => {
      const s = b.dataset.seat;
      selected = selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s];
      draw();
    }));
    $("#summary").innerHTML = `
      ${lines.map(l => `<div class="row"><span>${l.s} · ${Enums.ClassType[l.cls]}</span><span>${l.p ? money(l.p.final) : "qiymət yoxdur"}</span></div>`).join("") || `<div class="row"><span>Oturacaq seçin</span><span></span></div>`}
      <div class="row total"><span>Cəmi</span><span>${money(total)}</span></div>`;
  };

  const eco = Service.price(id, 0), biz = Service.price(id, 1);
  openModal(`Bron: ${f.flightNumber} · ${f.from.code} → ${f.to.code}`, `
    <div class="booking">
      <div id="seatHost"></div>
      <div>
        <p class="muted" style="margin-top:0">${fmtDT(f.departureTime)} · ${esc(ac.model)}</p>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="card" style="padding:14px">${badge("ClassType", 0)}<div style="font-family:'Space Grotesk';font-size:20px;font-weight:700;margin-top:6px">${eco ? money(eco.final) : "—"}</div><div class="muted" style="font-size:12px">${Service.availableInClass(f, 0)} yer qalıb${eco?.discount ? ` · -${eco.discount}%` : ""}</div></div>
          <div class="card" style="padding:14px">${badge("ClassType", 1)}<div style="font-family:'Space Grotesk';font-size:20px;font-weight:700;margin-top:6px">${biz ? money(biz.final) : "—"}</div><div class="muted" style="font-size:12px">${Service.availableInClass(f, 1)} yer qalıb${biz?.discount ? ` · -${biz.discount}%` : ""}</div></div>
        </div>
        <form class="form" id="bookForm" style="grid-template-columns:1fr;margin-top:14px">
          <label>Sərnişin<select name="passengerId">${options(Store.all("passengers"), presetPassenger, p => `${p.fullName} · ${p.passportNumber}`)}</select></label>
          <div class="error-box"></div>
        </form>
        <div class="summary-box" id="summary"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
          <button class="btn ghost" onclick="closeModal()">İmtina</button>
          <button class="btn" id="bookBtn">Rezervasiya yarat</button>
        </div>
        <p class="muted" style="font-size:12px">Rezervasiya <b>Pending</b> statusu ilə yaranır və 24 saat ərzində təsdiqlənməlidir.</p>
      </div>
    </div>`, true);
  draw();
  $("#bookBtn").onclick = () => {
    const pid = Number(new FormData($("#bookForm")).get("passengerId"));
    let res;
    if (guard(() => { res = Service.createReservation(pid, id, selected); })) {
      closeModal(); toast(`Rezervasiya yaradıldı: ${res.reservationCode}`); render();
    }
  };
}

// ---------- Reservations ----------
let resFilter = "";
function renderReservations() {
  const rows = Store.all("reservations").filter(r => resFilter === "" || r.status === Number(resFilter))
    .sort((a, b) => new Date(b.reservationDate) - new Date(a.reservationDate));
  view.innerHTML = `
    <div class="toolbar">
      <div class="tabs" id="resTabs">
        <button data-v="" class="${resFilter === "" ? "on" : ""}">Hamısı</button>
        ${Enums.ReservationStatus.map((n, i) => `<button data-v="${i}" class="${resFilter === String(i) ? "on" : ""}">${n}</button>`).join("")}
      </div>
      <div class="spacer"></div>
      <button class="btn" onclick="go('flights')">+ Yeni rezervasiya</button>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Kod</th><th>Sərnişin</th><th>Uçuş</th><th>Tarix</th><th>Biletlər</th><th>Cəmi</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(r => {
          const p = Store.get("passengers", r.passengerId); const f = Service.flightView(Store.get("flights", r.flightId));
          const tix = Store.all("tickets").filter(t => t.reservationId === r.id && t.status !== 2);
          return `<tr>
            <td class="mono"><b>${r.reservationCode}</b></td>
            <td>${esc(p.fullName)}</td>
            <td><span class="mono">${esc(f.flightNumber)}</span> <span class="muted">${f.from.code}→${f.to.code}</span></td>
            <td class="muted">${fmtDT(r.reservationDate)}</td>
            <td class="mono">${tix.map(t => t.seatNumber).join(", ") || "—"}</td>
            <td><b>${money(r.totalPrice)}</b></td>
            <td>${badge("ReservationStatus", r.status)}${r.cancelReason ? `<div class="muted" style="font-size:11px;margin-top:3px">${esc(r.cancelReason)}</div>` : ""}</td>
            <td><div class="actions">
              ${r.status === 0 ? `<button class="btn success sm" onclick="confirmRes(${r.id})">Təsdiqlə</button>` : ""}
              ${r.status === 1 ? `<button class="btn ghost sm" onclick="addTicketUi(${r.id})">+ Bilet</button>` : ""}
              ${r.status <= 1 ? `<button class="btn danger sm" onclick="cancelResUi(${r.id})">Ləğv et</button>` : ""}
            </div></td></tr>`;
        }).join("") || `<tr><td colspan="8" class="empty">Rezervasiya yoxdur</td></tr>`}</tbody>
      </table>
    </div>`;
  document.querySelectorAll("#resTabs button").forEach(b => (b.onclick = () => { resFilter = b.dataset.v; renderReservations(); }));
}

function confirmRes(id) {
  if (guard(() => Service.confirmReservation(id))) { toast("Rezervasiya təsdiqləndi"); render(); }
}

function cancelResUi(id) {
  const r = Store.get("reservations", id);
  openModal(`Ləğv et: ${r.reservationCode}`, `
    <form class="form" id="cancelForm" style="grid-template-columns:1fr">
      <label>Ləğv səbəbi<textarea name="reason" rows="3" placeholder="Məs: Sərnişinin istəyi ilə"></textarea></label>
      <div class="error-box"></div>
      <div class="form-actions"><button type="button" class="btn ghost" onclick="closeModal()">Geri</button><button class="btn danger">Ləğv et</button></div>
    </form>`);
  $("#cancelForm").onsubmit = ev => {
    ev.preventDefault();
    if (guard(() => Service.cancelReservation(id, new FormData(ev.target).get("reason")))) { closeModal(); toast("Rezervasiya və biletləri ləğv edildi"); render(); }
  };
}

function addTicketUi(resId) {
  const r = Store.get("reservations", resId);
  const f = Store.get("flights", r.flightId);
  const ac = Store.get("aircraft", f.aircraftId);
  let sel = null;
  openModal(`Bilet əlavə et: ${r.reservationCode}`, `
    <div class="booking"><div id="seatHost"></div>
    <div><div class="summary-box" id="summary"></div>
    <div class="form" style="grid-template-columns:1fr"><div class="error-box"></div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn ghost" onclick="closeModal()">İmtina</button><button class="btn" id="addBtn">Əlavə et</button></div></div></div>`, true);
  const draw = () => {
    $("#seatHost").innerHTML = seatMapHtml(ac, Service.takenSeats(f.id), sel ? [sel] : [], true);
    $("#seatHost").querySelectorAll(".seat:not([disabled])").forEach(b => (b.onclick = () => { sel = b.dataset.seat; draw(); }));
    const p = sel ? Service.price(f.id, Seats.classOf(ac, sel)) : null;
    $("#summary").innerHTML = sel
      ? `<div class="row"><span>${sel} · ${Enums.ClassType[Seats.classOf(ac, sel)]}</span><span></span></div><div class="row total"><span>Qiymət</span><span>${p ? money(p.final) : "—"}</span></div>`
      : `<div class="row"><span>Oturacaq seçin</span><span></span></div>`;
  };
  draw();
  $("#addBtn").onclick = () => {
    if (!sel) return toast("Oturacaq seçin", true);
    if (guard(() => Service.addTicket(resId, sel))) { closeModal(); toast(`${sel} oturacağı əlavə olundu`); render(); }
  };
}

// ---------- Tickets ----------
function renderTickets() {
  const rows = [...Store.all("tickets")].sort((a, b) => b.id - a.id);
  view.innerHTML = `
    <div class="card table-wrap">
      <table>
        <thead><tr><th>#</th><th>Rezervasiya</th><th>Sərnişin</th><th>Uçuş</th><th>Oturacaq</th><th>Sinif</th><th>Baza</th><th>Yekun</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(t => {
          const r = Store.get("reservations", t.reservationId); const p = Store.get("passengers", r.passengerId); const f = Store.get("flights", t.flightId);
          return `<tr>
            <td class="muted mono">${t.id}</td>
            <td class="mono">${r.reservationCode}</td>
            <td>${esc(p.fullName)}</td>
            <td class="mono">${esc(f.flightNumber)}</td>
            <td class="mono"><b>${t.seatNumber}</b></td>
            <td>${badge("ClassType", t.classType)}</td>
            <td class="muted">${money(t.basePrice)}</td>
            <td><b>${money(t.finalPrice)}</b></td>
            <td>${badge("TicketStatus", t.status)}</td>
            <td><div class="actions">${t.status === 0 ? `<button class="btn danger sm" onclick="cancelTicketUi(${t.id})">Ləğv et</button>` : ""}</div></td></tr>`;
        }).join("") || `<tr><td colspan="10" class="empty">Bilet yoxdur</td></tr>`}</tbody>
      </table>
    </div>`;
}

function cancelTicketUi(id) {
  if (guard(() => Service.cancelTicket(id))) { toast("Bilet ləğv edildi, oturacaq satışa açıldı"); render(); }
}

// ---------- Passenger details ----------
function showPassenger(id) {
  const p = Store.get("passengers", id);
  const res = Store.all("reservations").filter(r => r.passengerId === id);
  openModal(p.fullName, `
    <p class="muted" style="margin-top:0">${esc(p.passportNumber)} · ${esc(p.email)} · ${esc(p.phoneNumber)} · ${fmtDate(p.dateOfBirth)}</p>
    ${res.map(r => { const f = Service.flightView(Store.get("flights", r.flightId)); const tix = Store.all("tickets").filter(t => t.reservationId === r.id);
      return `<div class="card" style="margin-bottom:10px;padding:14px">
        <div style="display:flex;justify-content:space-between"><span class="mono"><b>${r.reservationCode}</b></span>${badge("ReservationStatus", r.status)}</div>
        <div class="muted" style="margin:6px 0">${esc(f.flightNumber)} · ${f.from.code} → ${f.to.code} · ${fmtDT(f.departureTime)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${tix.map(t => `<span class="badge ${t.status === 2 ? "b-mute" : t.classType ? "b-biz" : "b-info"}">${t.seatNumber} · ${money(t.finalPrice)}</span>`).join("")}</div>
      </div>`; }).join("") || `<div class="empty">Rezervasiya yoxdur</div>`}
    <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn" onclick="closeModal();go('flights')">Yeni bron</button></div>`);
}

// ---------- Reports ----------
function renderReports() {
  const flights = Store.all("flights").map(f => Service.flightView(f));
  const revs = flights.map(f => ({ f, rev: Service.flightRevenue(f.id), sold: Service.soldTicketCount(f.id), avail: Service.availableSeatCount(f.id) }));
  const max = Math.max(1, ...revs.map(r => r.rev));
  const tix = Service.confirmedTickets();
  const ecoRev = tix.filter(t => t.classType === 0).reduce((s, t) => s + t.finalPrice, 0);
  const bizRev = tix.filter(t => t.classType === 1).reduce((s, t) => s + t.finalPrice, 0);
  const totalRev = Service.totalRevenue();
  view.innerHTML = `
    <div class="grid g4">
      <div class="card stat dark"><div class="label">Ümumi gəlir</div><div class="value">${money(totalRev)}</div></div>
      <div class="card stat"><div class="label">Satılmış bilet</div><div class="value">${tix.length}</div></div>
      <div class="card stat"><div class="label">Economy gəliri</div><div class="value">${money(ecoRev)}</div></div>
      <div class="card stat"><div class="label">Business gəliri</div><div class="value">${money(bizRev)}</div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card">
        <h3>Uçuşlar üzrə gəlir</h3>
        <div class="bar-list">${revs.sort((a, b) => b.rev - a.rev).map(r => `
          <div class="bar-item"><div class="top"><span><span class="mono"><b>${esc(r.f.flightNumber)}</b></span> <span class="muted">${r.f.from.code}→${r.f.to.code}</span></span><b>${money(r.rev)}</b></div>
          <div class="bar"><div style="width:${r.rev / max * 100}%"></div></div></div>`).join("")}</div>
      </div>
      <div class="card">
        <h3>Sinif bölgüsü</h3>
        <div class="bar-list">
          <div class="bar-item"><div class="top"><span>Economy</span><span>${totalRev ? Math.round(ecoRev / totalRev * 100) : 0}%</span></div><div class="bar"><div style="width:${totalRev ? ecoRev / totalRev * 100 : 0}%"></div></div></div>
          <div class="bar-item"><div class="top"><span>Business</span><span>${totalRev ? Math.round(bizRev / totalRev * 100) : 0}%</span></div><div class="bar biz"><div style="width:${totalRev ? bizRev / totalRev * 100 : 0}%"></div></div></div>
        </div>
        <p class="muted" style="font-size:12px;margin-top:16px">Hesabatlar yalnız təsdiqlənmiş (Confirmed) rezervasiyaların ləğv edilməmiş biletlərini nəzərə alır.</p>
      </div>
    </div>
    <div class="card table-wrap mt">
      <table>
        <thead><tr><th>Uçuş</th><th>Marşrut</th><th>Tarix</th><th>Status</th><th>Satılmış</th><th>Boş yer</th><th>Gəlir</th></tr></thead>
        <tbody>${revs.map(r => `<tr><td class="mono"><b>${esc(r.f.flightNumber)}</b></td><td>${r.f.from.code} → ${r.f.to.code}</td><td class="muted">${fmtDT(r.f.departureTime)}</td><td>${badge("FlightStatus", r.f.status)}</td><td>${r.sold}</td><td>${r.avail}</td><td><b>${money(r.rev)}</b></td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

// ---------- Boot ----------
function tick() { $("#clock").textContent = new Date().toLocaleString("az-AZ", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); }
tick(); setInterval(tick, 30000);
render();
