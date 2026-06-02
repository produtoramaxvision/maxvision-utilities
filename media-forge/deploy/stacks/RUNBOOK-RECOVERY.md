# Runbook: Recovery de Banco de Dados (mcp-postgres)

## Verificar backups disponíveis

```bash
# No host da VPS ou no container de backup
docker exec $(docker ps -qf name=mcp-postgres-backup) ls -lh /backups/
# Formato esperado: media_forge-YYYYMMDD-HHMMSS.sql.gz (ou .dump se POSTGRES_EXTRA_OPTS=-Fc)
```

## Restore no mcp-postgres (cenário: DB corrompido ou migração errada)

```bash
# 1. Parar o mcp-server para evitar writes durante restore
docker service scale media-forge-mcp_mcp-server=0

# 2. Copiar o arquivo de backup do container para o host
docker cp $(docker ps -qf name=mcp-postgres-backup):/backups/media_forge-YYYYMMDD-HHMMSS.sql.gz /tmp/mf-restore.sql.gz

# 3. Dropar e recriar o DB (conectar no container mcp-postgres)
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -c "DROP DATABASE IF EXISTS media_forge;"
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -c "CREATE DATABASE media_forge;"

# 4. Restaurar (formato .sql.gz — plain SQL dump)
gunzip -c /tmp/mf-restore.sql.gz | docker exec -i $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge

# 4b. Se o formato for pg_dump custom (-Fc), usar pg_restore em vez de psql:
# gunzip -c /tmp/mf-restore.sql.gz > /tmp/mf-restore.dump
# docker exec -i $(docker ps -qf name=mcp-postgres) pg_restore -U media_forge -d media_forge < /tmp/mf-restore.dump

# 5. Restore drill: verificar contagem de linhas
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge \
  -c "SELECT COUNT(*) FROM generations;"
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge \
  -c "SELECT COUNT(*) FROM tenants;"

# 6. Re-aplicar migrations que possam estar faltando após restore de backup anterior à migration
# (apenas se o backup era anterior à 002_generations.sql)
# docker exec -i $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge \
#   < media-forge/migrations/002_generations.sql

# 7. Restartar o service
docker service scale media-forge-mcp_mcp-server=1
```

## Verificar integridade pos-restore

```bash
# checar generation_id UNIQUE e índices
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge \
  -c "\d generations"

# checar tenants e keys ativas
docker exec -it $(docker ps -qf name=mcp-postgres) psql -U media_forge -d media_forge \
  -c "SELECT tier, COUNT(*) FROM tenants GROUP BY tier;"
```

## Confirmar formato do backup (IMPORTANTE antes de primeiro restore)

```bash
# Verificar POSTGRES_EXTRA_OPTS do container de backup
docker inspect $(docker ps -qf name=mcp-postgres-backup) | grep -A5 POSTGRES_EXTRA_OPTS
# Se ausente = formato padrão plain SQL (gunzip | psql)
# Se -Fc = formato custom (pg_restore)
```

## Alerta de backup falho

O container `mcp-postgres-backup` expõe `HEALTHCHECK_PORT=8080`.
Configurar no Portainer/Prometheus:
- Alert: `container_health_status{name=~".*backup.*"} != 1` por mais de 2h.
- Verificar logs: `docker service logs media-forge-mcp_mcp-postgres-backup`
