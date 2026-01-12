import { Router } from "express";
import multer from "multer";

import isAuth from "../middleware/isAuth";
import * as UserController from "../controllers/UserController";
import uploadUserAvatarConfig from "../config/uploadUserAvatar";

const userRoutes = Router();
const upload = multer(uploadUserAvatarConfig);

userRoutes.get("/users", isAuth, UserController.index);

userRoutes.get("/users/list", isAuth, UserController.list);

userRoutes.post("/users", isAuth, UserController.store);

userRoutes.put("/users/:userId", isAuth, UserController.update);

userRoutes.get("/users/:userId", isAuth, UserController.show);

userRoutes.delete("/users/:userId", isAuth, UserController.remove);

userRoutes.post("/users/set-language/:newLanguage", isAuth, UserController.setLanguage);

userRoutes.post("/users/:userId/avatar", isAuth, upload.single("avatar"), UserController.uploadAvatar);

export default userRoutes;
