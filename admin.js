// Админка бесплатной версии: брони из Google Таблицы, подтверждение, бронь по звонку / с Авито,
// завершённые брони и календарь по дням. Все запросы идут в «мозг» на Google Apps Script (адрес — в config.js)
const $ = (id) => document.getElementById(id);
const API = window.API_URL;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAYS_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const STATUS = { new: 'Ждёт ответа', confirmed: 'Подтверждена', rejected: 'Отклонена', cancelled: 'Отменена' };
const SOURCE_TITLE = { site: 'С сайта', phone: 'По звонку', avito: 'С Авито' };

let st = null;          // ответ сервера: студии, брони, правила
let password = '';
let filter = 'upcoming';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = (n) => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => new Date(min * 60000).toISOString().slice(11, 16);
const keyOf = (min) => new Date(min * 60000).toISOString().slice(0, 10);
const keyToMin = (key) => Date.parse(key + 'T00:00:00Z') / 60000;
const hallById = (id) => st.halls.find((h) => h.id === id);
const fmtPhone = (p) => String(p || '').replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2-$3-$4');
function dayText(min) {
  const d = new Date(min * 60000);
  const diff = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 60000 - Math.floor(st.now / 1440) * 1440) / 1440);
  const label = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : WEEKDAYS[d.getUTCDay()][0].toUpperCase() + WEEKDAYS[d.getUTCDay()].slice(1);
  return `${label}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
// «29 декабря (пятница)» и «в четверг, 27 ноября»
function dateParen(min) { const d = new Date(min * 60000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} (${WEEKDAYS[d.getUTCDay()]})`; }
function dateIn(min) { const d = new Date(min * 60000); return `в ${WEEKDAYS_ACC[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
function addDays(key, n) { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function nightPrice(h, key) {
  const sp = st.prices && st.prices[key];
  if (typeof sp === 'number') return sp;
  if (sp && sp[h.id]) return Number(sp[h.id]);
  const wd = new Date(key + 'T00:00:00Z').getUTCDay();
  return wd === 5 ? h.priceFriday : wd === 6 ? h.priceSaturday : h.priceWeekday;
}

// Запрос к «мозгу»: простой POST без заголовков — Google принимает его без предварительной проверки
async function api(action, body = {}) {
  let r;
  try { r = await fetch(API, { method: 'POST', body: JSON.stringify({ action, password, ...body }) }); }
  catch { throw new Error('Нет связи. Проверьте интернет.'); }
  const data = await r.json().catch(() => ({ ok: false, error: 'Ошибка сервера' }));
  if (data.status === 401) { logout(); throw new Error(data.error); }
  if (!data.ok) throw Object.assign(new Error(data.error || 'Ошибка'), { data });
  return data;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---------- Вход ----------
function logout() {
  password = '';
  try { sessionStorage.removeItem('pr-pass'); } catch {}
  $('app').hidden = true;
  $('login').hidden = false;
}
$('logout').onclick = logout;
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  password = $('login-password').value;
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  try {
    await refresh();
    try { sessionStorage.setItem('pr-pass', password); } catch {}
    $('login').hidden = true;
    $('app').hidden = false;
  } catch (err) { $('login-error').textContent = err.message; password = ''; }
  finally { $('login-btn').disabled = false; }
});

// ---------- Брони ----------
async function refresh() {
  st = await api('admin_list');
  render();
}

function render() {
  $('clock').textContent = dayText(st.now) + ', ' + hhmm(st.now) + ' по Иркутску';
  const pending = st.bookings.filter((b) => b.status === 'new');
  document.title = (pending.length ? `(${pending.length}) ` : '') + 'Админка — Party Rooms';
  $('inbox').innerHTML = pending.length
    ? `<p class="inbox-title">Новые брони с сайта — позвоните гостю, примите предоплату и подтвердите</p><div class="inbox">${pending.map((b) => card(b, { req: true })).join('')}</div>`
    : '';
  renderList();
}

// Карточка брони: всё отдельными пунктами, студия крупно
function card(b, { req = false } = {}) {
  const now = st.now;
  const actions = [];
  if (b.status === 'new') actions.push(`<button class="btn btn-primary btn-sm" type="button" data-op="confirm" data-id="${b.id}">Подтвердить</button>`, `<button class="btn btn-danger btn-sm" type="button" data-op="reject" data-id="${b.id}">Отклонить</button>`);
  if (!req && b.status === 'confirmed' && b.end > now) actions.push(`<button class="link" type="button" data-op="cancel" data-id="${b.id}">Отменить</button>`);
  const phone = b.phoneHidden || !b.phone ? 'номер засекречен' : `<a href="tel:${esc(b.phone)}">${esc(fmtPhone(b.phone))}</a>`;
  const guests = b.guestsUnknown ? 'гостей: не известно' : `${b.guests} чел.`;
  const status = b.end <= now && b.status === 'confirmed' ? 'Завершена' : STATUS[b.status];
  return `<article class="bk2 ${req ? 'req2' : ''}">
    <header><b class="bk-hall">${esc(hallById(b.hallId)?.name)}</b><span class="pill ${b.status}">${status}</span></header>
    <p class="bk-who">${esc(b.name)}, ${phone}, ${guests}</p>
    <p>Заезд ${dateParen(b.start)} в ${hhmm(b.start)}</p>
    <p>Выезд ${dateParen(b.end)} в ${hhmm(b.end)}</p>
    <p>Общая сумма: <b>${rub(b.total)}</b></p>
    <p class="bk-src">${SOURCE_TITLE[b.source] || ''}</p>
    ${b.comment ? `<p class="bk-comment">Комментарий: ${esc(b.comment)}</p>` : ''}
    ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
  </article>`;
}
function groupByDay(list) {
  let lastDay = '';
  return list.map((b) => {
    const day = keyOf(b.start);
    const head = day !== lastDay ? `<p class="day-label">${dayText(b.start)}</p>` : '';
    lastDay = day;
    return head + card(b);
  }).join('');
}

// История за период (прошедшие брони и календарь) — кэшируем на минуту
const historyCache = new Map();
async function history(from, to) {
  const key = from + ':' + to;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  const r = await api('admin_history', { from, to });
  historyCache.set(key, { at: Date.now(), list: r.bookings });
  return r.bookings;
}

let calMonth = null, calDay = null;
async function renderList() {
  const box = $('bookings');
  if (filter === 'done') {
    box.innerHTML = '<p class="empty">Загружаем…</p>';
    const today = keyOf(st.now);
    try {
      const list = (await history(addDays(today, -90), today)).filter((b) => b.end <= st.now).sort((a, b) => b.start - a.start);
      box.innerHTML = list.length ? groupByDay(list) : '<p class="empty">Завершённых броней за последние 3 месяца нет.</p>';
    } catch (err) { box.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
    return;
  }
  if (filter === 'cal') return renderCalendar();
  const list = st.bookings.filter((b) => b.status === 'confirmed' && b.end > st.now);
  box.innerHTML = list.length ? groupByDay(list) : '<p class="empty">Подтверждённых броней пока нет.</p>';
}

// Календарь: месяц, под числом — первые буквы студий с заездом; нажали день — видно заезды и кто проживает
async function renderCalendar() {
  const today = keyOf(st.now);
  if (!calMonth) calMonth = today.slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const box = $('bookings');
  let list = [];
  try { list = await history(first, `${calMonth}-${pad(days)}`); } catch (err) { box.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
  const byDay = {};
  for (const b of list) (byDay[keyOf(b.start)] ||= []).push(b);
  const offset = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  let cells = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => `<span class="pc-wd">${w}</span>`).join('') + '<span></span>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const key = `${calMonth}-${pad(d)}`;
    const ins = byDay[key] || [];
    cells += `<button type="button" class="pc-day${key === today ? ' today' : ''}${key === calDay ? ' on' : ''}${key < today ? ' past' : ''}" data-day="${key}">
      <b>${d}</b>${ins.length ? `<i>${ins.map((b) => esc(hallById(b.hallId)?.name.slice(0, 1))).join(' ')}</i>` : ''}</button>`;
  }
  let dayList = '<p class="hint">Нажмите на день — покажем заезды и кто в какой студии. Буквы под числом — студии с заездом в этот день.</p>';
  if (calDay) {
    const a = keyToMin(calDay), b2 = keyToMin(addDays(calDay, 1));
    const ins = list.filter((b) => keyOf(b.start) === calDay);
    const staying = list.filter((b) => keyOf(b.start) !== calDay && b.start < b2 && b.end > a + 12 * 60);
    dayList = `<p class="day-label">${dayText(keyToMin(calDay))}</p>` +
      (ins.length ? `<p class="pc-sub">Заезды</p>${ins.map((b) => card(b)).join('')}` : '<p class="empty">Заездов в этот день нет.</p>') +
      (staying.length ? `<p class="pc-sub">Ещё проживают с прошлых дней</p>${staying.map((b) => card(b)).join('')}` : '');
  }
  box.innerHTML = `<div class="pcal">
      <div class="pc-head"><button type="button" class="icon-btn" data-cal="-1" aria-label="Предыдущий месяц">‹</button><b>${MONTHS_TITLE[m - 1]} ${y}</b><button type="button" class="icon-btn" data-cal="1" aria-label="Следующий месяц">›</button></div>
      <div class="pc-grid">${cells}</div>
    </div>${dayList}`;
}
$('bookings').addEventListener('click', (e) => {
  const nav = e.target.closest('[data-cal]');
  if (nav) {
    const [y, m] = calMonth.split('-').map(Number);
    calMonth = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.cal), 1)).toISOString().slice(0, 7);
    calDay = null;
    renderCalendar();
    return;
  }
  const day = e.target.closest('[data-day]');
  if (day) { calDay = day.dataset.day; renderCalendar(); }
});
$('filters').onclick = (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of $('filters').children) x.setAttribute('aria-pressed', x === b);
  renderList();
};

const ASK = { reject: 'Отклонить бронь? Предупредите гостя по телефону.', cancel: 'Отменить бронь? Даты снова станут свободными на сайте.' };
const DONE = { confirm: 'Бронь подтверждена', reject: 'Бронь отклонена', cancel: 'Бронь отменена' };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-op]');
  if (!b) return;
  if (ASK[b.dataset.op] && !confirm(ASK[b.dataset.op])) return;
  b.disabled = true;
  try {
    await api('admin_action', { id: Number(b.dataset.id), op: b.dataset.op });
    toast(DONE[b.dataset.op]);
    historyCache.clear();
    await refresh();
  } catch (err) { toast(err.message); b.disabled = false; }
});

// ---------- Бронь по звонку или с Авито: сразу подтверждена, даты закрываются на сайте ----------
$('new-booking').onclick = () => openForm(st.halls[0].id);

function openForm(hallId, keep = {}) {
  const today = keyOf(st.now);
  const src = keep.source || 'phone';
  const date = keep.date || today;
  const checkout = keep.checkout || addDays(date, 1);
  const hr = (h) => pad(h) + ':00';
  const check = (id, label, on) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> <span>${label}</span></label>`;
  $('modal-body').innerHTML = `<h2>Бронь по звонку или с Авито</h2>
    <form id="bf" novalidate>
      <div class="chips" id="bf-source" role="group" aria-label="Откуда бронь">
        <button type="button" class="chip" data-src="phone" aria-pressed="${src === 'phone'}">По звонку</button>
        <button type="button" class="chip" data-src="avito" aria-pressed="${src === 'avito'}">С Авито</button>
      </div>
      <div class="field"><span>Студия</span><div class="hall-chips" id="bf-hall" role="radiogroup">${st.halls.map((h) => `<button type="button" class="chip" data-hall="${h.id}" aria-pressed="${h.id === hallId}">${esc(h.name)}</button>`).join('')}</div></div>
      <label class="field"><span>Дата заезда (в ${hr(st.checkinHour)})</span><input id="bf-date" type="date" min="${today}" max="${addDays(today, st.maxDaysAhead)}" value="${date}" required><small class="wd" id="bf-date-wd"></small></label>
      <label class="field"><span>Дата выезда (в ${hr(st.checkoutHour)})</span><input id="bf-checkout" type="date" min="${addDays(date, 1)}" value="${checkout}" required><small class="wd" id="bf-out-wd"></small></label>
      <label class="field"><span>Гостей</span><input id="bf-guests" type="number" min="1" max="50" value="${keep.guests || 8}" required></label>
      ${check('bf-guests-unknown', 'Не известно', keep.guestsUnknown)}
      <label class="field"><span>Имя гостя</span><input id="bf-name" maxlength="60" value="${esc(keep.anonymous ? '' : keep.name || '')}" required></label>
      ${check('bf-anon', 'Аноним', keep.anonymous)}
      <label class="field"><span>Телефон гостя</span><input id="bf-phone" type="tel" inputmode="tel" placeholder="+7 9__ ___-__-__" value="${esc(keep.phone || '')}" required></label>
      ${check('bf-phone-hidden', 'Засекречен', keep.phoneHidden)}
      <label class="field"><span>Комментарий</span><textarea id="bf-comment" rows="2" maxlength="500">${esc(keep.comment || '')}</textarea></label>
      <div class="bf-summary" id="bf-sum"></div>
      <div class="form-foot"><button class="btn btn-primary" type="submit">Забронировать</button></div>
      <p class="error" id="bf-error" role="alert"></p>
      <div class="suggest chips" id="bf-suggest"></div>
    </form>`;
  if (!$('modal').open) $('modal').showModal();
  let source = src;
  let hallSel = hallId;
  const pick = (box, attr, value) => { for (const c of box.children) c.setAttribute('aria-pressed', c.dataset[attr] === String(value)); };
  $('bf-source').onclick = (e) => { const x = e.target.closest('[data-src]'); if (x) { source = x.dataset.src; pick($('bf-source'), 'src', source); } };
  $('bf-hall').onclick = (e) => { const x = e.target.closest('[data-hall]'); if (x) { hallSel = Number(x.dataset.hall); pick($('bf-hall'), 'hall', hallSel); sum(); } };
  // Сменили дату заезда — выезд сдвигается вместе с ней (на те же сутки)
  let nights = Math.max(1, Math.round((keyToMin(checkout) - keyToMin(date)) / 1440));
  $('bf-date').addEventListener('change', () => {
    const d = $('bf-date').value;
    if (!d) return;
    $('bf-checkout').min = addDays(d, 1);
    $('bf-checkout').value = addDays(d, nights);
  });
  $('bf-checkout').addEventListener('change', () => {
    const d = $('bf-date').value, out = $('bf-checkout').value;
    if (d && out > d) nights = Math.round((keyToMin(out) - keyToMin(d)) / 1440);
  });
  const toggles = [['bf-guests-unknown', 'bf-guests'], ['bf-anon', 'bf-name'], ['bf-phone-hidden', 'bf-phone']];
  const syncChecks = () => { for (const [c, f] of toggles) { $(f).disabled = $(c).checked; $(f).closest('.field').classList.toggle('off', $(c).checked); } };
  const sum = () => {
    syncChecks();
    const h = hallById(hallSel);
    const d = $('bf-date').value, out = $('bf-checkout').value;
    $('bf-date-wd').textContent = d ? WEEKDAYS[new Date(d + 'T00:00:00Z').getUTCDay()] : '';
    $('bf-out-wd').textContent = out ? WEEKDAYS[new Date(out + 'T00:00:00Z').getUTCDay()] : '';
    if (!d || !out || out <= d) { $('bf-sum').innerHTML = '<p class="hint">Дата выезда должна быть позже даты заезда.</p>'; return; }
    const n = Math.round((keyToMin(out) - keyToMin(d)) / 1440);
    const unknown = $('bf-guests-unknown').checked;
    const g = unknown ? h.baseGuests : Number($('bf-guests').value);
    let total = 0;
    for (let i = 0; i < n; i++) total += nightPrice(h, addDays(d, i));
    total += Math.max(0, g - h.baseGuests) * (h.extraGuestPrice || 0) * n;
    $('bf-sum').innerHTML = g > h.capacity
      ? `<p class="error">В студии ${esc(h.name)} комфортно до ${h.capacity} гостей</p>`
      : `<p>Заезд ${dateIn(keyToMin(d))} (${hr(st.checkinHour)})</p><p>Выезд ${dateIn(keyToMin(out))} (${hr(st.checkoutHour)})</p>
         <p>Гостей: ${unknown ? 'не известно' : g}</p><p class="bf-total">Сумма: <b>${rub(total)}</b></p>`;
  };
  const form = $('bf');
  form.addEventListener('input', sum);
  form.addEventListener('change', sum);
  sum();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
      source, hallId: hallSel, date: $('bf-date').value, checkout: $('bf-checkout').value,
      guests: Number($('bf-guests').value), guestsUnknown: $('bf-guests-unknown').checked,
      name: $('bf-name').value, anonymous: $('bf-anon').checked,
      phone: $('bf-phone').value, phoneHidden: $('bf-phone-hidden').checked, comment: $('bf-comment').value,
    };
    $('bf-error').textContent = '';
    $('bf-suggest').innerHTML = '';
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    try {
      await api('admin_book', values);
      $('modal').close();
      toast('Бронь создана');
      historyCache.clear();
      await refresh();
    } catch (err) {
      $('bf-error').textContent = err.message;
      const s = err.data?.suggest;
      if (s?.length) {
        $('bf-suggest').innerHTML = '<span class="hint">Свободны на эти даты:</span>' + s.map((h) => `<button type="button" class="chip" data-switch="${h.id}">${esc(h.name)}</button>`).join('');
        $('bf-suggest').onclick = (ev) => { const x = ev.target.closest('[data-switch]'); if (x) openForm(Number(x.dataset.switch), values); };
      }
    } finally { btn.disabled = false; btn.textContent = 'Забронировать'; }
  });
}

