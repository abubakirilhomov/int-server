import express from "express";
import { createRule, getRules } from "../controllers/rulesController.js";
const auth = require('../middleware/auth.js');
const isAdmin = require('../middleware/isAdmin.js');
const router = express.Router();
router.use(auth)

router.post("/", auth, isAdmin,createRule);

router.get("/", auth, getRules);

export default router;
