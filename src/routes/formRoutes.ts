import express from "express";
import isAuth from "../middleware/isAuth";

import * as FormController from "../controllers/FormController";
import * as FormResponseController from "../controllers/FormResponseController";
import * as AppointmentController from "../controllers/AppointmentController";

const routes = express.Router();

// Orders - centralized Kanban (all cardapio forms)
routes.get("/orders", isAuth, FormResponseController.listAllOrders);
routes.get("/orders/unconfirmed-counts", isAuth, FormResponseController.unconfirmedOrderCounts);

// Authenticated routes - Forms management
routes.get("/forms", isAuth, FormController.index);
routes.post("/forms", isAuth, FormController.store);
routes.post("/forms/import", isAuth, FormController.importForm);
routes.get("/forms/:id", isAuth, FormController.show);
routes.put("/forms/:id", isAuth, FormController.update);
routes.delete("/forms/:id", isAuth, FormController.destroy);
routes.post("/forms/:id/duplicate", isAuth, FormController.duplicate);
routes.get("/forms/:id/stats", isAuth, FormController.getStats);
routes.get("/forms/:id/export", isAuth, FormController.exportForm);

// Responses management
routes.get("/forms/:formId/responses", isAuth, FormResponseController.index);
routes.get("/forms/:formId/orders", isAuth, FormResponseController.listOrders);
routes.get("/forms/:formId/responses/:id", isAuth, FormResponseController.show);
routes.delete("/forms/:formId/responses/:id", isAuth, FormResponseController.destroy);
routes.put("/forms/:formId/responses/:id/read", isAuth, FormResponseController.markAsRead);
routes.put("/forms/:formId/responses/:id/star", isAuth, FormResponseController.toggleStar);
routes.put("/forms/:formId/responses/:id/order-status", isAuth, FormResponseController.updateOrderStatus);
routes.get("/forms/:formId/analytics", isAuth, FormResponseController.getAnalytics);
routes.get("/forms/:formId/export", isAuth, FormResponseController.exportData);

// Public routes (no auth)
routes.get("/public/forms/:slug/appointment-services", AppointmentController.getPublicAppointmentServices);
routes.get("/public/forms/:slug/availability", AppointmentController.getAvailability);
routes.get("/public/forms/:slug/appointments/by-token", AppointmentController.getByToken);
routes.get("/public/forms/:slug/appointments/ical", AppointmentController.getIcalByToken);
routes.put("/public/forms/:slug/appointments/cancel", AppointmentController.cancelByToken);
routes.put("/public/forms/:slug/appointments/reschedule", AppointmentController.rescheduleByToken);
routes.post("/public/forms/:slug/waitlist", AppointmentController.addToWaitlist);
routes.get("/public/forms/:slug", FormController.getPublicForm);
routes.post("/public/forms/:slug/submit", FormResponseController.store);

export default routes;
