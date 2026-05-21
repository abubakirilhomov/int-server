# Mars int-server — API справочник для `internship-admin`

Документация всех эндпоинтов `int-server`, которые использует или может использовать админ-панель. Базовый URL: `${VITE_API_URL}` (включает `/api`, например `https://int-server-host/api`).

Все эндпоинты ниже — REST/JSON, кодировка UTF-8. CORS на бэке настроен пускать `localhost:*` (любой порт), запросы без `Origin` (curl, Postman desktop) и whitelisted прод-домены.

---

## 1. Авторизация

### 1.1. POST `/mentors/login` — логин админа

Админ — это **ментор с `role: "admin"`**. Отдельной таблицы admin'ов нет, отдельного эндпоинта тоже. Логинишься так же как любой ментор.

**Request:**
```http
POST /api/mentors/login
Content-Type: application/json
```
```json
{
  "name": "Abubakir",
  "lastName": "Ilhomov",
  "password": "your-password"
}
```

⚠️ Ключевая особенность — **три поля: `name`, `lastName`, `password`**. Это не `username` / `email`. Если ментор с таким именем-фамилией не существует или пароль неправильный — `401`.

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "65f100...",
    "name": "Abubakir",
    "lastName": "Ilhomov",
    "role": "admin",
    "branchIds": ["65f200..."],
    "branchId": "65f200...",
    "branches": [{ "_id": "65f200...", "name": "Сергели" }],
    "profilePhoto": ""
  }
}
```

**Параллельно бэкенд:**
- Записывает `refresh_mentor` httpOnly cookie с refresh-токеном (TTL 30 дней, `Secure; SameSite=None; Path=/api/mentors/refresh-token`).
- В `token` живёт `jti` для server-side revocation (через `RevokedToken` коллекцию).

**Использование `token`:**

Все защищённые запросы:
```http
GET /api/interns
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Access-токен — **15 минут** TTL. Когда возвращается `401` с `TokenExpiredError` — нужно вызвать refresh (см. ниже).

**Response 401 (неверные креды):**
```json
{ "status": "fail", "message": "Invalid credentials" }
```

---

### 1.2. POST `/mentors/refresh-token` — обновить access-токен

**Request:**
```http
POST /api/mentors/refresh-token
Cookie: refresh_mentor=eyJ...  (отправляется автоматически если используешь fetch с credentials:'include')
```

Тело можно пустое — refresh-токен лежит в cookie. Для backwards-compat можно прислать `{ "refreshToken": "..." }` в body — fallback из старой версии.

**Response 200:**
```json
{
  "token": "<новый access>",
  "user": { ... }
}
```

⚠️ При запросе **обязательно `credentials: "include"`** на стороне fetch — иначе cookie не уйдёт:
```js
fetch(`${API_URL}/mentors/refresh-token`, {
  method: "POST",
  credentials: "include",
});
```

И тогда на CORS-стороне нужно чтобы Origin был в whitelist (`*` не работает с `credentials: true`).

---

### 1.3. POST `/mentors/logout` — логаут

**Request:**
```http
POST /api/mentors/logout
Authorization: Bearer <access>
```

**Эффект:**
- Стирает `refresh_mentor` cookie.
- Заносит `jti` access-токена + refresh-токена в `RevokedToken` коллекцию (TTL-индекс автоматически вычистит после истечения).

После этого даже если access-токен ещё валиден по времени — `authMiddleware` отдаст 401, потому что проверяет blacklist.

---

### 1.4. PATCH `/mentors/me/password` — сменить свой пароль

```http
PATCH /api/mentors/me/password
Authorization: Bearer <access>
```
```json
{
  "currentPassword": "old",
  "newPassword": "new"
}
```

---

## 2. Интерны (`/interns`)

Все требуют `Authorization: Bearer <access>` (если не сказано иначе).

