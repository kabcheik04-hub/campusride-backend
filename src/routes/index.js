import { authRoutes } from './auth.js';
import { bookingRoutes } from './bookings.js';
import { reviewRoutes } from './reviews.js';
import { tripRoutes } from './trips.js';

const healthRoute = {
  method: 'GET',
  path: '/api/health',
  handler: () => ({ body: { status: 'ok' } }),
};

export const routes = [healthRoute, ...authRoutes, ...tripRoutes, ...bookingRoutes, ...reviewRoutes];
