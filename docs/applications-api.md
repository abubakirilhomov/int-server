# int-server API — справочник для internUp

Документация REST API эндпоинтов, которые потребляет internUp SPA после миграции с Supabase. Если что-то в коде расходится с этим документом — права **версия из репо** (`int-server/src/controllers/applicationController.js`, `int-server/src/routes/applicationRoutes.js`, `int-server/src/models/applicationModel.js`). Сообщай разработчику int-server о расхождениях.

---

## 1. Окружения

| Окружение | URL |
|---|---|
| Production | `https://<int-server-prod-host>/api` — узнать у архитектора |
| Local dev | `http://localhost:3000/api` (если int-server поднят рядом) |

В коде используем `import.meta.env.VITE_API_URL` который должен содержать полный путь **включая `/api`**. Никогда не приклеивай `/api` в коде — это вызовет двойной префикс `/api/api/applications`.

`.env`:
```
VITE_API_URL=https://<host>/api
```

---

## 2. CORS

Бэкенд разрешает:
- Все `http://localhost:*` и `http://127.0.0.1:*` (любой порт) — для dev.
- Запросы **без `Origin` header** — для Postman desktop, curl, server-to-server.
- Whitelisted прод-домены: `https://internup-zeta.vercel.app` (и ещё несколько mars-доменов).

Куки и credentials: `credentials: true` со стороны бэка. Если ты будешь делать запросы с куками (для лидоформы — не нужно), на клиенте указывай `credentials: "include"`. Для публичных эндпоинтов без авторизации куки не нужны вообще.

Если получаешь CORS-ошибку:
- Убедись что origin страницы попадает в whitelist (например, прод-Vercel-URL изменился — скажи нам).
- Убедись что не делаешь preflight на эндпоинт который его не ожидает (для простых POST с `Content-Type: application/json` preflight будет всегда; это нормально).

---

## 3. Public эндпоинты

Эндпоинты ниже **не требуют авторизации**. Это всё, что internUp использует.

### 3.1. `GET /applications/form-data`

Возвращает данные для построения формы (филиалы с менторами, доступные сферы и смены).

**Параметры:** нет.

**Rate limit:** 30 запросов в минуту с одного IP. На 31-м — `429`.

**Кеширование:** ответ помечен `Cache-Control: public, max-age=300` (5 минут). Браузер может кешировать.

**Response 200:**
```json
{
  "branches": [
    {
      "id": "65f100abcdef1234567890ab",
      "name": "Сергели",
      "mentors": [
        { "id": "65f200...", "name": "Иванов Иван" },
        { "id": "65f201...", "name": "Петров Пётр" }
      ]
    },
    {
      "id": "65f101...",
      "name": "Ойбек",
      "mentors": [...]
    }
  ],
  "spheres": [
    { "value": "backend-nodejs", "label": "Backend Node" },
    { "value": "backend-python", "label": "Backend Python" },
    { "value": "frontend-react", "label": "Frontend React" },
    { "value": "frontend-vue",   "label": "Frontend Vue" },
    { "value": "mern-stack",     "label": "React + Python" },
    { "value": "full-stack",     "label": "React + Node" }
  ],
  "shifts": [
    { "value": "morning", "label": "1-smena (Ertalabki)" },
    { "value": "evening", "label": "2-smena (Kechki)" }
  ]
}
```

**Заметки:**
- `branches[i].id`, `branches[i].mentors[j].id` — MongoDB ObjectId (24-символьная hex-строка). **Это значение хранишь в state и шлёшь в `POST /applications`**. Имена показываешь юзеру, ID шлёшь на сервер.
- `mentors` уже отфильтрованы по филиалу. Не нужна отдельная карта `mentorsByBranch` — пользователь выбирает филиал → берёшь `selectedBranch.mentors`.
- В `mentors` попадают только мейн-менторы (без `role: admin`). Админы не показываются как варианты выбора.
- `spheres` и `shifts` пришли с сервера. Не хардкодь их в клиенте — бизнес может поменять состав. Если внезапно нужна новая сфера/смена — фронт перерисуется автоматически после рефреша.
- Соответствие label → реальное значение в БД фиксированное (не меняется). Но на ярлыки опираться нельзя — храним `value`.

**Возможные ошибки:**
- `429` — превышен rate-limit:
  ```json
  { "error": "Слишком много запросов. Попробуйте через минуту." }
  ```
- `500` — внутренняя ошибка. Показывай fallback экран "Не удалось загрузить данные, попробуйте позже".

---

### 3.2. `POST /applications`

Создаёт заявку. Триггерит:
1. Запись в Mongo коллекцию `applications`.
2. Fire-and-forget Telegram-уведомления получателям (роутинг по сфере + branch manager).

**Rate limit:** 5 заявок в час с одного IP. На 6-й — `429`.

