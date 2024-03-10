const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connection established");
  })
  .catch(() => {
    console.log("Error in connection");
  });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: {
    type: String,
    required: true,
    validate: {
      validator: function (value) {
        // Password should contain at least one letter, one number, and one special character
        const regex =
          /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        return regex.test(value);
      },
      message: (props) =>
        `${props.value} is not a valid password. It should contain at least one letter, one number, and one special character.`,
    },
  },
  role: {
    type: String,
    enum: ["user", "admin", "superadmin"],
    default: "user",
  },
  isActive: { type: Boolean, default: true },
  profilePic: { type: String },
});

const collection = mongoose.model("UserCollection", userSchema);

module.exports = collection;
