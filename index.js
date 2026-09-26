const dotenv = require("dotenv");
dotenv.config();

const mongoose = require("mongoose");
const { createServer } = require("./app");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set. Refusing to start without it.");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Mongodb connected."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const { server } = createServer();

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
