# TwirChat production deployment

Follow the [backend deployment guide](../docs/releasing.md#deploy-the-backend) for environment
setup, upgrades, backups, and rollback. Run production commands from the repository root;
[root `docker-compose.yml`](../docker-compose.yml) defines the stack.

[`docker/docker-compose.yml`](docker-compose.yml) remains a compatibility include. The stack
runs the backend and PostgreSQL, not a reverse proxy. [`Caddyfile.prod`](Caddyfile.prod) is a
standalone example; set its domain and upstream for your own proxy deployment.
