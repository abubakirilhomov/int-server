const Branch = require('../models/branchModel');

exports.createBranch = async (req, res) => {
  const branch = await Branch.create(req.body);
  res.json(branch);
};

exports.getBranches = async (req, res) => {
  const branches = await Branch.find();
  res.json(branches);
};

exports.deleteBranch = async (req, res) => {
  await Branch.findByIdAndDelete(req.params.id);
  res.sendStatus(204);
};
