const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required." });
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

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "4h" });
    res
      .status(201)
      .json({ message: "User registered successfully", token, username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
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

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "4h" });

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

module.exports = router;