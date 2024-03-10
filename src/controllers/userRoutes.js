const express = require("express");
const userController = require("../controllers/userController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.use(authMiddleware.authenticateUser);
router.get("/profile", userController.getUserProfile);
router.put("/update-profile", userController.updateUserProfile);

module.exports = router;
