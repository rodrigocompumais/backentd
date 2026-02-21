import express from "express";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import { importRateLimit } from "../middleware/rateLimiter";

import * as ContactListController from "../controllers/ContactListController";
import multer from "multer";

const routes = express.Router();

const upload = multer(uploadConfig);

routes.get("/contact-lists/list", isAuth, ContactListController.findList);

routes.get("/contact-lists", isAuth, ContactListController.index);

routes.get("/contact-lists/:id", isAuth, ContactListController.show);

routes.post("/contact-lists", isAuth, ContactListController.store);

// Aplicar rate limit na rota de upload de contatos
routes.post(
  "/contact-lists/:id/upload",
  isAuth,
  importRateLimit,
  upload.array("file"),
  ContactListController.upload
);

routes.put("/contact-lists/:id", isAuth, ContactListController.update);

routes.delete("/contact-lists/:id", isAuth, ContactListController.remove);

export default routes;