| Method | Path | Гард | Назначение |
|---|---|---|---|
| GET | `/interns` | auth | Список всех интернов (админ видит всё, ментор — своих) |
| GET | `/interns/me` | auth | Профиль текущего интерна (только для интернов) |
| GET | `/interns/:id` | auth | Профиль одного интерна |
| GET | `/interns/rating` | auth | Рейтинг интернов |
| GET | `/interns/client-rating` | auth | Рейтинг для клиент-приложения |
| GET | `/interns/pending-interns` | auth | Интерны, ожидающие оценки (ментор) |
| GET | `/interns/branch-manager/interns` | auth | Интерны филиала (BM) |
| GET | `/interns/frozen` | auth + admin | Замороженные |
| GET | `/interns/archived` | auth + admin | Архивные |
| GET | `/interns/survey-stats` | auth + admin | Статистика опроса участников (маркетинг) |
| POST | `/interns` | auth + admin | Создать интерна |
| POST | `/interns/login` | публичный | Логин интерна |
| POST | `/interns/refresh-token` | публичный (cookie) | Refresh интерна |
| POST | `/interns/logout` | auth | Логаут интерна |
| POST | `/interns/:id/rate` | auth | Оценить интерна (ментор) |
| POST | `/interns/:id/lessons` | auth | Отметить визит на урок (ментор) |
| POST | `/interns/:id/reset-password` | auth + admin | Сброс пароля |
| POST | `/interns/:id/warnings` | auth + isHeadIntern | Предупреждение от head-интерна |
| POST | `/interns/:id/complaints` | auth | Жалоба от BM |
| POST | `/interns/me/survey` | auth | Сабмит опроса участника |
| PATCH | `/interns/me/profile` | auth | Свой профиль |
| PATCH | `/interns/me/password` | auth | Свой пароль |
| PATCH | `/interns/:id/upgrade` | auth + admin | Повышение грейда |
| PATCH | `/interns/:id/bonus-lessons` | auth + admin | Бонус-уроки |
| PATCH | `/interns/:id/head-intern` | auth + admin | Назначить head-интерном |
| PATCH | `/interns/:id/activation` | auth + admin | Manual activation toggle |
| PATCH | `/interns/:id/freeze` | auth + admin | Заморозить |
| PATCH | `/interns/:id/unfreeze` | auth + admin | Разморозить |
| PATCH | `/interns/:id/archive` | auth + admin | Архивировать |
| PATCH | `/interns/:id/unarchive` | auth + admin | Разархивировать |
| PUT | `/interns/:id` | auth + admin | Полное обновление |
| DELETE | `/interns/:id` | auth + admin | Удалить |
| GET | `/interns/me/badges` | auth | Свои бейджи |

### Создание интерна (POST `/interns`)

```json
{
  "name": "Имя",
  "lastName": "Фамилия",
  "username": "uniq_handle",
  "password": "...",
  "sphere": "frontend-react",
  "grade": "junior",
  "branch": "65f200...",
  "mentor": "65f300..."
}
```

Сфера — одна из `backend-nodejs|backend-python|frontend-react|frontend-vue|mern-stack|full-stack`. Грейд — один из `junior|strongJunior|middle|strongMiddle|senior` (camelCase!). `lessonsPerMonth` и `probationPeriod` подставятся автоматом из `grades.js`.

### Повышение грейда (PATCH `/interns/:id/upgrade`)
```json
{
  "newGrade": "strongJunior",
  "withConcession": false,
  "note": "Опционально"
}
```

### Бонус-уроки (PATCH `/interns/:id/bonus-lessons`)
```json
{
  "count": 5,
  "reason": "compensation",
  "notes": "Компенсация за заморозку"
}
```

### Manual activation (PATCH `/interns/:id/activation`)
```json
{
  "isEnabled": true,
  "note": "Особый случай"
}
```

### Freeze (PATCH `/interns/:id/freeze`)
```json
{
  "expectedReturn": "2026-06-01",
  "reason": "sick",
  "note": "Опционально"
}
```

### Archive (PATCH `/interns/:id/archive`)
```json
{
  "reason": "graduated",
  "note": "Опционально",
  "becameTutor": false,
  "tutorMentorId": null,
  "finalGrade": "middle"
}
```

---

## 3. Менторы (`/mentors`)

| Method | Path | Гард | Назначение |
|---|---|---|---|
| POST | `/mentors/login` | публичный | Логин |
| POST | `/mentors/refresh-token` | публичный (cookie) | Refresh |
| POST | `/mentors/logout` | auth | Логаут |
| PATCH | `/mentors/me/password` | auth | Свой пароль |
| GET | `/mentors` | auth | Список менторов (админу также возвращается `telegramChatId`) |
| GET | `/mentors/:id/stats` | auth | Статистика ментора |
| GET | `/mentors/debt/all` | auth + admin | Все менторы с долгом по урокам |
| GET | `/mentors/:id/debt-details` | auth + admin | Детали долга ментора |
| GET | `/mentors/with-activity` | auth + admin | Менторы + активность |
| GET | `/mentors/:id/interns-activity` | auth + admin | Активность интернов ментора |
| POST | `/mentors` | auth + admin | Создать ментора |
| PUT | `/mentors/:id` | auth + admin | Обновить |
| DELETE | `/mentors/:id` | auth + admin | Удалить |
| POST | `/mentors/:id/reset-password` | auth + admin | Сброс пароля |

