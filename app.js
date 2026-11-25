// Сайт Party Rooms: студии, посуточная бронь, анонимная статистика посещений
const $ = (id) => document.getElementById(id);

// При открытии и перезагрузке — всегда с самого верха. Браузер сам «возвращает» прокрутку туда, где был человек,
// и из-за плавно появляющихся блоков промахивается в середину. Ссылку на раздел (#halls и т.п.) уважаем
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAYS_SHOWN = 60;   // в какие ближайшие дни ищем свободную дату

let data = null;        // студии, правила брони и занятые даты с сервера
let clockDelta = 0;     // разница между часами телефона и временем Иркутска, в минутах
let sel = null;         // что выбрано в форме брони
let overflowTracked = false;

// ---------- Даты (минуты по местному времени, как на сервере) ----------
const nowMin = () => Math.floor(Date.now() / 60000) + clockDelta;
const dayStart = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 60000; };
const keyOf = (min) => new Date(min * 60000).toISOString().slice(0, 10);
const addDays = (key, n) => keyOf(dayStart(key) + n * 1440);
const weekday = (key) => new Date(dayStart(key) * 60000).getUTCDay();
const dateText = (key) => { const d = new Date(dayStart(key) * 60000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const pad = (h) => String(h).padStart(2, '0') + ':00';
const rub = (n) => n.toLocaleString('ru-RU') + ' ₽';
const hallById = (id) => data.halls.find((h) => h.id === id);
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const nightsText = (n) => `${n} ${plural(n, 'сутки', 'суток', 'суток')}`;
const guestsText = (n) => `${n} ${plural(n, 'гость', 'гостя', 'гостей')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Ночь с даты key: заезд в этот день, выезд на следующий
const nightStart = (key) => dayStart(key) + data.checkinHour * 60;
const nightEnd = (key) => dayStart(addDays(key, 1)) + data.checkoutHour * 60;
const isFree = (hallId, start, end) => !data.busy.some((b) => b.hallId === hallId && start < b.end && end > b.start);
const nightFree = (hallId, key) => isFree(hallId, nightStart(key), nightEnd(key));
// Можно ли заехать в эту дату: дата не прошла и ночь свободна
const canCheckIn = (hallId, key) => key >= keyOf(nowMin()) && nightFree(hallId, key);
// Цена ночи: особая цена на дату, иначе ночь с пятницы — тариф пятницы, с субботы — субботы, остальные — будни
function nightPrice(hall, key) {
  const sp = data.prices[key];
  if (typeof sp === 'number') return sp;
  if (sp && sp[hall.id]) return Number(sp[hall.id]);
  const wd = weekday(key);
  return wd === 5 ? hall.priceFriday : wd === 6 ? hall.priceSaturday : hall.priceWeekday;
}
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 1440);
function stayTotal(hall, date, nights, guests) {
  let sum = 0;
  for (let i = 0; i < nights; i++) sum += nightPrice(hall, addDays(date, i));
  return sum + Math.max(0, guests - hall.baseGuests) * hall.extraGuestPrice * nights;
}
// Ближайшие свободные даты заезда для студии
function freeDates(hallId, count) {
  const list = [];
  for (let i = 0, key = keyOf(nowMin()); i < DAYS_SHOWN && list.length < count; i++, key = addDays(key, 1)) if (canCheckIn(hallId, key)) list.push(key);
  return list;
}
function hallState(h) {
  const today = keyOf(nowMin());
  if (nightFree(h.id, today)) return { cls: 'free', text: 'Свободна сегодня' };
  const next = freeDates(h.id, 1)[0];
  return { cls: 'busy', text: next ? `Сегодня занята, свободна с ${dateText(next)}` : 'Занята на ближайшие два месяца' };
}

// ---------- Статистика: анонимный номер браузера, без имени и телефона ----------
const vid = (() => {
  try {
    let v = localStorage.getItem('vid');
    if (!v) { v = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('vid', v); }
    return v;
  } catch { return 'anon' + Math.random().toString(36).slice(2, 10); }
})();
// ---------- Куда стучится сайт ----------
// Свой сервер (server.js на Amvera) — адреса /api/…; бесплатная версия (GitHub Pages) — «мозг» на Google Apps Script,
// его адрес задаёт config.js (window.API_URL). Ответ приводим к одному виду: { status, data }
const API_URL = window.API_URL || '';
async function apiGet() {
  const r = await fetch(API_URL ? API_URL + '?action=halls' : '/api/halls');
  if (!r.ok) throw new Error();
  return r.json();
}
async function apiBook(body) {
  if (!API_URL) {
    const r = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }
  // Без заголовка Content-Type браузер шлёт «простой» запрос — Google принимает его без лишних проверок
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'book', ...body }) });
  const data = await r.json().catch(() => ({}));
  return { status: data.ok ? 201 : (data.status || 400), data };
}

function track(type, extra = {}) {
  if (API_URL) return; // в бесплатной версии метрики нет
  fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, vid, ...extra }), keepalive: true }).catch(() => {});
}

// ---------- Загрузка ----------
let photoIndex = {};     // какое фото показано у каждой студии
async function load() {
  try {
    data = await apiGet();
    clockDelta = data.now - Math.floor(Date.now() / 60000);
    $('load-error').hidden = true;
    // Первый раз рисуем студии целиком (и подключаем к плавному появлению), дальше раз в минуту — только статус
    if (!document.querySelector('.bath')) { renderCards(); renderBaths(); reveal(); } else updateStates();
    for (const a of document.querySelectorAll('.phone-link')) a.href = 'tel:+' + data.phone.replace(/\D/g, '');
    if (sel && !$('sheet').hidden && $('done').hidden) renderForm();
  } catch {
    if (!data) { $('load-error').hidden = false; $('bath-list').innerHTML = ''; }
  }
}

// ---------- Три студии карточками: фото, площадь, сколько гостей, цена «от» ----------
function renderCards() {
  $('studio-cards').innerHTML = data.halls.map((h) => `<article class="studio-card">
      <img src="${h.photos[0]}" alt="Студия ${esc(h.name)}" width="1600" height="1066" loading="lazy">
      <div class="studio-card-text">
        <h3>${esc(h.name)}</h3>
        <p>${h.area} м² · комфортно до ${h.capacity} гостей</p>
        <p class="studio-price">от ${rub(h.priceWeekday)} за сутки</p>
        <div class="actions">
          <button class="btn btn-primary btn-sm" type="button" data-book="${h.id}">Выбрать дату</button>
          <a class="link-action" href="#bath-${h.id}">Подробнее</a>
        </div>
      </div>
    </article>`).join('');
}

// ---------- Студии подробно: фото, описание, удобства пунктами, цены ----------
function photoHtml(h) {
  const i = photoIndex[h.id] || 0;
  return `<img src="${h.photos[i]}" alt="Студия ${esc(h.name)}, фото ${i + 1}" width="1800" height="1200" loading="lazy">
    ${h.photos.length > 1 ? `<div class="dots">${h.photos.map((_, k) => `<button type="button" data-photo="${h.id}:${k}" aria-label="Фото ${k + 1}" aria-current="${k === i}"></button>`).join('')}</div>` : ''}`;
}

// Удобства: сначала 5 главных, остальные — по кнопке «Показать все удобства»
const TOP_FEATURES = 5;
function renderBaths() {
  $('bath-list').innerHTML = data.halls.map((h, n) => {
    const st = hallState(h);
    return `<article class="bath${n % 2 ? ' flip' : ''}" aria-labelledby="bath-${h.id}">
      <div class="bath-media" data-media="${h.id}">${photoHtml(h)}</div>
      <div class="bath-text">
        <h3 id="bath-${h.id}">${esc(h.name)}</h3>
        <p class="bath-about">${esc(h.about)}</p>
        <ul class="bath-features" id="feat-${h.id}">${h.features.map((f, i) => `<li${i >= TOP_FEATURES ? ' class="more"' : ''}>${esc(f)}</li>`).join('')}</ul>
        ${h.features.length > TOP_FEATURES ? `<button type="button" class="feat-more" data-feat="${h.id}" aria-expanded="false" aria-controls="feat-${h.id}">Показать все удобства <span>+${h.features.length - TOP_FEATURES}</span></button>` : ''}
        <dl class="bath-prices">
          <div><dt>Вс–чт</dt><dd>${rub(h.priceWeekday)}</dd></div>
          <div><dt>Пятница</dt><dd>${rub(h.priceFriday)}</dd></div>
          <div><dt>Суббота</dt><dd>${rub(h.priceSaturday)}</dd></div>
        </dl>
        <p class="bath-note">Цена за сутки. В базовый тариф аренды входит до ${h.baseGuests} человек, каждый следующий — ${rub(h.extraGuestPrice)}. Комфортно до ${h.capacity} гостей.</p>
        <div class="bath-actions">
          <button class="btn btn-primary" type="button" data-book="${h.id}">Выбрать дату</button>
          <span class="state ${st.cls}" data-state="${h.id}">${st.text}</span>
        </div>
      </div>
    </article>`;
  }).join('');
}

function updateStates() {
  for (const h of data.halls) {
    const el = document.querySelector(`[data-state="${h.id}"]`);
    if (!el) continue;
    const st = hallState(h);
    el.className = `state ${st.cls}`;
    el.textContent = st.text;
  }
}

$('bath-list').addEventListener('click', (e) => {
  const more = e.target.closest('[data-feat]');
  if (more) {
    const list = $('feat-' + more.dataset.feat);
    const open = list.classList.toggle('open');
    more.setAttribute('aria-expanded', open);
    const rest = list.querySelectorAll('.more').length;
    more.innerHTML = open ? 'Свернуть' : `Показать все удобства <span>+${rest}</span>`;
    return;
  }
  const d = e.target.closest('[data-photo]');
  if (!d) return;
  const [id, k] = d.dataset.photo.split(':').map(Number);
  photoIndex[id] = k;
  document.querySelector(`[data-media="${id}"]`).innerHTML = photoHtml(hallById(id));
  track('hall', { hallId: id });
});

// Шапка над фото первого экрана прозрачная, после прокрутки — плотная
const header = $('top');
const onScroll = () => header.classList.toggle('solid', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- Панель брони ----------
let lastFocus = null;
let calMonths = 1;       // сколько месяцев календаря показано (кнопка «Показать следующий месяц» добавляет)
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-book]');
  if (open) { e.preventDefault(); openSheet(Number(open.dataset.book), open.dataset.date); return; }
  if (e.target.closest('[data-close]')) closeSheet();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

function openSheet(hallId, date) {
  if (!data) return;
  lastFocus = document.activeElement;
  const id = hallId || data.halls[0].id;
  sel = { hallId: id, date: date && canCheckIn(id, date) ? date : null, nights: 1, guests: sel?.guests || 8 };
  calMonths = 1;   // сначала только текущий месяц, следующий — по кнопке
  overflowTracked = false;
  $('form').hidden = false;
  $('done').hidden = true;
  $('error').textContent = '';
  renderForm();
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelector('.sheet-body').scrollTop = 0;
  $('hall-pick').querySelector('[aria-checked="true"]')?.focus();
  track('open');
}
function closeSheet() {
  $('sheet').hidden = true;
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

// Сколько суток подряд свободно, начиная с даты заезда
function maxNightsFrom(hallId, key) {
  let n = 0;
  while (n < data.maxNights && nightFree(hallId, addDays(key, n))) n++;
  return n;
}

// Календарь: месяц за месяцем, 7 дней в ряд (пн–вс), под числом — цена ночи.
// Выбранные сутки подсвечены: первая дата — заезд, дальше — следующие ночи
function renderCalendar(hall) {
  const today = keyOf(nowMin());
  const last = addDays(today, data.maxDaysAhead);
  let [y, m] = today.split('-').map(Number);
  const inStay = (key) => sel.date && key >= sel.date && key < addDays(sel.date, sel.nights);
  let html = '';
  let shown = 0;
  for (; shown < calMonths; shown++) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    if (first > last) break;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (weekday(first) + 6) % 7;   // календарь с понедельника
    let cells = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => `<span class="cal-wd">${w}</span>`).join('') + '<span></span>'.repeat(offset);
    for (let d = 1; d <= days; d++) {
      const key = `${first.slice(0, 8)}${String(d).padStart(2, '0')}`;
      if (key < today || key > last) { cells += `<span class="cal-day past"><b>${d}</b></span>`; continue; }
      const ok = canCheckIn(hall.id, key);
      const on = inStay(key);
      const cls = on ? ` on${key === sel.date ? ' first' : ''}${key === addDays(sel.date, sel.nights - 1) ? ' last' : ''}` : '';
      cells += `<button type="button" class="cal-day${cls}" data-date="${key}" aria-pressed="${on}" ${ok ? '' : 'disabled'}
        aria-label="${dateText(key)}, ${ok ? rub(nightPrice(hall, key)) : 'занято'}"><b>${d}</b><i>${ok ? rub(nightPrice(hall, key)) : 'занято'}</i></button>`;
    }
    html += `<div class="cal-month"><p class="cal-title">${MONTHS_TITLE[m - 1]}</p><div class="cal-grid">${cells}</div></div>`;
    if (++m > 12) { m = 1; y++; }
  }
  if (`${y}-${String(m).padStart(2, '0')}-01` <= last) html += '<button type="button" class="cal-more" data-more>Показать следующий месяц</button>';
  $('dates').innerHTML = html;
}

function renderForm() {
  const hall = hallById(sel.hallId);
  $('sheet-title').textContent = hall.name;
  $('sheet-sub').textContent = 'Бронирование студии';
  // Все три студии видны сразу — без выпадающего списка
  $('hall-pick').innerHTML = data.halls.map((h) => `<button type="button" class="hall-opt" role="radio" data-hall="${h.id}" aria-checked="${h.id === hall.id}">
      <b>${esc(h.name)}</b><small>от ${rub(h.priceWeekday)} за сутки</small></button>`).join('');
  if (sel.date && !canCheckIn(hall.id, sel.date)) { sel.date = null; sel.nights = 1; }
  if (sel.date) sel.nights = Math.max(1, Math.min(sel.nights, maxNightsFrom(hall.id, sel.date)));

  renderCalendar(hall);
  $('dates-hint').textContent = !sel.date
    ? 'Выберите дату заезда. Нужно на двое суток или больше — отметьте и последнюю дату.'
    : `Заезд ${dateText(sel.date)} в ${pad(data.checkinHour)}, выезд ${dateText(addDays(sel.date, sel.nights))} в ${pad(data.checkoutHour)} — ${nightsText(sel.nights)}.` +
      (sel.nights === 1 ? ' Нужно на двое суток — нажмите и следующую дату.' : ' Выбрать заново — нажмите любую дату.');

  $('guests').textContent = sel.guests;
  // Доплата: 500 ₽ за каждого гостя сверх тарифа за сутки. Больше суток — отдельной строкой «× 2 суток = …»
  const extra = Math.max(0, sel.guests - hall.baseGuests);
  const perNight = extra * hall.extraGuestPrice;
  $('guests-hint').innerHTML = `В базовый тариф аренды входит до ${hall.baseGuests} человек, каждый следующий — ${rub(hall.extraGuestPrice)}. Комфортно до ${hall.capacity} гостей.` +
    (extra ? `<span class="extra">Доплата за ${extra} ${extra % 10 === 1 && extra % 100 !== 11 ? 'гостя' : 'гостей'}: +${rub(perNight)}</span>` +
      (sel.nights > 1 ? `<span class="extra">× ${nightsText(sel.nights)} = ${rub(perNight * sel.nights)}</span>` : '') : '');
  renderOverflow();
  renderSummary();
}

// Компания больше, чем помещается, — подсказываем позвонить
function renderOverflow() {
  const hall = hallById(sel.hallId);
  const box = $('overflow');
  if (sel.guests <= hall.capacity) { box.hidden = true; return; }
  if (!overflowTracked) { track('overflow'); overflowTracked = true; }
  box.innerHTML = `<p>В студии ${esc(hall.name)} комфортно до ${hall.capacity} гостей. Для большой компании позвоните нам — подберём вариант: <a href="tel:+${data.phone.replace(/\D/g, '')}">${esc(data.phone)}</a></p>`;
  box.hidden = false;
}

function missing() {
  const list = [];
  if (!sel.date) list.push('дата заезда');
  if (sel.guests > hallById(sel.hallId).capacity) list.push('гостей меньше');
  if ($('name').value.trim().length < 2) list.push('имя');
  if (phoneDigits().length !== 10) list.push('телефон');
  if (!$('consent').checked) list.push('согласие');
  return list;
}

function renderSummary() {
  const hall = hallById(sel.hallId);
  $('total').textContent = sel.date ? rub(stayTotal(hall, sel.date, sel.nights, sel.guests)) : `от ${rub(hall.priceWeekday)}`;
  const left = missing();
  $('summary-hint').textContent = left.length ? 'Осталось: ' + left.join(', ') : choiceText();
  $('submit').disabled = left.length > 0;
}
function choiceText() {
  return `${dateText(sel.date)} — ${dateText(addDays(sel.date, sel.nights))}, ${nightsText(sel.nights)}, ${guestsText(sel.guests)}`;
}

$('hall-pick').onclick = (e) => { const b = e.target.closest('[data-hall]'); if (b) { sel.hallId = Number(b.dataset.hall); renderForm(); } };
// Первое нажатие — дата заезда (1 сутки). Нажали дату позже — бронь растягивается до неё включительно
$('dates').onclick = (e) => {
  if (e.target.closest('[data-more]')) { calMonths++; renderForm(); return; }
  const b = e.target.closest('[data-date]');
  if (!b || b.disabled) return;
  const key = b.dataset.date;
  if (sel.date && sel.nights === 1 && key > sel.date) {
    const n = daysBetween(sel.date, key) + 1;
    if (n <= maxNightsFrom(sel.hallId, sel.date)) { sel.nights = n; renderForm(); return; }
  }
  sel.date = key;
  sel.nights = 1;
  renderForm();
};
$('g-plus').onclick = () => { sel.guests = Math.min(40, sel.guests + 1); renderForm(); };
$('g-minus').onclick = () => { sel.guests = Math.max(1, sel.guests - 1); renderForm(); };
for (const id of ['name', 'consent', 'comment']) $(id).addEventListener('input', renderSummary);
$('consent').addEventListener('change', renderSummary);

// Маска телефона: +7 (9XX) XXX-XX-XX. Возвращает 10 цифр без кода страны
function phoneDigits(raw = $('phone').value) {
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+7') || /^[78]/.test(d)) d = d.slice(1);
  return d.slice(0, 10);
}
function formatPhone(d) {
  if (!d) return '';
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)];
  return '+7 (' + p[0] + (d.length > 3 ? ') ' + p[1] : '') + (d.length > 6 ? '-' + p[2] : '') + (d.length > 8 ? '-' + p[3] : '');
}
$('phone').addEventListener('input', () => {
  const input = $('phone');
  const before = phoneDigits(input.value.slice(0, input.selectionStart)).length;
  const formatted = formatPhone(phoneDigits());
  input.value = formatted;
  let pos = formatted ? 4 : 0;
  for (let seen = 0; pos < formatted.length && seen < before; pos++) if (/\d/.test(formatted[pos])) seen++;
  input.setSelectionRange(pos, pos);
  input.classList.remove('invalid');
  renderSummary();
});
$('phone').addEventListener('blur', () => {
  const d = phoneDigits();
  $('phone').classList.toggle('invalid', d.length > 0 && (d.length !== 10 || d[0] !== '9'));
});

// ---------- После брони: итог и оплата ----------
let lastPrepay = 0;
function showDone(hall, res) {
  const photo = $('done-photo');
  photo.src = hall.photos[0];
  photo.alt = 'Студия ' + hall.name;
  $('done-hall').textContent = hall.name;
  const ticket = document.querySelector('.print');
  ticket.replaceWith(ticket.cloneNode(true));   // перезапуск анимации «полароида»
  $('done-title').textContent = `Студия ${hall.name} — бронь принята`;
  $('done-list').innerHTML = [
    ['Заезд', `${dateText(sel.date)} в ${pad(data.checkinHour)}`],
    ['Выезд', `${dateText(addDays(sel.date, sel.nights))} в ${pad(data.checkoutHour)}`],
    ['Гостей', String(sel.guests)],
    ['Сумма', rub(res.total)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  lastPrepay = res.prepay;
  $('done-prepay').innerHTML = `Чтобы забронировать студию, внесите предоплату <b>${rub(res.prepay)}</b> в течение 2 часов — после этого бронь снимается. После предоплаты администратор подтверждает бронь.`;
  $('done-main').hidden = false;
  $('pay').hidden = true;
}

// Способы оплаты задаёт владелец (в настройках сервера). Пока не заданы — честно пишем, что пришлёт администратор
function renderPay() {
  const pay = data.pay || {};
  $('pay-title').textContent = `Предоплата ${rub(lastPrepay)}`;
  $('pay-qr').innerHTML = pay.qr
    ? `<img class="pay-qr-img" src="${esc(pay.qr)}" alt="QR-код для оплаты" width="240" height="240"><p class="hint">Откройте приложение банка → «Оплата по QR» и наведите камеру. Сумма — ${rub(lastPrepay)}.</p>`
    : `<div class="qr-empty">QR-код для оплаты появится здесь</div><p class="hint">${pay.phone ? 'Пока QR-кода нет — оплатите по номеру телефона.' : 'Реквизиты для оплаты пришлёт администратор — он свяжется с вами по указанному телефону.'}</p>`;
  $('pay-phone').innerHTML = pay.phone
    ? `<p class="pay-num">${esc(pay.phone)}</p>
       <button type="button" class="btn btn-secondary btn-sm" id="copy-phone">Скопировать номер</button>
       <dl class="done-list">${pay.bank ? `<div><dt>Банк</dt><dd>${esc(pay.bank)}</dd></div>` : ''}${pay.name ? `<div><dt>Получатель</dt><dd>${esc(pay.name)}</dd></div>` : ''}<div><dt>Сумма</dt><dd>${rub(lastPrepay)}</dd></div></dl>
       <p class="hint">Перевод по СБП. В комментарии укажите имя и дату заезда.</p>`
    : '<p class="hint">Номер для перевода пришлёт администратор — он свяжется с вами по указанному телефону.</p>';
}
$('go-pay').onclick = () => {
  renderPay();
  $('done-main').hidden = true;
  $('pay').hidden = false;
  document.querySelector('.sheet-body').scrollTop = 0;
};
document.querySelector('.pay-tabs').onclick = (e) => {
  const b = e.target.closest('[data-pay]');
  if (!b) return;
  for (const x of document.querySelectorAll('[data-pay]')) x.setAttribute('aria-pressed', x === b);
  $('pay-qr').hidden = b.dataset.pay !== 'qr';
  $('pay-phone').hidden = b.dataset.pay !== 'phone';
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#copy-phone')) return;
  const btn = e.target.closest('#copy-phone');
  navigator.clipboard?.writeText(data.pay.phone.replace(/[^\d+]/g, '')).then(() => { btn.textContent = 'Номер скопирован'; }).catch(() => {});
});

// ---------- Отправка ----------
let sending = false;
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending || missing().length) return;
  if (phoneDigits()[0] !== '9') { $('error').textContent = 'Нужен мобильный номер — администратор свяжется по нему.'; return; }
  sending = true;
  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = 'Бронируем…';
  $('error').textContent = '';
  const hall = hallById(sel.hallId);
  try {
    const { status, data: res } = await apiBook({
      hallId: sel.hallId, date: sel.date, nights: sel.nights, guests: sel.guests,
      name: $('name').value.trim(), phone: '7' + phoneDigits(), comment: $('comment').value.trim(), website: $('website').value,
    });
    if (status === 201) {
      // Бронь окончательная после предоплаты — сразу показываем итог и кнопку «Готов внести предоплату»
      showDone(hall, res);
      $('form').hidden = true;
      $('done').hidden = false;
      $('form').reset();
      await load();
      return;
    }
    $('error').textContent = res.error || 'Не получилось забронировать. Попробуйте ещё раз.';
    if (status === 409 || res.code === 'capacity') await load(); // даты успели занять — обновляем календарь
  } catch {
    $('error').textContent = `Нет связи с сервером. Проверьте интернет или позвоните: ${data.phone}`;
  } finally {
    sending = false;
    btn.textContent = 'Забронировать';
    if (!$('form').hidden) renderSummary();
  }
});

// ---------- Плавное появление при прокрутке: всё, кроме шапки и первого экрана ----------
// Берём каждый «кирпичик» страницы: заголовки, абзацы, пункты, фото, кнопки, карту, подвал.
// Если кирпичик уже лежит внутри другого выбранного (абзац внутри пункта меню) — анимируем только внешний, чтобы не было двойного движения
const ATOMS = 'h2, h3, p, li, dl > div, dt, dd, img, iframe, details, .actions, .btn, .bath-media, .state, .kicker, .label, .foot > *';
const SKIP = '.cover, .top, #sheet, .sprite, [hidden]';
const IMGS = '.bath-media, img, iframe';
const revealer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    // Что заехало на экран одновременно — появляется лесенкой сверху вниз с шагом 0.07 с
    const batch = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top || x.boundingClientRect.left - y.boundingClientRect.left);
    batch.forEach((e, i) => {
      e.target.style.setProperty('--d', Math.min(i, 8) * 0.07 + 's');
      revealer.unobserve(e.target);
      // Через кадр: браузер сначала «видит» спрятанное состояние, потом плавно показывает
      requestAnimationFrame(() => requestAnimationFrame(() => e.target.classList.add('in')));
    });
  }, { threshold: 0 })
  : null;
function reveal() {
  const picked = [...document.querySelectorAll(ATOMS)].filter((el) => !el.closest(SKIP) && !el.classList.contains('reveal'));
  const set = new Set(picked);
  for (const el of picked) {
    let up = el.parentElement, inside = false;
    while (up && up !== document.body) { if (set.has(up) || up.classList.contains('reveal')) { inside = true; break; } up = up.parentElement; }
    if (inside) continue;
    el.classList.add('reveal');
    if (el.matches(IMGS)) el.classList.add('reveal-img');
    if (revealer) revealer.observe(el); else el.classList.add('in');
  }
}

track('view');
// Студии и цены из файла сайта рисуем сразу — не ждём сервер (Google отвечает 3–7 секунд).
// Сервер потом только подтянет занятые даты и статусы «свободна сегодня»
if (window.SITE_DATA) {
  data = { ...window.SITE_DATA, now: Math.floor(Date.now() / 60000) + window.SITE_DATA.tz * 60 };
  renderCards();
  renderBaths();
}
reveal();
load();
setInterval(load, 60_000); // занятость обновляется раз в минуту — без перезагрузки страницы
