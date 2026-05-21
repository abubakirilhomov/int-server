# internUp — миграция на int-server (бриф)

Этот документ — техническое задание на полный рерайт internUp SPA. Цель — убрать Supabase и подключить лидоформу к основному бэкенду Mars (`int-server`). Бэкенд **уже готов**, ничего на нём писать не нужно — только пользоваться его REST API.

Если ты используешь AI-ассистента (Antigravity / Gemini / Cursor) — скорми ему этот файл целиком как контекст. **Не давай ему придумывать альтернативную архитектуру** — план уже согласован с архитектором, отклонения = переделка.

---

## 1. Контекст системы

`internUp` — это лидоформа: визитная карточка, через которую кандидат заполняет заявку на стажировку. Её цель — собрать данные и **передать в систему Mars**, где админ увидит заявку в админке, проведёт по статусам (`pending → contacted → interview_scheduled → accepted`) и одним нажатием создаст реальный аккаунт стажёра (`Intern`).

Сейчас этого не происходит: заявки идут в Supabase-таблицу `intern_data` через edge function `submit-intern`. Mars-админка их не видит. Это надо исправить.

**Архитектурное правило:** internUp — это тонкий клиент. Вся бизнес-логика (валидация, дедуп, роутинг Telegram-уведомлений, сохранение в БД) живёт на `int-server`. Клиент только собирает форму и отправляет POST.

---

## 2. Что есть на стороне Mars (готовый бэкенд)

Базовый URL: `${VITE_API_URL}` (например `https://int-server-xxxx.up.railway.app/api`).

### `GET /applications/form-data` (публичный, rate-limit 30/мин)

Возвращает данные для построения формы. Кэшируется на 5 минут (`Cache-Control: public, max-age=300`).

**Response:**
```json
{
  "branches": [
    {
      "id": "65f1...",
      "name": "Сергели",
      "mentors": [
        { "id": "65f2...", "name": "Иванов Иван" }
      ]
    }
  ],
  "spheres": [
    { "value": "frontend-react",  "label": "Frontend React" },
    { "value": "backend-nodejs",  "label": "Backend Node.js" },
    { "value": "backend-python",  "label": "Backend Python" },
    { "value": "mern-stack",      "label": "MERN Stack" },
    { "value": "full-stack",      "label": "Full Stack" }
  ],
  "shifts": [
    { "value": "morning", "label": "1-smena (Ertalabki)" },
    { "value": "evening", "label": "2-smena (Kechki)" }
  ]
}
```

Важно:
- `branches[i].id` и `mentors[i].id` — это **MongoDB ObjectId** (24-символьная hex-строка). Храни их в state, не имена.
- `mentors` уже отфильтрованы по филиалу — не нужна отдельная мапа `mentorsData[branch]`. Просто `selectedBranch.mentors`.
- `spheres` и `shifts` пришли с сервера → не хардкодь их в клиенте. Если бизнес добавит новую сферу, фронт подхватит автоматически.

### `POST /applications` (публичный, rate-limit 5/час на IP)

Создаёт заявку.

**Request body:**
```json
{
  "fullName": "Ali Valiyev",
  "phone": "+998-90-123-45-67",
  "telegramUsername": "@username",
  "age": 18,
  "branchId": "65f1...",
  "mentorId": "65f2...",
  "sphere": "frontend-react",
  "shift": "morning"
}
```

**Валидация на бэке (для справки — клиент должен делать то же самое до отправки):**
- `fullName` — минимум 2 слова (имя + фамилия).
- `phone` — строго формат `+998-XX-XXX-XX-XX`, операторский код не `00`.
- `telegramUsername` — `^@[a-zA-Z0-9_]{5,32}$` (с лидирующим `@`).
- `age` — целое, 12 ≤ age ≤ 24.
- `branchId`, `mentorId` — валидные ObjectId. Ментор должен относиться к выбранному филиалу (если нет — 400).
- `sphere` — один из 5 значений выше.
- `shift` — `morning` или `evening`.

**Response статусы:**
- `201` — успех. Тело: `{ application: {...}, responsiblePersons: ["Имя1", "Имя2"] }`. `responsiblePersons` показываешь на success-экране.
- `400` — ошибка валидации. Тело: `{ message: "..." }` — показывай через `toast.error`.
- `409` — дубликат (тот же phone или username за последние 7 дней). Тело включает `retryAvailableAt` (ISO). Показывай: «Сизда фаол аризангиз мавжуд. Қайта топшириш: <дата>».
- `429` — превышен rate-limit. Текст показывай как есть.