### Создание ментора (POST `/mentors`)
```json
{
  "name": "Имя",
  "lastName": "Фамилия",
  "password": "...",
  "role": "mentor",
  "branches": ["65f200..."],
  "profilePhoto": "https://...",
  "telegramChatId": "1844909205"
}
```

`role`: `mentor` | `admin` | `branchManager`. `telegramChatId` нужен только для `branchManager` (по нему уходят уведомления о заявках в их филиал).

---

## 4. Филиалы (`/branches`)

| Method | Path | Гард | Назначение |
|---|---|---|---|
| GET | `/branches` | auth | Список филиалов |
| POST | `/branches` | auth + admin | Создать |
| PUT | `/branches/:id` | auth + admin | Обновить |
| DELETE | `/branches/:id` | auth + admin | Удалить |

### POST `/branches`
```json
{
  "name": "Ойбек",
  "address": "Tashkent, ...",
  "latitude": 41.30137,
  "longitude": 69.276045,
  "branchManager": "65f300..."
}
```

`branchManager` — `ObjectId` ментора с `role: "branchManager"`. По нему резолвится `telegramChatId` для уведомлений о заявках в этот филиал.

---

## 5. Уроки (`/lessons`)

Все требуют auth.

| Method | Path | Гард | Назначение |
|---|---|---|---|
| GET | `/lessons` | auth | Список (со скоупом по пользователю) |
| GET | `/lessons/:id` | auth | Один урок (IDOR-проверка: только участники или admin) |
| GET | `/lessons/attendance-stats` | auth | Статистика посещений (фильтры period/branch) |
| GET | `/lessons/pending` | auth | Pending уроки для текущего ментора |
| GET | `/lessons/pending-feedback` | auth | Уроки, ожидающие фидбек от интерна |
| GET | `/lessons/stuck-feedbacks` | auth + admin | Зависшие фидбеки (>48ч) |
| POST | `/lessons` | auth | Создать урок (интерн) |
| PATCH | `/lessons/rate` | auth | Оценить урок (ментор) |
| PATCH | `/lessons/:id/intern-feedback` | auth | Сабмит фидбека от интерна |
| POST | `/lessons/:id/force-feedback` | auth + admin | Принудительно закрыть фидбек |
| PUT | `/lessons/:id` | auth + admin | Обновить урок |
| DELETE | `/lessons/:id` | auth + admin | Удалить |

### Создание урока (POST `/lessons`)
```json
{
  "intern": "65f100...",
  "topic": "React Hooks",
  "time": "14:00",
  "group": "FR-12",
  "date": "2026-05-19"
}
```

`mentor` подставляется из `req.user`. Если интерн ещё не сдал фидбек по предыдущему уроку (<48ч) — `409`.

### Оценка урока (PATCH `/lessons/rate`)
```json
{
  "lessonId": "65f400...",
  "stars": 5,
  "feedback": "🔥",
  "comment": "Отличная работа"
}
```

`stars`: 1-5. `feedback`: один из `🔥`, `👍`, `😐`, `👎`.

### Sumbit фидбека интерна (PATCH `/lessons/:id/intern-feedback`)
```json
{
  "criteria": [
    { "criteriaId": "65f500...", "score": 4 }
  ],
  "comment": "Все понятно"
}
```

---

## 6. Заявки на стажировку (`/applications`)

Отдельная документация — см. `internUp-api-docs.md`. Краткий список admin-эндпоинтов:

| Method | Path | Гард | Назначение |
|---|---|---|---|
| GET | `/applications/form-data` | публичный, rate-limit 30/min | Данные для формы (filiallar, mentorlar, sphere, shift) |
| POST | `/applications` | публичный, rate-limit 5/h | Создать заявку (internUp шлёт сюда) |
| GET | `/applications` | auth + admin | Список с фильтрами |
| GET | `/applications/:id` | auth + admin | Одна заявка |
| PATCH | `/applications/:id/status` | auth + admin | Сменить статус |
| POST | `/applications/:id/convert` | auth + admin | Конвертировать в `Intern` |
| POST | `/applications/:id/retry-notify` | auth + admin | Перепослать Telegram-уведомление |

