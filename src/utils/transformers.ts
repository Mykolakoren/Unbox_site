
export const toCamelCase = (obj: any): any => {
    if (obj === null || typeof obj === 'undefined') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => toCamelCase(v));
    } else if (typeof obj === 'object' && obj.constructor === Object) {
        return Object.keys(obj).reduce(
            (result, key) => {
                const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
                result[camelKey] = toCamelCase(obj[key]);
                return result;
            },
            {} as any
        );
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
        return Object.keys(obj).reduce(
            (result, key) => {
                const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                result[snakeKey] = toSnakeCase(obj[key]);
                return result;
            },
            {} as any
        );
    }
    return obj;
};