**Request body (JSON):**
```json
{
  "fullName": "Ali Valiyev",
  "phone": "+998-90-123-45-67",
  "telegramUsername": "@username",
  "age": 18,
  "branchId": "65f100abcdef1234567890ab",
  "mentorId": "65f200abcdef1234567890ab",
  "sphere": "frontend-react",
  "shift": "morning"
}
```

**Поля и валидация:**

| Поле | Тип | Правило |
|---|---|---|
| `fullName` | string | trim, 4-100 символов, **минимум 2 слова** (regex `^\S+\s+\S+`). Бэк делит по первому пробелу: всё до — `firstName`, всё после — `lastName`. |
| `phone` | string | Требуется. Формат не валидируется в Joi — нормализуется и проверяется в контроллере. Поддерживаемый формат: `+998-XX-XXX-XX-XX` (с дефисами). |
| `telegramUsername` | string | Обязателен. Должен начинаться с `@`, дальше `[a-zA-Z0-9_]{5,32}`. Если без `@` — пиши сам клиент его добавит. Lowercased на сервере. |
| `age` | integer | **14 ≤ age ≤ 60**. Не 12-24 (это локальное правило internUp было), а именно 14-60 на сервере. Если бизнес-логике internUp нужна более строгая рамка — валидируй на клиенте, на сервер шли только проходящие. |
| `branchId` | string | 24-символьный hex ObjectId из `form-data`. |
| `mentorId` | string | 24-символьный hex ObjectId из `form-data`. **Ментор должен относиться к выбранному `branchId`** — иначе 400. |
| `sphere` | string | Один из: `backend-nodejs`, `backend-python`, `frontend-react`, `frontend-vue`, `mern-stack`, `full-stack`. |
| `shift` | string | Один из: `morning`, `evening`. |

**Response 201 (успех):**
```json
{
  "id": "65f3aabbccdd112233445566",
  "status": "pending"
}
```

Это **минимальный** ответ — фронт получает `id` (для будущих ссылок если понадобится) и `status` (всегда `pending` для свежей заявки).

⚠️ Раньше в брифе упоминался `responsiblePersons` в ответе — этого **нет**. Telegram-уведомления уходят асинхронно после `201`, и список chat_id не возвращается клиенту (это внутренняя инфа). На success-экране показывай статический текст «Mas'ul shaxslar 0-48 soat ichida bog'lanishadi» без перечисления имён.

**Response 400 (ошибка валидации):**
```json
{
  "status": "fail",
  "message": "<человекочитаемое сообщение>"
}
```

Примеры сообщений (из Joi + контроллера):
- `"Telefon raqami noto'g'ri formatda"`
- `"Telegram username noto'g'ri"`
- `"Iltimos, ism va familiyangizni to'liq kiriting"`
- `"Возраст должен быть не меньше 14"` / `"Возраст должен быть не больше 60"`
- `"Некорректный филиал или ментор"` (невалидный ObjectId)
- `"Филиал не найден"` / `"Ментор не найден"` (ID-шник не существует в БД)
- `"Этот ментор не работает в выбранном филиале"`

**Response 409 (дубликат):**
```json
{
  "error": "Sizda faol arizangiz mavjud. Iltimos, keyingi haftagacha kutib turing.",
  "existingStatus": "pending"
}
```

Дедуп срабатывает если за **последние 7 дней** была заявка с тем же `phone` ИЛИ `telegramUsername`, и её статус — один из активных (`pending`, `contacted`, `interview_scheduled`). Если предыдущая заявка `rejected`/`accepted`/`no_show`/`duplicate` — дедуп не сработает, можно подать новую.

В `existingStatus` приходит статус заблокировавшей заявки — можно использовать чтобы дать юзеру более точный месседж («Сизнинг аризангиз кўриб чиқилмоқда», «Сиз билан боғландик», etc.), но не обязательно.

⚠️ Поле `retryAvailableAt` (про которое было в брифе) — **не возвращается** сервером. Если хочешь показать дату «когда можно повторить» — посчитай на клиенте `existing.createdAt + 7 дней`, но `createdAt` тоже не приходит. Проще показывать статический текст. Если нужна точная дата возврата — попроси нас расширить ответ.

**Response 429 (rate-limit):**
```json
{
  "error": "Слишком много заявок с этого IP. Попробуйте через час."
}
```

**Response 500 (внутренняя ошибка):** редко, обычно если упала база. Показывай "Server xatoligi, qaytadan urinib ko'ring".

---

## 4. Полный пример клиента

`src/lib/api.js`:

```js
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("VITE_API_URL не задан");
}

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // некоторые ответы могут не иметь тела
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const getFormData = () => request("/applications/form-data");

export const submitApplication = (payload) =>
  request("/applications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
```

Использование в компоненте:

