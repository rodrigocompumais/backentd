import { Router } from "express";
import * as SessionController from "../controllers/SessionController";
import * as UserController from "../controllers/UserController";
import isAuth from "../middleware/isAuth";
import envTokenAuth from "../middleware/envTokenAuth";
import { authRateLimit } from "../middleware/rateLimiter";

const authRoutes = Router();

// Aplicar rate limit restritivo nas rotas de autenticação (proteção contra brute force)
authRoutes.post("/signup", authRateLimit, envTokenAuth, UserController.store);
authRoutes.post("/login", authRateLimit, SessionController.store);
authRoutes.post("/refresh_token", SessionController.update);
authRoutes.delete("/logout", isAuth, SessionController.remove);
authRoutes.get("/me", isAuth, SessionController.me);

export default authRoutes;
