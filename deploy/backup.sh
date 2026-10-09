#!/bin/sh
# Резервная копия базы раз в сутки в папку ./backups на сервере.
# Копии старше BACKUP_KEEP_DAYS дней удаляются.
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"
echo "[backup] запущено, храним копии $KEEP дней"
sleep 60
while true; do
  TS=$(date +%Y-%m-%d_%H%M)
  FILE="/backups/lupin_$TS.dump"
  if pg_dump -h db -U lupin -d lupin -Fc -f "$FILE.tmp"; then
    mv "$FILE.tmp" "$FILE"
    echo "[backup] готово: $FILE ($(du -h "$FILE" | cut -f1))"
  else
    rm -f "$FILE.tmp"
    echo "[backup] ОШИБКА: копия не создана"
  fi
  find /backups -name 'lupin_*.dump' -mtime +"$KEEP" -delete
  sleep 86400
done
