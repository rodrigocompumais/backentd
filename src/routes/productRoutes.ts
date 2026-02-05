import express from "express";
import isAuth from "../middleware/isAuth";

import * as ProductController from "../controllers/ProductController";

const routes = express.Router();

routes.get("/products", isAuth, ProductController.index);
routes.post("/products", isAuth, ProductController.store);
routes.get("/products/:id", isAuth, ProductController.show);
routes.put("/products/:id", isAuth, ProductController.update);
routes.delete("/products/:id", isAuth, ProductController.destroy);

// Public route for menu products (no auth required)
routes.get("/public/forms/:formSlug/products", ProductController.getPublicMenuProducts);

export default routes;
