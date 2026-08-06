/**
 * Entrypoint do processo de worker.
 *
 * Roda fora do Next: `npm run worker`. Precisa da condição `react-server` para
 * o marcador `server-only` virar no-op fora do bundler.
 */
import { principal } from "./server/worker";

void principal();
