#!/bin/bash

# Альтернативный скрипт для тестирования через curl (работает с HTTPS)
# Использование: ./load-test-http.sh [URL] [REQUESTS] [CONCURRENCY]
#
# Примеры:
#   ./load-test-http.sh http://api.example.com/users 1000 20
#   ./load-test-http.sh https://api.example.com/users 500 10

URL="${1:-http://localhost:8000/users}"
TOTAL_REQUESTS="${2:-1000}"
CONCURRENCY="${3:-20}"

# Цвета
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="load_test_results_curl_${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Тестирование через curl (поддерживает HTTPS)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "URL: $URL"
echo "Всего запросов: $TOTAL_REQUESTS"
echo "Параллельных: $CONCURRENCY"
echo ""

# Проверка доступности
echo "Проверка доступности сервера..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" --max-time 10 2>/dev/null)

if [ "$HTTP_CODE" = "000" ] || [ -z "$HTTP_CODE" ]; then
    echo -e "${RED}❌ Сервер недоступен${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Сервер доступен (HTTP код: $HTTP_CODE)${NC}"
echo ""

# Функция для выполнения одного запроса
perform_request() {
    local url=$1
    curl -w "%{time_total},%{time_namelookup},%{time_connect},%{http_code}\n" \
         -o /dev/null \
         -s \
         "$url"
}

# Создаем файл для результатов
RESULTS_FILE="$RESULTS_DIR/results.csv"
echo "time_total,time_namelookup,time_connect,http_code" > "$RESULTS_FILE"

echo "Начинаем тестирование..."
echo ""

# Вычисляем количество запросов на каждый параллельный процесс
REQUESTS_PER_PROCESS=$((TOTAL_REQUESTS / CONCURRENCY))

# Запускаем параллельные процессы
START_TIME=$(date +%s.%N)

for ((i=1; i<=CONCURRENCY; i++)); do
    (
        for ((j=1; j<=REQUESTS_PER_PROCESS; j++)); do
            perform_request "$URL" >> "$RESULTS_FILE"
        done
    ) &
done

# Ждем завершения всех процессов
wait

END_TIME=$(date +%s.%N)
DURATION=$(echo "$END_TIME - $START_TIME" | bc)

# Анализ результатов
echo "Анализ результатов..."
echo ""

# Подсчитываем успешные запросы
SUCCESS_COUNT=$(grep -c "^[0-9]\+\.[0-9]\+,.*,200$" "$RESULTS_FILE" 2>/dev/null || echo "0")
FAILED_COUNT=$((TOTAL_REQUESTS - SUCCESS_COUNT))

# Вычисляем среднее время
AVG_TIME=$(awk -F',' '{sum+=$1; count++} END {if(count>0) print sum/count; else print 0}' "$RESULTS_FILE")
MAX_TIME=$(awk -F',' '{if($1>max) max=$1} END {print max}' "$RESULTS_FILE")
MIN_TIME=$(awk -F',' 'NR==1{min=$1} {if($1<min) min=$1} END {print min}' "$RESULTS_FILE")

# Вычисляем RPS
RPS=$(echo "scale=2; $TOTAL_REQUESTS / $DURATION" | bc)

# Выводим результаты
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  РЕЗУЛЬТАТЫ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Всего запросов: $TOTAL_REQUESTS"
echo "Успешных: $SUCCESS_COUNT"
echo "Неудачных: $FAILED_COUNT"
echo "Время выполнения: $(echo "scale=2; $DURATION" | bc) секунд"
echo ""
echo "Requests per second: $RPS"
echo "Среднее время ответа: $(echo "scale=2; $AVG_TIME * 1000" | bc) ms"
echo "Минимальное время: $(echo "scale=2; $MIN_TIME * 1000" | bc) ms"
echo "Максимальное время: $(echo "scale=2; $MAX_TIME * 1000" | bc) ms"
echo ""

# Сохраняем сводку
SUMMARY_FILE="$RESULTS_DIR/SUMMARY.txt"
cat > "$SUMMARY_FILE" << EOF
========================================
  СВОДНЫЙ ОТЧЕТ (curl)
========================================

URL: $URL
Всего запросов: $TOTAL_REQUESTS
Параллельных: $CONCURRENCY
Время выполнения: $(echo "scale=2; $DURATION" | bc) секунд

Результаты:
- Успешных: $SUCCESS_COUNT
- Неудачных: $FAILED_COUNT
- Requests per second: $RPS
- Среднее время ответа: $(echo "scale=2; $AVG_TIME * 1000" | bc) ms
- Минимальное время: $(echo "scale=2; $MIN_TIME * 1000" | bc) ms
- Максимальное время: $(echo "scale=2; $MAX_TIME * 1000" | bc) ms

========================================
EOF

echo "Результаты сохранены в: $RESULTS_DIR"
echo ""