// ---------- Цены: студии по дням недели, доплата за гостя и особые даты (праздники) ----------
// Сохраняются в Google — сайт сразу считает по новым ценам, перезаливать ничего не нужно
const DAY_TITLES = [['priceWeekday', 'Вс–чт'], ['priceFriday', 'Пятница'], ['priceSaturday', 'Суббота'], ['extraGuestPrice', 'Доплата за гостя сверх 8']];
$('price-settings').onclick = async () => {
  $('modal-body').innerHTML = '<h2>Цены</h2><p class="hint">Загружаем…</p>';
  if (!$('modal').open) $('modal').showModal();
  let pr;
  try { pr = await api('admin_pricing'); } catch (err) { $('modal-body').innerHTML = `<h2>Цены</h2><p class="error">${esc(err.message)}</p>`; return; }
  // Строка праздника: дата сверху, под ней цены трёх студий с подписями
  const dateRow = (key = '', vals = {}) => `<div class="pd-row">
      <div class="pd-top"><input type="date" class="pd-date" value="${esc(key)}" aria-label="Дата заезда"><button type="button" class="icon-btn pd-del" aria-label="Убрать дату">×</button></div>
      <div class="pd-prices">${pr.halls.map((h) => `<label><small>${esc(h.name)}</small><input type="number" inputmode="numeric" min="0" step="100" class="pd-price" data-hall="${h.id}" value="${vals[h.id] ?? ''}" placeholder="обычная"></label>`).join('')}</div>
    </div>`;
  // Старый формат «одна цена для всех студий» превращаем в цены по студиям
  const dates = Object.entries(pr.dates || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, typeof v === 'number' ? Object.fromEntries(pr.halls.map((h) => [h.id, v])) : v]);
  $('modal-body').innerHTML = `<h2>Цены</h2>
    <p class="hint">Цена за сутки в рублях. Сохранили — сайт сразу считает по новым ценам.</p>
    <form id="prf" novalidate>
      ${pr.halls.map((h) => `<fieldset class="pr-hall"><legend>${esc(h.name)}</legend>
        <div class="pr-grid">${DAY_TITLES.map(([k, t]) => `<label class="field"><span>${t}</span><input type="number" inputmode="numeric" min="0" step="100" data-hall="${h.id}" data-k="${k}" value="${h[k]}"></label>`).join('')}</div>
      </fieldset>`).join('')}
      <div class="field"><span>Особые даты — праздники, Новый год</span>
        <p class="hint">Дата заезда и цена ночи для каждой студии. Пустая клетка — в этот день обычная цена студии.</p>
        <div id="pd-list">${dates.map(([k, v]) => dateRow(k, v)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" id="pd-add">+ Добавить дату</button>
      </div>
      <div class="form-foot"><button class="btn btn-primary" type="submit">Сохранить цены</button></div>
      <p class="error" id="prf-error" role="alert"></p>
    </form>`;
  $('pd-add').onclick = () => { $('pd-list').insertAdjacentHTML('beforeend', dateRow()); $('pd-list').lastElementChild.querySelector('.pd-date').focus(); };
  $('pd-list').onclick = (e) => { const x = e.target.closest('.pd-del'); if (x) x.closest('.pd-row').remove(); };
  $('prf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('prf').querySelector('[type="submit"]');
    const halls = {};
    for (const inp of $('prf').querySelectorAll('.pr-grid input')) (halls[inp.dataset.hall] ||= {})[inp.dataset.k] = inp.value;
    const out = {};
    for (const row of $('pd-list').querySelectorAll('.pd-row')) {
      const key = row.querySelector('.pd-date').value;
      const vals = {};
      for (const inp of row.querySelectorAll('.pd-price')) if (inp.value !== '') vals[inp.dataset.hall] = inp.value;
      if (!key && !Object.keys(vals).length) continue;          // пустая строка — пропускаем
      if (!key) { $('prf-error').textContent = 'У одной из особых цен не указана дата'; return; }
      if (out[key]) { $('prf-error').textContent = `Дата ${key.split('-').reverse().join('.')} указана дважды — оставьте одну строку`; return; }
      out[key] = vals;
    }
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    $('prf-error').textContent = '';
    try {
      await api('admin_pricing', { save: true, halls, dates: out });
      $('modal').close();
      toast('Цены сохранены — сайт уже считает по новым');
      await refresh();
    } catch (err) { $('prf-error').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Сохранить цены'; }
  };
};

