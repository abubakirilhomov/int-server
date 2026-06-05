const Setting = require("../models/settingModel");

const DEFAULTS = {
  lessonLookbackDays: 2,
  // Настройки модуля собеседований (редактируются через PATCH /api/settings).
  interviewSettings: {
    passThreshold: 80, // % правильных для прохождения
    partialCredit: 0.5, // доля балла за «частично»
    cooldownDays: 7, // дней блокировки пересдачи после провала
    reminderTime: "09:00", // время утреннего Telegram-напоминания (Asia/Tashkent)
    reminderChatIds: [], // кому слать напоминание о собесах на сегодня
  },
};

exports.getSettings = async (req, res) => {
  const docs = await Setting.find().lean();
  const settings = { ...DEFAULTS };
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }
  res.json(settings);
};

exports.updateSettings = async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ message: "Тело запроса должно быть объектом" });
  }

  const ops = Object.entries(updates).map(([key, value]) =>
    Setting.findOneAndUpdate(
      { key },
      { key, value },
      { upsert: true, new: true }
    )
  );
  await Promise.all(ops);

  const docs = await Setting.find().lean();
  const settings = { ...DEFAULTS };
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }
  res.json(settings);
};
