require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cronService = require("./services/cronService");

// Init Cron Jobs
cronService.init();

const app = express();
const connectDB = require("./config/database");
const internRoutes = require("./routes/internRoutes");
const branchRoutes = require("./routes/branchRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const lessonsRoutes = require("./routes/lessonRoutes");
const rulesRoutes = require("./routes/rulesRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes")
const notificationRoutes = require("./routes/notificationRoutes");
const AppError = require("./utils/AppError");
const globalErrorHandler = require("./controllers/errorController");
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://mentors-rho.vercel.app",
      "https://interns-lovat.vercel.app",
      "https://internship-admin-zeta.vercel.app",
      "https://www.interns-mars.uz",
      "https://interns-mars.uz",
      "https://mentors-mars.uz",
      "https://interns-admin.uz",
      "https://www.interns-admin.uz",
    ],
  })
);

app.use("/api/interns", internRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/rules", rulesRoutes);
app.use("/api/violations", require("./routes/violationRoutes"));
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.all(/(.*)/, (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

connectDB();

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});