// ---------- Реквизиты для предоплаты: номер, банк, получатель и QR-код ----------
// Сохраняются в Google и сразу появляются у гостей на экране оплаты — сайт перезаливать не нужно
$('pay-settings').onclick = async () => {
  $('modal-body').innerHTML = '<h2>Реквизиты для оплаты</h2><p class="hint">Загружаем…</p>';
  if (!$('modal').open) $('modal').showModal();
  let pay;
  try { pay = (await api('admin_settings')).pay; } catch (err) { $('modal-body').innerHTML = `<h2>Реквизиты для оплаты</h2><p class="error">${esc(err.message)}</p>`; return; }
  let qr;   // undefined — QR не трогали, '' — убрать, data:image/… — новая картинка
  $('modal-body').innerHTML = `<h2>Реквизиты для оплаты</h2>
    <p class="hint">Гость видит их после брони, на экране «Готов внести предоплату».</p>
    <form id="pf" novalidate>
      <label class="field"><span>Номер для перевода (СБП)</span><input id="pf-phone" type="tel" inputmode="tel" placeholder="8 (999) 000-00-00" value="${esc(pay.phone)}"></label>
      <label class="field"><span>Банк</span><input id="pf-bank" maxlength="60" placeholder="Сбербанк" value="${esc(pay.bank)}"></label>
      <label class="field"><span>Получатель — как его видит отправитель</span><input id="pf-name" maxlength="60" placeholder="Иван И." value="${esc(pay.name)}"></label>
      <div class="field"><span>QR-код для оплаты</span>
        <div class="qr-edit">
          <div class="qr-prev" id="pf-qr-prev">${pay.qr ? `<img src="${esc(pay.qr)}" alt="QR-код">` : '<small>QR-кода нет</small>'}</div>
          <div class="qr-actions">
            <label class="btn btn-secondary btn-sm">Загрузить картинку<input type="file" id="pf-qr" accept="image/*" hidden></label>
            <button class="link" type="button" id="pf-qr-del" ${pay.qr ? '' : 'hidden'}>Убрать QR</button>
          </div>
        </div>
        <small class="hint">Подойдёт скриншот из приложения банка — обрежьте его до самого кода. Нужен постоянный QR, без срока действия.</small>
      </div>
      <div class="form-foot"><button class="btn btn-primary" type="submit">Сохранить</button></div>
      <p class="error" id="pf-error" role="alert"></p>
    </form>`;
  const setPrev = (src) => {
    $('pf-qr-prev').innerHTML = src ? `<img src="${src}" alt="QR-код">` : '<small>QR-кода нет</small>';
    $('pf-qr-del').hidden = !src;
  };
  $('pf-qr').onchange = async () => {
    const file = $('pf-qr').files[0];
    if (!file) return;
    $('pf-error').textContent = '';
    try { qr = await shrinkImage(file); setPrev(qr); }
    catch (err) { $('pf-error').textContent = err.message; }
  };
  $('pf-qr-del').onclick = () => { qr = ''; setPrev(''); };
  $('pf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('pf').querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    $('pf-error').textContent = '';
    try {
      const body = { save: true, phone: $('pf-phone').value, bank: $('pf-bank').value, name: $('pf-name').value };
      if (qr !== undefined) body.qr = qr;
      await api('admin_settings', body);
      $('modal').close();
      toast('Реквизиты сохранены — гости уже видят новые');
    } catch (err) { $('pf-error').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Сохранить'; }
  };
};

// Картинку QR уменьшаем прямо в браузере: таблица Google хранит в ячейке не больше ~49 000 символов.
// QR чёрно-белый, поэтому PNG до 360 точек обычно весит в разы меньше и остаётся чётким
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      for (const size of [360, 300, 240]) {
        const k = Math.min(1, size / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingEnabled = k < 1;
        g.drawImage(img, 0, 0, c.width, c.height);
        for (const url of [c.toDataURL('image/png'), c.toDataURL('image/jpeg', 0.85)]) if (url.length <= 49000) return resolve(url);
      }
      reject(new Error('Картинка слишком большая — обрежьте скриншот до самого QR-кода'));
    };
    img.onerror = () => reject(new Error('Не получилось открыть картинку — нужен PNG или JPG'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Старт ----------
try { password = sessionStorage.getItem('pr-pass') || ''; } catch {}
if (!API) { $('login').hidden = false; $('login-error').textContent = 'Не задан адрес сервера в config.js'; }
else if (password) refresh().then(() => { $('app').hidden = false; }).catch(() => logout());
else $('login').hidden = false;
setInterval(() => { if (password && !$('app').hidden && !$('modal').open) refresh().catch(() => {}); }, 60_000);
