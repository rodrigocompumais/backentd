import express from "express";
import isAuth from "../middleware/isAuth";
import isCompanyOne from "../middleware/isCompanyOne";

import * as HelpArticleController from "../controllers/HelpArticleController";

const routes = express.Router();

// Rotas públicas (todas empresas podem ver)
routes.get("/help-articles", isAuth, HelpArticleController.index);
routes.get("/help-articles/:id", isAuth, HelpArticleController.show);

// Rotas protegidas (apenas empresa 1)
routes.post("/help-articles", isAuth, isCompanyOne, HelpArticleController.store);
routes.put("/help-articles/:id", isAuth, isCompanyOne, HelpArticleController.update);
routes.delete("/help-articles/:id", isAuth, isCompanyOne, HelpArticleController.remove);

export default routes;