---

## 3. Что нужно сделать

### Шаг 1. Чистка

```bash
npm uninstall @supabase/supabase-js
git rm --cached supabase/functions/submit-intern/.env.save
```

Удалить полностью:
- `src/lib/supabase.js`
- Папку `supabase/` целиком (config, functions, sql, .temp/, .env.save, .env.example)

Проверить `.gitignore` — правило `supabase/functions/**/.env.save` стало неактуально, можно убрать. Добавить если нет: `.env`, `.env.local`.

### Шаг 2. Новый клиент API

Создать `src/lib/api.js`:

```js
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("VITE_API_URL не задан. Проверь .env");
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
    // empty body — OK для 204
  }

  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
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

### Шаг 3. Переписать `src/App.jsx`

**State после рефакторинга:**

```js
const [formData, setFormData] = useState({
  fullName: "",
  phone: "",
  username: "",
  age: "",
  branchId: "",   // было: branch (имя). Теперь — ObjectId
  mentorId: "",   // было: mentor (имя). Теперь — ObjectId
  sphere: "",     // было: direction
  shift: "",      // было: time
});

// данные формы с бэка
const [branches, setBranches] = useState([]);     // [{id, name, mentors:[{id,name}]}]
const [spheres, setSpheres] = useState([]);       // [{value, label}]
const [shifts, setShifts] = useState([]);         // [{value, label}]
```

**Загрузка данных:**

```js
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      setIsLoading(true);
      const data = await getFormData();
      if (cancelled) return;
      setBranches(data.branches || []);
      setSpheres(data.spheres || []);
      setShifts(data.shifts || []);
      setFetchFailed(false);
    } catch (err) {
      if (!cancelled) setFetchFailed(true);
    } finally {
      if (!cancelled) setIsLoading(false);
    }
  })();
  return () => { cancelled = true; };
}, []);
```

Retry-логика на 3 попытки — оставить как было, только дёргать `getFormData()`.

**Выбор ментора:**

```js
const selectedBranch = branches.find((b) => b.id === formData.branchId);
const branchMentors  = selectedBranch?.mentors ?? [];

// в JSX вместо mentorsData[formData.branch]:
{branchMentors
  .filter((m) => m.name.toLowerCase().includes(mentorSearch.toLowerCase()))
  .map((m) => (
    <div
      key={m.id}
      className={`option-item ${formData.mentorId === m.id ? "selected" : ""}`}
      onClick={() => {
        setFormData((p) => ({ ...p, mentorId: m.id }));
        setMentorSearch(m.name);
        setShowMentorDropdown(false);
      }}
    >
      {m.name}
    </div>
  ))}
```

При смене филиала — сбрасывать `mentorId`:

```js
const handleBranchSelect = (b) => {
  setFormData((p) => ({ ...p, branchId: b.id, mentorId: "" }));
  setMentorSearch("");
  setShowBranchDropdown(false);
};
```

Для отображения выбранного имени филиала/ментора в trigger-е используй `branches.find(b => b.id === formData.branchId)?.name`.

**Сферы и смены:**

```js
{spheres.map((s) => (
  <div
    key={s.value}
    className={`option-item ${formData.sphere === s.value ? "selected" : ""}`}
    onClick={() => {
      setFormData((p) => ({ ...p, sphere: s.value }));
      setShowDirectionDropdown(false);
    }}
  >
    {s.label}
  </div>
))}
```

Отображать выбранную сферу как `spheres.find(s => s.value === formData.sphere)?.label`. То же самое для shifts.

**Сабмит:**

```js
const handleSubmit = async (e) => {
  e.preventDefault();
  if (!validateAllSteps()) return;

  try {
    setIsSubmitting(true);

    const payload = {
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
    };

    const response = await submitApplication(payload);

    setResponsiblePersons(response.responsiblePersons ?? []);
    setIsSubmitted(true);
    toast.success("Muvaffaqiyatli ro'yxatdan o'tdingiz!");
  } catch (err) {
    if (err.status === 409 && err.data?.retryAvailableAt) {
      const d = new Date(err.data.retryAvailableAt);
      toast.error(`Sizda faol arizangiz mavjud. Qayta topshirish: ${d.toLocaleDateString("uz-UZ")} kunigacha.`);
    } else if (err.status === 429) {
      toast.error("Juda ko'p urinish. Iltimos, 1 daqiqa kuting.");
    } else {
      toast.error(err.message || "Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.");
    }
  } finally {
    setIsSubmitting(false);
  }
};
```

**Валидация:** оставить функции `validateStep` / `validateAllSteps` как есть, только заменить проверки `formData.branch && formData.mentor && formData.direction && formData.time` на `formData.branchId && formData.mentorId && formData.sphere && formData.shift`.

### Шаг 4. `.env.example`

```
VITE_API_URL=https://your-railway-host.up.railway.app/api
```

Всё. Никаких Supabase ключей. Никаких токенов. Любая попытка положить туда secret = немедленный revoke.

### Шаг 5. Vercel

В Vercel Dashboard → Project Settings → Environment Variables:
- Удалить `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Добавить `VITE_API_URL` с продовым URL int-server (узнать у Абубакира).

