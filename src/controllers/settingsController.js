const Setting = require("../models/settingModel");

const DEFAULTS = {
  lessonLookbackDays: 2,
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
