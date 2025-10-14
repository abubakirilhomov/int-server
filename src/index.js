require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const app = express();
const connectDB = require("./config/database");
const internRoutes = require("./routes/internRoutes");
const branchRoutes = require("./routes/branchRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const lessonsRoutes = require("./routes/lessonRoutes");
const rulesRoutes = require("./routes/rulesRoutes");

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
app.use("/api/branches", branchRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/rules", rulesRoutes);

connectDB();

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
