const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const path = require("path");
const hbs = require("hbs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");

// const cloudinary = require("./src/utils/cloudinary");
// const upload = require("./src/utils/multer");

const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const OAuth2 = google.auth.OAuth2;

const collection = require("./src/models/mongodb");
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    return cb(null, "./uploads");
  },
  filename: function (req, file, cb) {
    return cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

const templatePath = path.join(__dirname, "templates");

app.use(express.json());
app.set("view engine", "hbs");
app.set("views", templatePath);
app.use(express.urlencoded({ extended: false }));
app.use(express.static("uploads"));

app.get("/", (req, res) => {
  res.render("signup");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/signup", (req, res) => {
  res.render("signup");
});

app.get("/logout", (req, res) => {
  res.clearCookie("token"); // Clear the token cookie
  res.redirect("/login");
});

app.get("/forgot-password", (req, res) => {
  console.log("Hit the forgot-password route");
  res.render("forgotpassword");
});

app.get("/user-information", async (req, res) => {
  try {
    const users = await collection.find();

    res.render("success", { users });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/user/update", async (req, res) => {
  try {
    const { id, name, email, role, loggedInUserId } = req.body;

    const loggedInUser = await collection.findOne({ _id: loggedInUserId });
    if (loggedInUser.role === "user") {
      return res.status(403).send("Unauthorized");
    }
    if (loggedInUser.role === "admin" && role === "superadmin") {
      return res.status(403).send("Unauthorized");
    }

    await collection.updateOne(
      {
        _id: id,
      },
      {
        $set: {
          name,
          email,
          role,
        },
      }
    );
    return res.status(200).json({
      message: "User updated successfully",
    });
  } catch (e) {
    console.log(e);
    return res.status(500).send("Internal Server Error");
  }
});

app.post("/signup", upload.single("profilePic"), async (req, res) => {
  const data = {
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    profilePic: req.file.filename,
  };

  try {
    console.log(data);
    await collection.insertMany([data]);
    res.render("login");
  } catch (error) {
    res.send(error);
  }
});

// Login

app.post("/login", async (req, res) => {
  try {
    const user = await collection.findOne({ email: req.body.email });

    if (!user || user.password !== req.body.password) {
      return res.send("Invalid email or password");
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_TOKEN, {
      expiresIn: "1hr",
    });

    res.cookie("token", token, { httpOnly: true });

    let userData;

    if (user.role === "superadmin") {
      userData = await collection.find();
    } else if (user.role === "admin") {
      userData = await collection.find({
        $or: [{ role: "admin" }, { role: "user" }],
      });
    } else {
      userData = await collection.find({ role: "user" });
    }
    console.log(userData);

    // Pass user data and user role to the "success" template
    res.render("success", {
      users: userData,
      loggedUserRole: user.role,
      loggedUserId: user._id,
    });
  } catch (error) {
    console.error(error);
    res.send(error);
  }
});

// Forget Password

const createTransporter = async () => {
  const oauth2Client = new OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN,
  });

  const accessToken = await new Promise((resolve, reject) => {
    oauth2Client.getAccessToken((err, token) => {
      if (err) {
        reject("Failed to create access token :(");
      }
      resolve(token);
    });
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.EMAIL,
      accessToken,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      refreshToken: process.env.REFRESH_TOKEN,
    },
  });

  return transporter;
};

const sendEmail = async (emailOptions) => {
  let emailTransporter = await createTransporter();
  await emailTransporter.sendMail(emailOptions);
};

app.post("/forgot-password", async (req, res) => {
  try {
    const userEmail = req.body.email;
    console.log(`User email submitted: ${userEmail}`);

    const oldUser = await collection.findOne({ email: userEmail });
    if (!oldUser) {
      return res.json({ status: "User Not Exists!!" });
    }

    const secret = process.env.JWT_TOKEN + oldUser.password;
    const token = jwt.sign({ email: oldUser.email, id: oldUser._id }, secret, {
      expiresIn: "1hr",
    });

    // Update the user record with the reset token and its expiration time
    await collection.updateOne(
      { _id: oldUser._id },
      {
        $set: {
          resetToken: token,
          resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      }
    );

    const resetLink = `http://localhost:3000/reset-password/${oldUser._id}/${token}`;

    const mailOptions = {
      from: process.env.EMAIL,
      to: userEmail,
      subject: "Password Reset",
      text: `Click on the following link to reset your password: ${resetLink}`,
    };

    // Send the email using the sendEmail function
    await sendEmail(mailOptions);

    console.log("Password reset email sent successfully");
    res.send("Password reset link has been sent to your email...");
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Reset- password

app.get("/reset-password/:id/:token", async (req, res) => {
  const { id, token } = req.params;
  console.log(req.params);
  const oldUser = await collection.findOne({ _id: id });
  if (!oldUser) {
    return res.json({ status: "User Not Exists!!" });
  }
  const secret = process.env.JWT_TOKEN + oldUser.password;
  try {
    const verify = jwt.verify(token, secret);
    res.render("resetpassword", { email: verify.email, id: id, token: token });
  } catch (error) {
    console.log(error);
    res.send("Not Verified");
  }
});

app.post("/reset-password/:id/:token", async (req, res) => {
  const { id, token } = req.params;
  const { newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword) {
    return res.json({ status: "Passwords do not match" });
  }

  const oldUser = await collection.findOne({ _id: id });
  if (!oldUser) {
    return res.json({ status: "User Not Exists!!" });
  }

  const secret = process.env.JWT_TOKEN + oldUser.password;
  try {
    const verify = jwt.verify(token, secret);
    await collection.updateOne(
      {
        _id: id,
      },
      {
        $set: {
          password: newPassword,
        },
      }
    );
    res.json({ status: "Password Updated" });
    res.render("resetpassword", { email: verify.email, status: "Verified" });
  } catch (error) {
    console.log(error);
    res.json({ status: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
