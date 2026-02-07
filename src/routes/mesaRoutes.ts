import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as MesaController from "../controllers/MesaController";

const routes = express.Router();
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/mesas", isAuth, requireLanchonetes, MesaController.index);
routes.post("/mesas", isAuth, requireLanchonetes, MesaController.store);
routes.post("/mesas/bulk", isAuth, requireLanchonetes, MesaController.storeBulk);
routes.get("/mesas/:id", isAuth, requireLanchonetes, MesaController.show);
routes.put("/mesas/:id", isAuth, requireLanchonetes, MesaController.update);
routes.put("/mesas/:id/ocupar", isAuth, requireLanchonetes, MesaController.ocupar);
routes.put("/mesas/:id/liberar", isAuth, requireLanchonetes, MesaController.liberar);
routes.delete("/mesas/:id", isAuth, requireLanchonetes, MesaController.destroy);

// Public route (no auth) - for menu form dropdown
routes.get("/public/forms/:formSlug/mesas", MesaController.getPublicMesas);

export default routes;
