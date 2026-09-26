const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Resolves a JWT to its user (without the password hash).
// Returns null when the token is missing, invalid, expired or the user no longer exists.
async function userFromToken(token) {
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  return User.findById(payload.id).select("-password");
}

// Express middleware: requires an "Authorization: Bearer <token>" header.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  try {
    const user = scheme === "Bearer" ? await userFromToken(token) : null;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = { userFromToken, requireAuth };