### Фильтры GET `/applications`
Query params:
- `status` — один или несколько (`pending,contacted,...`)
- `branch` — `ObjectId`
- `from`, `to` — ISO date
- `q` — поиск по имени/телефону/username
- `page`, `limit` — пагинация (`limit` default 50)

### PATCH `/applications/:id/status`
```json
{
  "status": "interview_scheduled",
  "interviewDate": "2026-05-22T15:00:00.000Z",
  "notes": "Назначен на четверг"
}
```

При `status: "rejected"` — `rejectionReason` обязательно.

### POST `/applications/:id/convert`
```json
{
  "username": "ali_valiyev",
  "tempPassword": "Generated123",
  "grade": "junior",
  "sphere": "frontend-react"
}
```

Создаёт `Intern`, помечает заявку как `accepted` и записывает ссылку на интерна. `tempPassword` показывается админу один раз.

---

## 7. Правила и нарушения

### Правила (`/rules`)
| Method | Path | Гард |
|---|---|---|
| GET | `/rules` | auth |
| POST | `/rules` | auth + admin |
| DELETE | `/rules/:id` | auth + admin |

Создание правила:
```json
{
  "title": "Опоздание",
  "category": "yellow",
  "grade": "junior",
  "penalty": 1
}
```

`category`: `green` | `yellow` | `red` | `black`. `grade`: какому грейду применяется.

### Нарушения (`/violations`)
| Method | Path | Гард |
|---|---|---|
| GET | `/violations` | auth + admin |

Возвращает агрегированный список нарушений по всем интернам (для отчётности).

---

## 8. Уведомления (`/notifications`)

| Method | Path | Гард |
|---|---|---|
| POST | `/notifications/subscribe` | публичный ⚠️ |
| POST | `/notifications/test` | публичный ⚠️ |
| DELETE | `/notifications/clear` | публичный ⚠️ |

⚠️ Сейчас все эти эндпоинты **без auth** — известный недочёт (нужно закрыть). Сабскрайбает web-push подписку для текущего пользователя.

### POST `/notifications/subscribe`
```json
{
  "subscription": {
    "endpoint": "https://...",
    "keys": { "p256dh": "...", "auth": "..." }
  },
  "userId": "65f100...",
  "role": "intern"
}
```

---

## 9. Дашборд (`/dashboard`)

| Method | Path | Гард |
|---|---|---|
| GET | `/dashboard/stats` | auth |
| GET | `/dashboard/analytics` | auth + admin |

Query params для `analytics`: `from`, `to`, `branch`.

---

## 10. Настройки (`/settings`)

| Method | Path | Гард |
|---|---|---|
| GET | `/settings` | auth |
| PUT | `/settings` | auth + admin |

Используется для `Setting("applicationRouting")` (роутинг Telegram-уведомлений по сферам) и других глобальных конфигов.

---

## 11. Grade config (`/grade-config`)

| Method | Path | Гард |
|---|---|---|
| GET | `/grade-config` | auth | Конфиги всех грейдов |
| PUT | `/grade-config/:grade` | auth + admin | Обновить (lessonsPerMonth, trialPeriod) |

```json
PUT /grade-config/junior
{ "lessonsPerMonth": 24, "trialPeriod": 1 }
```

---

## 12. Lesson criteria (`/lesson-criteria`)

| Method | Path | Гард |
|---|---|---|
| GET | `/lesson-criteria` | публичный | Список критериев для модалки фидбека |
| POST | `/lesson-criteria` | auth + admin | Создать |
| PATCH | `/lesson-criteria/:id` | auth + admin | Обновить |
| DELETE | `/lesson-criteria/:id` | auth + admin | Удалить |

---

## 13. Локации (`/locations`)

| Method | Path | Гард |
|---|---|---|
| POST | `/locations/update` | auth | Обновить свою локацию (интерн) |
| DELETE | `/locations/stop` | auth | Перестать делиться |
| GET | `/locations/my-interns` | auth | Локации интернов ментора |

---

## 14. Загрузки (`/uploads`)

| Method | Path | Гард |
|---|---|---|
| POST | `/uploads/image` | auth | Загрузить картинку в Cloudinary |

Содержимое — `multipart/form-data` с полем `file`. Ответ: `{ url, public_id }`.

---

## 15. Mars ID SSO (`/auth/marsid`)

OIDC flow с `id.marshub.uz`.

