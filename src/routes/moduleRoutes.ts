import express from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as ModuleController from "../controllers/ModuleController";

const routes = express.Router();

routes.get("/modules", isAuth, ModuleController.index);
routes.get("/modules/available", isAuth, ModuleController.available);
routes.post("/modules", isAuth, isSuper, ModuleController.store);
routes.put("/modules/:id", isAuth, isSuper, ModuleController.update);
routes.delete("/modules/:id", isAuth, isSuper, ModuleController.destroy);

export default routes;
