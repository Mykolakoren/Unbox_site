import { useEffect, useState } from 'react';
import { postsApi, type PostType } from '../../api/posts';

/**
 * Есть ли опубликованные новости и статьи (волна 2, G1-20).
 *
 * Пункты «Новости» и «Статьи» раньше были зашиты в шапку лендинга и ленты
 * и вели в пустые разделы. Теперь их показывают, только если в разделе есть
 * хоть одна публикация. Пока ответа нет или запрос упал — пункт скрыт:
 * лучше без ссылки, чем ссылка в пустоту.
 *
 * Запрос — один на вкладку (limit=1 по каждому типу), ответ кэшируется.
 */
export type PostsAvailability = Record<PostType, boolean>;

const NONE: PostsAvailability = { news: false, article: false };

let cached: PostsAvailability | null = null;
let inFlight: Promise<PostsAvailability> | null = null;

function load(): Promise<PostsAvailability> {
    if (cached) return Promise.resolve(cached);
    if (!inFlight) {
        const has = (type: PostType) => postsApi.list(type, 1).then(list => list.length > 0).catch(() => false);
        inFlight = Promise.all([has('news'), has('article')]).then(([news, article]) => {
            cached = { news, article };
            inFlight = null;
            return cached;
        });
    }
    return inFlight;
}

export function usePostsAvailability(): PostsAvailability {
    const [value, setValue] = useState<PostsAvailability>(() => cached ?? NONE);
    useEffect(() => {
        if (cached) return;
        let alive = true;
        load().then(v => { if (alive) setValue(v); });
        return () => { alive = false; };
    }, []);
    return value;
}
