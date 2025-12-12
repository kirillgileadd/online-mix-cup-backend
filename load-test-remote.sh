#!/bin/bash

# Скрипт для нагрузочного тестирования удаленного сервера
# Использование: ./load-test-remote.sh [URL] [MODE] [PORT]
# MODE: direct (прямое подключение), cloudflare (через Cloudflare), local (локально на сервере)
#
# Примеры:
#   ./load-test-remote.sh api.example.com direct 8000
#   ./load-test-remote.sh api.example.com cloudflare
#   ./load-test-remote.sh localhost local 8000

# Параметры
URL="${1:-api.example.com}"
MODE="${2:-direct}"  # direct, cloudflare, local
PORT="${3:-8000}"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="load_test_results_remote_${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Тестирование удаленного сервера${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "URL: $URL"
echo "Режим: $MODE"
echo ""

# Определяем BASE_URL в зависимости от режима
case $MODE in
    "direct")
        # Прямое подключение (минуя Cloudflare)
        BASE_URL="http://${URL}:${PORT}"
        echo -e "${YELLOW}⚠️  Режим: Прямое подключение (минуя Cloudflare)${NC}"
        ;;
    "cloudflare")
        # Через Cloudflare (обычно HTTPS, порт не нужен)
        if [[ "$URL" == *"://"* ]]; then
            BASE_URL="$URL"
        else
            BASE_URL="https://${URL}"
        fi
        echo -e "${YELLOW}⚠️  Режим: Через Cloudflare (может быть ограничено)${NC}"
        ;;
    "local")
        # Локально на сервере
        BASE_URL="http://localhost:${PORT}"
        echo -e "${YELLOW}⚠️  Режим: Локальное тестирование на сервере${NC}"
        ;;
    *)
        echo -e "${RED}Неизвестный режим: $MODE${NC}"
        echo "Используйте: direct, cloudflare, или local"
        exit 1
        ;;
esac

echo "BASE_URL: $BASE_URL"
echo ""

# Проверка поддержки SSL в Apache Bench
check_ssl_support() {
    if ab -V 2>&1 | grep -q "SSL not compiled"; then
        return 1
    fi
    # Пробуем простой HTTPS тест
    if echo | ab -n 1 -c 1 https://www.google.com/ 2>&1 | grep -q "SSL not compiled"; then
        return 1
    fi
    return 0
}

