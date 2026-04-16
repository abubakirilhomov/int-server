const Branch = require('../models/branchModel');

const pickBranchFields = (body) => {
  const { name, city, address, location, telegramLink, interviews } = body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (city !== undefined) data.city = city;
  if (address !== undefined) data.address = address;
  if (telegramLink !== undefined) data.telegramLink = telegramLink;
  if (interviews !== undefined) data.interviews = interviews;
  if (location !== undefined) {
    if (location === null) {
      data.location = undefined;
    } else {
      const lat = Number(location.lat);
      const lng = Number(location.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        data.location = { lat, lng };
      }
    }
  }
  return data;
};

exports.createBranch = async (req, res) => {
  const branch = await Branch.create(pickBranchFields(req.body));
  res.json(branch);
};

exports.getBranches = async (req, res) => {
  const branches = await Branch.find();
  res.json(branches);
};

exports.updateBranch = async (req, res) => {
  const branch = await Branch.findByIdAndUpdate(
    req.params.id,
    pickBranchFields(req.body),
    { new: true, runValidators: true }
  );
  if (!branch) return res.status(404).json({ message: 'Филиал не найден' });
  res.json(branch);
};

exports.deleteBranch = async (req, res) => {
  await Branch.findByIdAndDelete(req.params.id);
  res.sendStatus(204);
};
