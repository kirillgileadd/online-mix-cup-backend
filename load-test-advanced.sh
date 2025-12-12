#!/bin/bash

# Расширенный скрипт нагрузочного тестирования с разными уровнями нагрузки
# Использование: ./load-test-advanced.sh [HOST] [PORT]

# Настройки по умолчанию
HOST="${1:-localhost}"
PORT="${2:-8000}"
BASE_URL="http://${HOST}:${PORT}"

# Создаем директорию для результатов с временной меткой
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="load_test_results_${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Нагрузочное тестирование API${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Хост: $BASE_URL"
echo "Результаты будут сохранены в: $RESULTS_DIR"
echo ""

# Функция для запуска теста
run_test() {
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
    
    # Запускаем тест
    ab -n $requests \
       -c $concurrency \
       -g "$tsv_file" \
       -q \
       "$BASE_URL$endpoint" > "$output_file" 2>&1
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Тест завершен успешно${NC}"
        
        # Извлекаем ключевые метрики
        local rps=$(grep "Requests per second" "$output_file" | awk '{print $4}')
        local failed=$(grep "Failed requests" "$output_file" | awk '{print $3}')
        local mean_time=$(grep "Time per request" "$output_file" | head -1 | awk '{print $4}')
        local max_time=$(grep -A 10 "Connection Times" "$output_file" | grep "Total" | awk '{print $NF}')
        
        echo "   Requests per second: $rps"
        echo "   Неудачных запросов: $failed"
        echo "   Среднее время ответа: ${mean_time} ms"
        echo "   Максимальное время ответа: ${max_time} ms"
    else
        echo -e "${RED}❌ Ошибка при выполнении теста${NC}"
    fi
    
    echo ""
    sleep 2  # Небольшая пауза между тестами
}

# Функция для проверки доступности сервера
check_server() {
    echo "Проверка доступности сервера..."
    if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users" | grep -q "200\|404\|401"; then
        echo -e "${GREEN}✅ Сервер доступен${NC}"
        return 0
    else
        echo -e "${RED}❌ Сервер недоступен по адресу $BASE_URL${NC}"
        echo "Убедитесь, что сервер запущен и доступен"
        return 1
    fi
    echo ""
}

# Проверяем доступность сервера
if ! check_server; then
    exit 1
fi

echo ""
echo -e "${BLUE}Начинаем тестирование...${NC}"
echo ""

# ========================================
# ТЕСТЫ С РАЗНЫМИ УРОВНЯМИ НАГРУЗКИ
# ========================================

# Тест 1: Низкая нагрузка (базовая проверка)
run_test "/users" \
         "test1_low_load" \
         100 \
         10 \
         "Низкая нагрузка - базовая проверка работоспособности"

# Тест 2: Средняя нагрузка
run_test "/users" \
         "test2_medium_load" \
         500 \
         50 \
         "Средняя нагрузка - типичная рабочая нагрузка"

# Тест 3: Высокая нагрузка
run_test "/users" \
         "test3_high_load" \
         1000 \
         100 \
         "Высокая нагрузка - пиковая нагрузка"

# Тест 4: Очень высокая нагрузка
run_test "/users" \
         "test4_very_high_load" \
         2000 \
         200 \
         "Очень высокая нагрузка - стресс-тест"

# Тест 5: Экстремальная нагрузка
run_test "/users" \
         "test5_extreme_load" \
         5000 \
         500 \
         "Экстремальная нагрузка - максимальный стресс-тест"

# ========================================
# ТЕСТЫ РАЗНЫХ ЭНДПОИНТОВ
# ========================================

echo -e "${BLUE}Тестирование разных эндпоинтов...${NC}"
echo ""

# Тест различных эндпоинтов со средней нагрузкой
run_test "/applications" \
         "test_applications" \
         500 \
         50 \
         "Тест эндпоинта /applications"

run_test "/tournaments" \
         "test_tournaments" \
         500 \
         50 \
         "Тест эндпоинта /tournaments"

run_test "/players" \
         "test_players" \
         500 \
         50 \
         "Тест эндпоинта /players"

# ========================================
# ДЛИТЕЛЬНЫЙ ТЕСТ НА СТАБИЛЬНОСТЬ
# ========================================

echo -e "${BLUE}Длительный тест на стабильность (60 секунд)...${NC}"
echo ""

run_test "/users" \
         "test_stability" \
         10000 \
         100 \
         "Длительный тест на стабильность"

# ========================================
# ФОРМИРОВАНИЕ ОТЧЕТА
# ========================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Формирование сводного отчета${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

SUMMARY_FILE="$RESULTS_DIR/SUMMARY.txt"

cat > "$SUMMARY_FILE" << EOF
========================================
  СВОДНЫЙ ОТЧЕТ НАГРУЗОЧНОГО ТЕСТИРОВАНИЯ
========================================

Дата и время: $(date)
Тестируемый сервер: $BASE_URL
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
        
        # Извлекаем ключевые метрики
        grep "Requests per second" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Failed requests" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Complete requests" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        grep "Time per request" "$result_file" | head -1 >> "$SUMMARY_FILE" 2>/dev/null
        grep "Total transferred" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
        
        # Добавляем информацию о времени ответа
        echo "" >> "$SUMMARY_FILE"
        echo "Connection Times:" >> "$SUMMARY_FILE"
        grep -A 5 "Connection Times" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
    fi
done

cat >> "$SUMMARY_FILE" << EOF

========================================
РЕКОМЕНДАЦИИ
========================================

1. Проверьте процент неудачных запросов (должен быть 0)
2. Оцените Requests per second - это пропускная способность
3. Время ответа должно быть стабильным при всех нагрузках
4. При высокой нагрузке проверьте логи приложения на ошибки
5. Мониторьте использование CPU и памяти во время тестов

Для детального анализа откройте отдельные файлы результатов.
Для построения графиков используйте TSV файлы.

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
echo "Для просмотра логов приложения:"
echo "  tail -f logs/app.log"
echo "  tail -f logs/errors.log"
echo ""

