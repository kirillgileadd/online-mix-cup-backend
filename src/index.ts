import { env } from "./config/env";
import { buildServer } from "./app";

const app = buildServer();

app
  .listen({
    port: env.PORT,
    host: "0.0.0.0",
  })
  .then(() => {
    app.log.info(`Server listening on port ${env.PORT}`);
  })
  .catch((error) => {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  });

