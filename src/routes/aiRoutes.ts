import express from "express";
import isAuth from "../middleware/isAuth";
import * as AiSummaryController from "../controllers/AiSummaryController";

const routes = express.Router();

routes.post("/ai/summary/agent", isAuth, AiSummaryController.agentSummary);

export default routes;


