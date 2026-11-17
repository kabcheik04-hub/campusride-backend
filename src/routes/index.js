import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { bookingRoutes } from './bookings.js';
import { notificationRoutes } from './notifications.js';
import { reportRoutes } from './reports.js';
import { reviewRoutes } from './reviews.js';
import { tripRoutes } from './trips.js';

const healthRoute = {
  method: 'GET',
  path: '/api/health',
  handler: () => ({ body: { status: 'ok' } }),
};

export const routes = [healthRoute, ...authRoutes, ...tripRoutes, ...bookingRoutes, ...reviewRoutes, ...reportRoutes, ...notificationRoutes, ...adminRoutes];
