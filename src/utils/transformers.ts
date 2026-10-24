// Скорость 23.10: ответ с 5000 бронями — ~200 тыс. ключей, и для каждого
// заново гонялся regex. Названий полей всего несколько сотен — запоминаем
// перевод. Результат тот же, что и раньше.
const camelKeys = new Map<string, string>();
const snakeKeys = new Map<string, string>();

const camelKey = (key: string): string => {
    let k = camelKeys.get(key);
    if (k === undefined) {
        k = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        if (camelKeys.size > 5000) camelKeys.clear();  // ключами бывают даты/id — не копим бесконечно
        camelKeys.set(key, k);
    }
    return k;
};

const snakeKey = (key: string): string => {
    let k = snakeKeys.get(key);
    if (k === undefined) {
        k = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        if (snakeKeys.size > 5000) snakeKeys.clear();
        snakeKeys.set(key, k);
    }
    return k;
};

export const toCamelCase = (obj: any): any => {
    if (obj === null || typeof obj === 'undefined') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => toCamelCase(v));
    } else if (typeof obj === 'object' && obj.constructor === Object) {
        const result: any = {};
        for (const key of Object.keys(obj)) {
            result[camelKey(key)] = toCamelCase(obj[key]);
        }
        return result;
    }
    return obj;
};

export const toSnakeCase = (obj: any): any => {
    if (obj === null || typeof obj === 'undefined') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => toSnakeCase(v));
    } else if (typeof obj === 'object' && obj.constructor === Object) {
        const result: any = {};
        for (const key of Object.keys(obj)) {
            result[snakeKey(key)] = toSnakeCase(obj[key]);
        }
        return result;
    }
    return obj;
};
