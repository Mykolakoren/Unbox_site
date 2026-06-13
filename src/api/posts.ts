import { api } from './client';

/**
 * Posts API — новости/анонсы и статьи специалистов.
 * client.ts автоматически конвертит snake↔camel в обе стороны,
 * поэтому здесь всё в camelCase.
 */

export type PostType = 'news' | 'article';

export interface Post {
    id: string;
    type: PostType;
    title: string;
    slug: string;
    excerpt: string;
    body: string;
    coverImageUrl?: string | null;
    authorSpecialistId?: string | null;
    isPublished: boolean;
    publishedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    // enriched на чтении (для article)
    authorName?: string | null;
    authorPhotoUrl?: string | null;
}

export interface PostCreate {
    type: PostType;
    title: string;
    slug?: string;
    excerpt?: string;
    body?: string;
    coverImageUrl?: string | null;
    authorSpecialistId?: string | null;
    isPublished?: boolean;
}

export type PostUpdate = Partial<PostCreate>;

export const postsApi = {
    /** Публичная лента (только опубликованные). */
    list: async (type?: PostType, limit = 50, offset = 0): Promise<Post[]> => {
        const { data } = await api.get('/posts/', { params: { type, limit, offset } });
        return data;
    },

    /** Публичный пост по slug. */
    getBySlug: async (slug: string): Promise<Post> => {
        const { data } = await api.get(`/posts/${slug}`);
        return data;
    },

    /** Админ: все посты включая черновики. */
    listAdmin: async (type?: PostType): Promise<Post[]> => {
        const { data } = await api.get('/posts/admin', { params: { type } });
        return data;
    },

    create: async (payload: PostCreate): Promise<Post> => {
        const { data } = await api.post('/posts/admin', payload);
        return data;
    },

    update: async (id: string, payload: PostUpdate): Promise<Post> => {
        const { data } = await api.patch(`/posts/admin/${id}`, payload);
        return data;
    },

    remove: async (id: string): Promise<void> => {
        await api.delete(`/posts/admin/${id}`);
    },
};
