#!/bin/bash

# Скрипт для анализа результатов нагрузочного тестирования
# Использование: ./analyze-results.sh [директория_с_результатами]

if [ -z "$1" ]; then
    # Ищем последнюю директорию с результатами
    LATEST_DIR=$(ls -td load_test_results_* 2>/dev/null | head -1)
    if [ -z "$LATEST_DIR" ]; then
        echo "Ошибка: не найдена директория с результатами"
        echo "Использование: $0 <директория_с_результатами>"
        exit 1
    fi
    RESULTS_DIR="$LATEST_DIR"
    echo "Используется последняя директория: $RESULTS_DIR"
else
    RESULTS_DIR="$1"
fi

if [ ! -d "$RESULTS_DIR" ]; then
    echo "Ошибка: директория $RESULTS_DIR не найдена"
    exit 1
fi

echo "=========================================="
echo "  Анализ результатов нагрузочного тестирования"
echo "=========================================="
echo ""
echo "Директория: $RESULTS_DIR"
echo ""

# Цвета
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Функция для анализа одного файла
analyze_file() {
    local file=$1
    local name=$(basename "$file" .txt)
    
    echo -e "${BLUE}--- $name ---${NC}"
    
    if [ ! -f "$file" ]; then
        echo -e "${RED}Файл не найден${NC}"
        return
    fi
    
    # Извлекаем метрики
    local rps=$(grep "Requests per second" "$file" 2>/dev/null | awk '{print $4}')
    local failed=$(grep "Failed requests" "$file" 2>/dev/null | awk '{print $3}')
    local total=$(grep "Complete requests" "$file" 2>/dev/null | awk '{print $3}')
    local mean_time=$(grep "Time per request" "$file" 2>/dev/null | head -1 | awk '{print $4}')
    local max_time=$(grep -A 10 "Connection Times" "$file" 2>/dev/null | grep "Total" | awk '{print $NF}')
    
    # Выводим метрики
    if [ -n "$rps" ]; then
        echo -e "  ${GREEN}✅ Requests per second:${NC} $rps"
        
        # Оценка производительности
        rps_num=$(echo $rps | sed 's/[^0-9.]//g')
        if command -v bc >/dev/null 2>&1; then
            if (( $(echo "$rps_num > 1000" | bc -l 2>/dev/null) )); then
                echo -e "     ${GREEN}Отличная производительность (>1000 RPS)${NC}"
            elif (( $(echo "$rps_num > 100" | bc -l 2>/dev/null) )); then
                echo -e "     ${YELLOW}Хорошая производительность (100-1000 RPS)${NC}"
            else
                echo -e "     ${RED}Низкая производительность (<100 RPS)${NC}"
            fi
        fi
    fi
    
    if [ -n "$failed" ] && [ -n "$total" ]; then
        if [ "$failed" = "0" ]; then
            echo -e "  ${GREEN}✅ Процент успешных запросов: 100%${NC}"
        else
            if command -v bc >/dev/null 2>&1; then
                success_rate=$(echo "scale=2; ($total - $failed) * 100 / $total" | bc 2>/dev/null)
                echo -e "  ${RED}⚠️  Процент успешных запросов: ${success_rate}%${NC}"
                echo -e "     Неудачных запросов: $failed из $total"
            else
                echo -e "  ${RED}⚠️  Неудачных запросов: $failed из $total${NC}"
            fi
        fi
    fi
    
    if [ -n "$mean_time" ]; then
        echo -e "  ${GREEN}✅ Среднее время ответа:${NC} ${mean_time} ms"
        
        # Оценка времени ответа
        mean_num=$(echo $mean_time | sed 's/[^0-9.]//g')
        if command -v bc >/dev/null 2>&1; then
            if (( $(echo "$mean_num < 100" | bc -l 2>/dev/null) )); then
                echo -e "     ${GREEN}Отличное время ответа (<100ms)${NC}"
            elif (( $(echo "$mean_num < 500" | bc -l 2>/dev/null) )); then
                echo -e "     ${YELLOW}Хорошее время ответа (100-500ms)${NC}"
            else
                echo -e "     ${RED}Медленное время ответа (>500ms)${NC}"
            fi
        fi
    fi
    
    if [ -n "$max_time" ]; then
        echo -e "  ${GREEN}✅ Максимальное время ответа:${NC} ${max_time} ms"
    fi
    
    echo ""
}

# Анализируем все файлы результатов
echo -e "${YELLOW}Анализ результатов тестов:${NC}"
echo ""

for result_file in "$RESULTS_DIR"/test*.txt; do
    if [ -f "$result_file" ]; then
        analyze_file "$result_file"
    fi
done

# Проверяем наличие TSV файлов для графиков
tsv_count=$(ls -1 "$RESULTS_DIR"/*.tsv 2>/dev/null | wc -l)
if [ "$tsv_count" -gt 0 ]; then
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Дополнительная информация${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Найдено $tsv_count TSV файлов для построения графиков"
    echo "Используйте их для визуализации результатов"
    echo ""
fi

# Рекомендации
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Рекомендации${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "1. Проверьте логи приложения на наличие ошибок:"
echo "   tail -f logs/app.log"
echo "   tail -f logs/errors.log"
echo ""
echo "2. Мониторьте ресурсы сервера во время тестов:"
echo "   - CPU использование"
echo "   - Память (RAM)"
echo "   - Сетевая активность"
echo ""
echo "3. Обратите внимание на:"
echo "   - Процент неудачных запросов (должен быть 0)"
echo "   - Стабильность времени ответа при разных нагрузках"
echo "   - Пропускную способность (Requests per second)"
echo ""
echo "4. Для построения графиков используйте TSV файлы:"
echo "   - Можно импортировать в Excel"
echo "   - Или использовать Python с matplotlib"
echo ""