```js
import { getFormData, submitApplication } from "./lib/api";

// Загрузка
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const data = await getFormData();
      if (cancelled) return;
      setBranches(data.branches);
      setSpheres(data.spheres);
      setShifts(data.shifts);
    } catch (err) {
      setFetchFailed(true);
    } finally {
      setIsLoading(false);
    }
  })();
  return () => { cancelled = true; };
}, []);

// Сабмит
const handleSubmit = async () => {
  try {
    const { id, status } = await submitApplication({
      fullName: formData.fullName.trim(),
      phone: formData.phone,
      telegramUsername: formData.username.startsWith("@")
        ? formData.username
        : `@${formData.username}`,
      age: parseInt(formData.age, 10),
      branchId: formData.branchId,
      mentorId: formData.mentorId,
      sphere: formData.sphere,
      shift: formData.shift,
    });

    setIsSubmitted(true);
    toast.success("Muvaffaqiyatli ro'yxatdan o'tdingiz!");
  } catch (err) {
    if (err.status === 409) {
      toast.error(err.data?.error || "Sizda faol arizangiz mavjud.");
    } else if (err.status === 429) {
      toast.error(err.data?.error || "Слишком много попыток. Попробуйте позже.");
    } else if (err.status === 400) {
      toast.error(err.data?.message || "Проверьте введённые данные.");
    } else {
      toast.error("Tarmoq xatoligi. Iltimos qaytadan urinib ko'ring.");
    }
  }
};
```

---

## 5. Тестирование через curl / Postman

Бэк уже разворачивает CORS для запросов без `Origin` header — curl и Postman desktop работают без преград.

### Получить form-data:
```bash
curl -s https://<host>/api/applications/form-data | jq
```

### Отправить заявку:
```bash
curl -X POST https://<host>/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Smoke Test",
    "phone": "+998-90-000-00-01",
    "telegramUsername": "@smoke_test_001",
    "age": 18,
    "branchId": "<вставь из form-data>",
    "mentorId": "<вставь из form-data>",
    "sphere": "frontend-react",
    "shift": "morning"
  }'
```

Ожидаемый ответ: `201` с `{id, status:"pending"}`. После этого:
- Заявка появится в админке Mars (`/applications` у админа).
- Если на сервере выставлен `TELEGRAM_BOT_TOKEN` и заполнены роутинг + chat IDs — на Telegram прилетит уведомление.

### Проверить дедуп:
Отправь ту же заявку второй раз с тем же `phone` или `username` в течение часа → должно вернуться `409`.

### Проверить rate-limit:
Отправь 6 заявок подряд с разными данными за час → 6-я должна вернуть `429`.

---

## 6. Поля и значения — справочник

### Sphere → label (как показывать юзеру)
| value | label |
|---|---|
| `backend-nodejs` | Backend Node |
| `backend-python` | Backend Python |
| `frontend-react` | Frontend React |
| `frontend-vue` | Frontend Vue |
| `mern-stack` | React + Python |
| `full-stack` | React + Node |

⚠️ Названия `mern-stack` ↔ "React + Python" и `full-stack` ↔ "React + Node" — это исторические маппинги. Не пытайся их «исправить» в коде — это сломает Telegram-сообщения и аналитику. Используй то, что приходит из `form-data.spheres`.

### Shift → label
| value | label |
|---|---|
| `morning` | 1-smena (Ertalabki) |
| `evening` | 2-smena (Kechki) |

### Status (lifecycle для admin-flow, internUp его не использует)
| value | смысл |
|---|---|
| `pending` | свежая заявка, никто ещё не работал |
| `contacted` | админ дозвонился, разговор был |
| `interview_scheduled` | назначен оффлайн-интервью |
| `no_show` | не пришёл на интервью |
| `accepted` | принят, обычно сразу за этим — конвертация в `Intern` |
| `rejected` | отказ (с `rejectionReason`) |
| `duplicate` | помечен как дубль вручную |

---

## 7. Что осталось админу (НЕ интерну)

Это **не относится к internUp**, но даёт понять полный pipeline:

1. Заявка падает с 201 → попадает в `pending`.
2. Админ в Mars (`internship-admin`) видит её в `/applications`.
3. Переводит по статусам через `PATCH /api/applications/:id/status` (с авторизацией).
4. При `accepted` — `POST /api/applications/:id/convert` создаёт реального `Intern` с username/паролем. Пароль показывается один раз — админ передаёт стажёру.
5. Telegram-уведомление: автоматом после `POST /applications` (твоего). Если не дошло — админ может ретрайнуть через `POST /api/applications/:id/retry-notify`.

internUp всё это игнорирует — твоя задача только корректно сабмитить.

---

## 8. Контакт

Если что-то непонятно или нашёл несостыковку — Абубакир. Не пытайся «починить» на стороне бэка через PR в `int-server` — спецификация согласована с архитектором.

Если бэкенд возвращает странный 500 — сделай скриншот ответа и request body, скинь. Логи на сервере покажут больше.