# Если используется HTTPS и SSL не поддерживается
if [[ "$BASE_URL" == https://* ]]; then
    if ! check_ssl_support > /dev/null 2>&1; then
        echo -e "${RED}❌ ОШИБКА: Apache Bench не поддерживает SSL/HTTPS${NC}"
        echo ""
        echo -e "${YELLOW}Решения:${NC}"
        echo "1. Используйте HTTP вместо HTTPS для тестирования:"
        echo "   ./load-test-remote.sh $URL direct 8000"
        echo ""
        echo "2. Или укажите HTTP URL явно:"
        echo "   ./load-test-remote.sh http://$URL direct 8000"
        echo ""
        echo "3. Для тестирования через Cloudflare с HTTPS используйте:"
        echo "   - Установите Apache Bench с поддержкой SSL"
        echo "   - Или используйте альтернативные инструменты (wrk, k6, curl)"
        echo ""
        echo "4. Если нужен HTTPS, попробуйте использовать curl для тестирования:"
        echo "   curl -w '@-' -o /dev/null -s '$BASE_URL/users' << 'EOF'"
        echo "      time_namelookup:  %{time_namelookup}\n"
        echo "      time_connect:  %{time_connect}\n"
        echo "      time_total:  %{time_total}\n"
        echo "EOF"
        exit 1
    fi
fi

# Проверка доступности сервера
echo "Проверка доступности сервера..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users" --max-time 10 2>/dev/null)

if [ "$HTTP_CODE" = "000" ] || [ -z "$HTTP_CODE" ]; then
    echo -e "${RED}❌ Сервер недоступен${NC}"
    echo "Проверьте URL и доступность сервера"
    echo "Попробуйте вручную: curl $BASE_URL/users"
    exit 1
fi

echo -e "${GREEN}✅ Сервер доступен (HTTP код: $HTTP_CODE)${NC}"
echo ""

# Функция для запуска теста
run_remote_test() {
    local endpoint=$1
    local name=$2
    local requests=$3
    local concurrency=$4
    local description=$5
    
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}Тест: $name${NC}"
    echo -e "${YELLOW}Описание: $description${NC}"
    echo -e "${YELLOW}Эндпоинт: $endpoint${NC}"
    echo -e "${YELLOW}Запросов: $requests${NC}"
    echo -e "${YELLOW}Параллельных соединений: $concurrency${NC}"
    echo -e "${YELLOW}========================================${NC}"
    
    local output_file="$RESULTS_DIR/${name}.txt"
    local tsv_file="$RESULTS_DIR/${name}.tsv"
    local url="${BASE_URL}${endpoint}"
    
    # Запускаем тест с разными параметрами в зависимости от режима
    if [ "$MODE" = "cloudflare" ]; then
        # Для Cloudflare добавляем заголовки и используем keep-alive
        # Проверяем, что это не HTTPS (если SSL не поддерживается)
        if [[ "$url" == https://* ]]; then
            if ! check_ssl_support > /dev/null 2>&1; then
                echo -e "${RED}❌ ОШИБКА: HTTPS не поддерживается в Apache Bench${NC}"
                echo "Используйте режим 'direct' с HTTP или установите Apache Bench с SSL"
                return 1
            fi
        fi
        ab -n $requests \
           -c $concurrency \
           -g "$tsv_file" \
           -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
           -H "Accept: application/json" \
           -H "Accept-Language: en-US,en;q=0.9" \
           -k \
           -q \
           "$url" > "$output_file" 2>&1
    else
        # Прямое подключение - обычный тест
        ab -n $requests \
           -c $concurrency \
           -g "$tsv_file" \
           -k \
           -q \
           "$url" > "$output_file" 2>&1
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Тест завершен успешно${NC}"
        
        # Извлекаем ключевые метрики
        if [ -f "$output_file" ]; then
            local rps=$(grep "Requests per second" "$output_file" 2>/dev/null | awk '{print $4}')
            local failed=$(grep "Failed requests" "$output_file" 2>/dev/null | awk '{print $3}')
            local mean_time=$(grep "Time per request" "$output_file" 2>/dev/null | head -1 | awk '{print $4}')
            local max_time=$(grep -A 10 "Connection Times" "$output_file" 2>/dev/null | grep "Total" | awk '{print $NF}')
            
            if [ -n "$rps" ]; then
                echo "   Requests per second: $rps"
            fi
            if [ -n "$failed" ]; then
                echo "   Неудачных запросов: $failed"
            fi
            if [ -n "$mean_time" ]; then
                echo "   Среднее время ответа: ${mean_time} ms"
            fi
            if [ -n "$max_time" ]; then
                echo "   Максимальное время ответа: ${max_time} ms"
            fi
        fi
    else
        echo -e "${RED}❌ Ошибка при выполнении теста${NC}"
        echo "Проверьте файл: $output_file"
    fi
    
    echo ""
    sleep 2  # Небольшая пауза между тестами
}

# Настройки теста в зависимости от режима
if [ "$MODE" = "cloudflare" ]; then
    # Для Cloudflare - более консервативные настройки
    echo -e "${YELLOW}⚠️  Используются консервативные настройки для Cloudflare${NC}"
    echo "   (Cloudflare может ограничивать нагрузочные тесты)"
    echo ""
    
    # Тест 1: Низкая нагрузка
    run_remote_test "/users" \
                    "test1_low_load" \
                    200 \
                    5 \
                    "Низкая нагрузка - безопасно для Cloudflare"
    
    # Тест 2: Средняя нагрузка
    run_remote_test "/users" \
                    "test2_medium_load" \
                    500 \
                    10 \
                    "Средняя нагрузка - может быть ограничено Cloudflare"
    
else
    # Для прямого подключения - полный набор тестов
    echo "Начинаем полное тестирование..."
    echo ""
    
    # Тест 1: Низкая нагрузка
    run_remote_test "/users" \
                    "test1_low_load" \
                    200 \
                    10 \
                    "Низкая нагрузка - базовая проверка"
    
    # Тест 2: Средняя нагрузка
    run_remote_test "/users" \
                    "test2_medium_load" \
                    500 \
                    20 \
                    "Средняя нагрузка"
    
    # Тест 3: Высокая нагрузка
    run_remote_test "/users" \
                    "test3_high_load" \
                    1000 \
                    50 \
                    "Высокая нагрузка"
    
    # Тест других эндпоинтов
    run_remote_test "/applications" \
                    "test_applications" \
                    500 \
                    20 \
                    "Тест эндпоинта /applications"
    
    run_remote_test "/tournaments" \
                    "test_tournaments" \
                    500 \
                    20 \
                    "Тест эндпоинта /tournaments"
fi

# Формирование сводного отчета
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Формирование сводного отчета${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

SUMMARY_FILE="$RESULTS_DIR/SUMMARY.txt"

cat > "$SUMMARY_FILE" << EOF
========================================
  СВОДНЫЙ ОТЧЕТ УДАЛЕННОГО ТЕСТИРОВАНИЯ
========================================

Дата и время: $(date)
URL: $URL
Режим: $MODE
BASE_URL: $BASE_URL
Директория с результатами: $RESULTS_DIR

========================================
РЕЗУЛЬТАТЫ ТЕСТОВ
========================================

EOF

# Добавляем результаты каждого теста в сводку
for result_file in "$RESULTS_DIR"/test*.txt; do
    if [ -f "$result_file" ]; then
        test_name=$(basename "$result_file" .txt)
        echo "" >> "$SUMMARY_FILE"
        echo "--- $test_name ---" >> "$SUMMARY_FILE"
        echo "" >> "$SUMMARY_FILE"
        
        grep "Requests per second" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Failed requests" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Complete requests" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Time per request" "$result_file" | head -1 >> "$SUMMARY_FILE" 2>/dev/null
        grep "Total transferred" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
    fi
done

cat >> "$SUMMARY_FILE" << EOF

========================================
ВАЖНЫЕ ЗАМЕЧАНИЯ
========================================

EOF

if [ "$MODE" = "cloudflare" ]; then
    cat >> "$SUMMARY_FILE" << EOF
⚠️  ВАЖНО: Тестирование через Cloudflare
- Результаты могут быть ограничены защитой Cloudflare
- Время ответа включает задержку Cloudflare (+50-200ms)
- Cloudflare может кэшировать GET запросы
- Для точного тестирования используйте режим "direct"

Для получения точных результатов рекомендую:
1. Использовать прямое подключение (режим "direct")
2. Или тестировать локально на сервере (режим "local")
3. Создать поддомен без Cloudflare для тестирования

EOF
else
    cat >> "$SUMMARY_FILE" << EOF
✅ Прямое подключение к серверу
- Результаты отражают реальную производительность
- Время ответа не включает задержку Cloudflare

EOF
fi

cat >> "$SUMMARY_FILE" << EOF
========================================
EOF

echo -e "${GREEN}✅ Сводный отчет сохранен: $SUMMARY_FILE${NC}"
echo ""

# Показываем краткую сводку
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  КРАТКАЯ СВОДКА${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

for result_file in "$RESULTS_DIR"/test*.txt; do
    if [ -f "$result_file" ]; then
        test_name=$(basename "$result_file" .txt)
        echo -e "${YELLOW}$test_name:${NC}"
        grep "Requests per second" "$result_file" 2>/dev/null | sed 's/^/  /'
        grep "Failed requests" "$result_file" 2>/dev/null | sed 's/^/  /'
        echo ""
    fi
done

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Тестирование завершено!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Все результаты сохранены в: $RESULTS_DIR"
echo ""
echo "Файлы:"
echo "  - SUMMARY.txt - сводный отчет"
echo "  - test*.txt - детальные результаты каждого теста"
echo "  - test*.tsv - данные для построения графиков"
echo ""