CORS на бэке уже разрешает `https://internup-zeta.vercel.app`. Если поменяется домен — сказать Абубакиру, добавит в whitelist.

---

## 4. Критерии приёмки (что должно работать)

- [ ] `npm ls @supabase/supabase-js` → не находит пакет.
- [ ] Папка `supabase/` отсутствует.
- [ ] В исходниках нет упоминаний `supabase`, `VITE_SUPABASE_*`, `SUPABASE_*`, `service_role`, токенов вида `xxx:AAFc...`.
- [ ] Открываешь форму → филиалы/менторы/сферы/смены подгружаются с `int-server`.
- [ ] Сабмит валидной заявки → 201, success-экран показывает ответственных.
- [ ] Сабмит того же phone/username второй раз за неделю → toast «Сизда фаол аризангиз мавжуд» с датой.
- [ ] Заявка появляется в админке Mars (`/applications`) у Абубакира с правильным филиалом/ментором/сферой.
- [ ] BM выбранного филиала получает Telegram-уведомление (после того как админ заполнит `Mentor.telegramChatId`).

---

## 5. Безопасность — урок из коммита `9596df6 update full`

В этом коммите оказался файл `supabase/functions/submit-intern/.env.save` с **рабочим** Telegram bot-токеном (`8796169760:AAFc4qq...`) и chat-ID. Файл закоммичен **до** того, как ты добавил правило в `.gitignore`. Это значит:

1. **`.gitignore` НЕ удаляет уже отслеживаемые файлы.** Правило работает только для новых. Если файл уже в индексе, нужен `git rm --cached <file>` + commit.
2. **Токен теперь в публичной истории git навсегда.** Даже если удалить файл сейчас, токен останется в коммите `9596df6`. Force-push с переписыванием истории — больно и не очищает форки/клоны/GitHub-кэш.
3. **Единственный надёжный fix — отозвать секрет.** BotFather → `/revoke` → создать новый токен. Это уже в процессе у Абубакира.

**Привычки на будущее:**
- Перед каждым `git add .` смотреть `git status` — глазами проверять список файлов.
- Никаких `.env`, `.env.save`, `.env.local`, `*.key`, `*.pem` в коммитах. Никогда.
- Секреты — только в Vercel env / Railway env / Supabase function env, через UI или CLI с флагом `--secret`. Не в файлах под `git add`.
- Если случайно закоммитил — **немедленно** сказать команде и отозвать секрет. Не пытайся «переписать историю и сделать вид что не было». GitHub индексирует за минуты.

---

## 6. Что НЕ нужно делать (антипаттерны)

- ❌ Не оставляй Supabase «на всякий случай» / «как fallback». Уноси полностью.
- ❌ Не хардкодь chat_id Нуриддина и Абубакира в клиенте. Роутинг живёт на бэке (`Setting("applicationRouting")` + `Branch.branchManager.telegramChatId`).
- ❌ Не пиши свой `submit-intern` edge function. Бэкенд `int-server/src/controllers/applicationController.js` уже делает всё то же самое + интегрирован с админкой.
- ❌ Не добавляй `VITE_TELEGRAM_BOT_TOKEN` или любые токены в клиентский bundle. Telegram-вызовы делает бэкенд.
- ❌ Не вводи никаких новых таблиц / коллекций. Заявки = модель `Application` на int-server, и точка.

---

## 7. Готово?

Когда всё сделано — открой PR в `github.com/abduraxim-01/internUp` против `main`, в описании напиши:
- что убрано (`@supabase/supabase-js`, edge function, RLS, .env.save),
- что добавлено (`src/lib/api.js`, новый payload-shape),
- ссылка на этот бриф.

Абубакир сделает ревью + smoke-test на проде. После мержа — Vercel задеплоит автоматом.

Удачи!
