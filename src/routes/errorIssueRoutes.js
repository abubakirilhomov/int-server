const express = require("express");
const router = express.Router();

const issueCtrl = require("../controllers/errorIssueController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

// Разбор ошибок показывает стеки, тела запросов и действия пользователей —
// доступ только админу, как у /api/audit-logs.
router.use(auth);
router.use(isAdmin);

// ВАЖНО: /stats до /:id, иначе Express примет "stats" за идентификатор.
router.get("/stats", issueCtrl.getStats);

router.get("/", issueCtrl.getIssues);
router.get("/:id", issueCtrl.getIssue);
router.get("/:id/context", issueCtrl.getIssueContext);
router.patch("/:id", issueCtrl.updateIssue);

module.exports = router;
