const express = require("express");
const router = express.Router();

const auditCtrl = require("../controllers/auditLogController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

// Журнал показывает, кто что делал по всей системе — доступ только админу.
router.use(auth);
router.use(isAdmin);

router.get("/", auditCtrl.getAuditLogs);
router.get("/stats", auditCtrl.getAuditStats);

module.exports = router;