| Method | Path | Гард |
|---|---|---|
| GET | `/auth/marsid/status` | публичный | Проверить интеграцию |
| GET | `/auth/marsid/start` | публичный | Начало OIDC-flow (редирект на id.marshub.uz) |
| GET | `/auth/marsid/callback` | публичный | Callback от id.marshub.uz |
| POST | `/auth/marsid/link` | публичный (но требует код+креды) | Привязка Mars ID к Mentor/Intern по логину+паролю |
| POST | `/auth/marsid/unlink` | auth + admin | Отвязать |

Для админки `internship-admin` сейчас включена кнопка "Войти через Mars ID" для админов.

---

## 16. Curl-примеры (полный flow)

### Логин
```bash
TOKEN=$(curl -sX POST https://<host>/api/mentors/login \
  -H "Content-Type: application/json" \
  -d '{"name":"Abubakir","lastName":"Ilhomov","password":"..."}' \
  | jq -r .token)
echo "$TOKEN"
```

### Список интернов
```bash
curl -s https://<host>/api/interns \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Создание интерна
```bash
curl -sX POST https://<host>/api/interns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test",
    "lastName":"Testov",
    "username":"test_user",
    "password":"pass123",
    "sphere":"frontend-react",
    "grade":"junior",
    "branch":"<branch_id>",
    "mentor":"<mentor_id>"
  }' | jq
```

### Список заявок
```bash
curl -s "https://<host>/api/applications?status=pending&page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Конвертация заявки в интерна
```bash
curl -sX POST "https://<host>/api/applications/<app_id>/convert" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"new_intern",
    "tempPassword":"Temp123",
    "grade":"junior",
    "sphere":"frontend-react"
  }' | jq
```

---

## 17. Ошибки — общий формат

Все 4xx/5xx ошибки возвращаются через `globalErrorHandler`:

```json
{
  "status": "fail",      // или "error" для 5xx
  "message": "...",      // человекочитаемое сообщение
  "stack": "..."         // только в dev mode
}
```

Особые коды:
- `401` — нет токена / истёк / в blacklist.
- `403` — токен есть, но не админ (`Требуется роль администратора`).
- `409` — конфликт (дубликат заявки, занятый username, и т.д.).
- `429` — rate-limit (на login и публичных эндпоинтах).

### Mongoose-ошибки
Бэк нормализует:
- `CastError` (невалидный `ObjectId`) → 400.
- `ValidationError` (Joi/Mongoose) → 400 с понятным сообщением.
- `E11000` (duplicate key) → 409.
- `JsonWebTokenError` / `TokenExpiredError` → 401.

Mongo-shape наружу не утекает.

---

## 18. Известные нюансы

1. **Логин по имени-фамилии, не username** — менторы и интерны логинятся разными эндпоинтами. Менторы: `name+lastName+password`. Интерны: `username+password`. Часто путают.
2. **JWT TTL 15 минут** — нужно реализовать refresh-flow. Cookie `refresh_mentor` (для менторов) / `refresh_intern` (для интернов) — `Path` scoped к `/api/.../refresh-token`. Без `credentials:'include'` cookie не уйдёт.
3. **CORS + credentials**: `Access-Control-Allow-Origin: *` несовместим с `credentials: true`. Origin должен быть в whitelist.
4. **Grade keys — camelCase**: `strongJunior`, `strongMiddle`. НЕ `strong-junior`.
5. **`lessonStatus`**: используй `status === "confirmed"`. Все уроки в БД смигрированы 2026-03-17, дуальный fallback не нужен.
6. **`branchIds` в JWT**: для multi-branch менторов JWT хранит массив. `req.user.branchIds` — авторитетный список доступных филиалов. Активный филиал — через `x-active-branch-id` header (валидируется в `middleware/resolveActiveBranch.js`).

---

## 19. Куда копать в коде

| Что | Файл |
|---|---|
| Routes mounting | `int-server/src/index.js:120-134` |
| Auth middleware | `int-server/src/middleware/auth.js` |
| isAdmin middleware | `int-server/src/middleware/isAdmin.js` |
| Login mentor | `int-server/src/controllers/mentorController.js:122` |
| Login intern | `int-server/src/controllers/internController.js` (`loginIntern`) |
| Refresh | `mentorController.refreshMentorToken`, `internController.refreshToken` |
| Error handler | `int-server/src/controllers/errorController.js` |
| Models | `int-server/src/models/` |
| Validations (Joi) | `int-server/src/validations/` |

Если нужно поведение которого нет в этой доке — посмотри контроллер, он почти всегда `catchAsync` обёрнут, читается линейно.
