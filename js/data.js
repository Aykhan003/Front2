// =====================================================================
//  Data layer — C# Entity modellərinin JS ekvivalenti.
//  Məlumatlar brauzerin localStorage-ində saxlanılır (backend API yoxdur).
//  Gələcəkdə ASP.NET Web API əlavə olunsa, yalnız bu fayl fetch() ilə əvəz olunmalıdır.
// =====================================================================

const Enums = {
  AircraftStatus: ["Active", "Maintenance", "Retired"],
  ClassType: ["Economy", "Business"],
  FlightStatus: ["Scheduled", "Boarding", "Departed", "Completed", "Cancelled", "Delayed"],
  ReservationStatus: ["Pending", "Confirmed", "Cancelled", "Expired"],
  TicketStatus: ["Active", "Used", "Cancelled"],
};

const STORAGE_KEY = "frs-data-v1";

function hoursFromNow(h) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setTime(d.getTime() + h * 3600 * 1000);
  return d.toISOString();
}

function seed() {
  const now = new Date().toISOString();
  const audit = { createdDate: now, updatedDate: null };

  const airports = [
    { id: 1, name: "Heydar Aliyev International", code: "GYD", city: "Bakı", country: "Azərbaycan" },
    { id: 2, name: "Istanbul Airport", code: "IST", city: "İstanbul", country: "Türkiyə" },
    { id: 3, name: "Dubai International", code: "DXB", city: "Dubai", country: "BƏƏ" },
    { id: 4, name: "Heathrow", code: "LHR", city: "London", country: "Böyük Britaniya" },
    { id: 5, name: "Ganja International", code: "GNJ", city: "Gəncə", country: "Azərbaycan" },
  ].map(a => ({ ...a, ...audit }));

  const aircraft = [
    { id: 1, model: "Airbus A320neo", registrationNumber: "4K-AZ01", capacity: 36, businessClassSeats: 6, economyClassSeats: 30, status: 0 },
    { id: 2, model: "Boeing 787-8", registrationNumber: "4K-AZ02", capacity: 45, businessClassSeats: 9, economyClassSeats: 36, status: 0 },
    { id: 3, model: "Embraer 190", registrationNumber: "4K-AZ03", capacity: 24, businessClassSeats: 3, economyClassSeats: 21, status: 1 },
  ].map(a => ({ ...a, ...audit }));

  const flights = [
    { id: 1, flightNumber: "J2-101", aircraftId: 1, departureAirportId: 1, arrivalAirportId: 2, departureTime: hoursFromNow(20), arrivalTime: hoursFromNow(23), status: 0 },
    { id: 2, flightNumber: "J2-205", aircraftId: 2, departureAirportId: 1, arrivalAirportId: 3, departureTime: hoursFromNow(44), arrivalTime: hoursFromNow(47), status: 0 },
    { id: 3, flightNumber: "J2-017", aircraftId: 2, departureAirportId: 1, arrivalAirportId: 4, departureTime: hoursFromNow(72), arrivalTime: hoursFromNow(78), status: 0 },
    { id: 4, flightNumber: "J2-102", aircraftId: 1, departureAirportId: 2, arrivalAirportId: 1, departureTime: hoursFromNow(30), arrivalTime: hoursFromNow(33), status: 5 },
    { id: 5, flightNumber: "J2-033", aircraftId: 1, departureAirportId: 1, arrivalAirportId: 5, departureTime: hoursFromNow(-30), arrivalTime: hoursFromNow(-29), status: 3 },
  ].map(f => ({ ...f, ...audit }));

  const flightPriceRules = [
    { id: 1, flightId: 1, classType: 0, basePrice: 180, availableSeatLimit: 30, discountPercentage: 10 },
    { id: 2, flightId: 1, classType: 1, basePrice: 520, availableSeatLimit: 6, discountPercentage: 0 },
    { id: 3, flightId: 2, classType: 0, basePrice: 260, availableSeatLimit: 36, discountPercentage: 15 },
    { id: 4, flightId: 2, classType: 1, basePrice: 890, availableSeatLimit: 9, discountPercentage: 5 },
    { id: 5, flightId: 3, classType: 0, basePrice: 410, availableSeatLimit: 30, discountPercentage: 0 },
    { id: 6, flightId: 3, classType: 1, basePrice: 1450, availableSeatLimit: 9, discountPercentage: 0 },
    { id: 7, flightId: 4, classType: 0, basePrice: 170, availableSeatLimit: 30, discountPercentage: 0 },
    { id: 8, flightId: 5, classType: 0, basePrice: 60, availableSeatLimit: 30, discountPercentage: 0 },
  ].map(r => ({ ...r, ...audit }));

  const passengers = [
    { id: 1, fullName: "Aykhan Bayramov", passportNumber: "C01234567", email: "aykhan@example.com", phoneNumber: "+994501112233", dateOfBirth: "2001-05-14" },
    { id: 2, fullName: "Leyla Məmmədova", passportNumber: "C07654321", email: "leyla@example.com", phoneNumber: "+994552223344", dateOfBirth: "1995-11-02" },
    { id: 3, fullName: "Murad Əliyev", passportNumber: "C05551234", email: "murad@example.com", phoneNumber: "+994703334455", dateOfBirth: "1988-03-27" },
  ].map(p => ({ ...p, ...audit }));

  const reservations = [
    { id: 1, reservationCode: "RSV-7KD2QX", passengerId: 1, flightId: 1, reservationDate: hoursFromNow(-5), totalPrice: 0, cancelReason: null, status: 1 },
    { id: 2, reservationCode: "RSV-M93LPA", passengerId: 2, flightId: 2, reservationDate: hoursFromNow(-2), totalPrice: 0, cancelReason: null, status: 0 },
    { id: 3, reservationCode: "RSV-Q1Z8TT", passengerId: 3, flightId: 5, reservationDate: hoursFromNow(-80), totalPrice: 0, cancelReason: null, status: 1 },
  ].map(r => ({ ...r, ...audit }));

  const tickets = [
    { id: 1, reservationId: 1, flightId: 1, seatNumber: "1A", classType: 1, basePrice: 520, finalPrice: 520, status: 0 },
    { id: 2, reservationId: 1, flightId: 1, seatNumber: "4B", classType: 0, basePrice: 180, finalPrice: 162, status: 0 },
    { id: 3, reservationId: 2, flightId: 2, seatNumber: "6C", classType: 0, basePrice: 260, finalPrice: 221, status: 0 },
    { id: 4, reservationId: 3, flightId: 5, seatNumber: "5A", classType: 0, basePrice: 60, finalPrice: 60, status: 1 },
  ].map(t => ({ ...t, ...audit }));

  reservations.forEach(r => {
    r.totalPrice = tickets.filter(t => t.reservationId === r.id && t.status !== 2).reduce((s, t) => s + t.finalPrice, 0);
  });

  return { airports, aircraft, flights, flightPriceRules, passengers, reservations, tickets };
}

const Store = {
  db: null,
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.db = raw ? JSON.parse(raw) : seed();
    } catch {
      this.db = seed();
    }
    this.save();
  },
  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db)); } catch { /* ignore */ }
  },
  reset() {
    this.db = seed();
    this.save();
  },
  all(table) { return this.db[table]; },
  get(table, id) { return this.db[table].find(x => x.id === Number(id)); },
  nextId(table) { return this.db[table].reduce((m, x) => Math.max(m, x.id), 0) + 1; },
  add(table, obj) {
    const row = { ...obj, id: this.nextId(table), createdDate: new Date().toISOString(), updatedDate: null };
    this.db[table].push(row);
    this.save();
    return row;
  },
  update(table, id, patch) {
    const row = this.get(table, id);
    Object.assign(row, patch, { updatedDate: new Date().toISOString() });
    this.save();
    return row;
  },
  remove(table, id) {
    this.db[table] = this.db[table].filter(x => x.id !== Number(id));
    this.save();
  },
};

Store.load();
