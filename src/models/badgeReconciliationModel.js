const mongoose = require("mongoose");

// Посуточная сверка жёлтых бейджиков на ресепшене филиала (оформляется при
// закрытии дня администратором). Отвечает на требование "должен быть расчёт":
//   stock            — сколько всего бейджиков у филиала (Branch.badgeStock на момент сверки),
//   openAtClose      — сколько заёмов остались НЕзакрытыми (интерны не сдали) на момент закрытия,
//   expectedInDrawer — сколько должно лежать в ящике = stock − openAtClose,
//   countedInDrawer  — сколько администратор реально насчитал в ящике,
//   discrepancy      — countedInDrawer − expectedInDrawer (отрицательное → бейджики пропали).
// discrepancy ≠ 0 или openAtClose > 0 → сигнал (кто не сдал / где потерялось),
// с полной привязкой ко времени и филиалу.
const badgeReconciliationSchema = new mongoose.Schema({
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true,
    index: true,
  },
  date: { type: Date, default: Date.now, index: true },
  stock: { type: Number, required: true },
  openAtClose: { type: Number, default: 0 },
  expectedInDrawer: { type: Number, required: true },
  countedInDrawer: { type: Number, required: true },
  discrepancy: { type: Number, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
  byName: { type: String, trim: true, default: "" },
  note: { type: String, trim: true, default: "" },
});

badgeReconciliationSchema.index({ branch: 1, date: -1 });

module.exports = mongoose.model("BadgeReconciliation", badgeReconciliationSchema);
