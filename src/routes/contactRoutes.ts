import express from "express";
import isAuth from "../middleware/isAuth";
import { importRateLimit } from "../middleware/rateLimiter";

import * as ContactController from "../controllers/ContactController";
import * as ImportPhoneContactsController from "../controllers/ImportPhoneContactsController";

const contactRoutes = express.Router();

// Aplicar rate limit nas rotas de importação de contatos
contactRoutes.post(
  "/contacts/import",
  isAuth,
  importRateLimit,
  ImportPhoneContactsController.store
);

contactRoutes.get("/contacts", isAuth, ContactController.index);

contactRoutes.get("/contacts/list", isAuth, ContactController.list);

contactRoutes.get("/contacts/:contactId", isAuth, ContactController.show);

contactRoutes.post("/contacts", isAuth, ContactController.store);

// Aplicar rate limit na rota de upload de contatos
contactRoutes.post("/contacts/upload", isAuth, importRateLimit, ContactController.storeUpload);

contactRoutes.put("/contacts/:contactId", isAuth, ContactController.update);

contactRoutes.delete("/contacts/:contactId", isAuth, ContactController.remove);

contactRoutes.put("/contacts/toggleDisableBot/:contactId", isAuth, ContactController.toggleDisableBot);

export default contactRoutes;
