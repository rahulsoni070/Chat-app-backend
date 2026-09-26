const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "4h" });

const readCredentials = (body) => ({
  username: typeof body?.username === "string" ? body.username.trim() : "",
  password: typeof body?.password === "string" ? body.password : "",
});

router.post("/register", async (req, res) => {
  const { username, password } = readCredentials(req.body);
  try {
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required." });
    }

    if (username.length < 3 || username.length > 30) {
      return res
        .status(400)
        .json({ message: "Username must be 3 to 30 characters." });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User already exists. Please Login." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({ username: username, password: hashedPassword });
    await user.save();

    const token = signToken(user);
    res
      .status(201)
      .json({ message: "User registered successfully", token, username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = readCredentials(req.body);
  try {
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required." });
    }

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ message: "Invalid username or password." });

    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch)
      return res.status(401).json({ message: "Invalid username or password." });

    const token = signToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      username: user.username,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error while login." });
  }
});

// Lets the client check that a stored token is still valid.
router.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

module.exports = router;
