import Rule from "../models/rulesModel.js";

export const createRule = async (req, res) => {
  try {
    const { category, title, example, consequence } = req.body;

    const rule = new Rule({ category, title, example, consequence });
    await rule.save();

    res.status(201).json({ message: "Правило добавлено", rule });
  } catch (err) {
    res.status(500).json({ message: "Ошибка при добавлении правила", error: err.message });
  }
};

export const getRules = async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category) {
      filter.category = category;
    }

    const rules = await Rule.find(filter).sort({ createdAt: -1 });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ message: "Ошибка при получении правил", error: err.message });
  }
};
