import React from 'react';
import { GH, GH_MONO, GH_SANS } from '../hooks/useDesignFlag';
import { useInMobileShell } from '../utils/catalogPath';

/**
 * StructuredText — единый рендер «простого текста с разметкой» для анкет
 * специалистов, новостей и статей.
 *
 * Разметка (намеренно минимальная, без markdown-библиотек):
 *   ## Заголовок      → mono-капс подзаголовок секции
 *   _одинокая строка_ → курсивная подпись (если в блоке только она)
 *   - пункт           → маркированный список
 *   **жирный**        → inline bold
 *   _курсив_          → inline italic
 *   \n                → переносы сохраняются (pre-wrap внутри абзацев)
 *
 * Owner 2026-06-13: вынесено из SpecialistProfilePage.renderStructuredBio
 * и расширено (inline bold/italic, списки) для контент-блока. Обратная
 * совместимость: текст без `## ` рендерится одним блоком.
 */

/** Inline-разметка: **bold** и _italic_ → React-узлы. */
function renderInline(text: string): React.ReactNode[] {
    // Разбиваем по **...** и _..._; чередуем обычный/жирный/курсив.
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = regex.exec(text)) !== null) {
        if (m.index > last) parts.push(text.slice(last, m.index));
        const token = m[0];
        if (token.startsWith('**')) {
            parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
        } else {
            parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
        }
        last = m.index + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

/** Тело блока: абзацы + маркированные списки (строки на `- `). */
function renderBody(body: string): React.ReactNode {
    const lines = body.split('\n');
    const out: React.ReactNode[] = [];
    let listBuffer: string[] = [];
    let key = 0;

    const flushList = () => {
        if (listBuffer.length === 0) return;
        out.push(
            <ul key={`ul-${key++}`} style={{ margin: '6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {listBuffer.map((item, i) => (
                    <li key={i} style={{ lineHeight: 1.55 }}>{renderInline(item)}</li>
                ))}
            </ul>
        );
        listBuffer = [];
    };

    let paragraph: string[] = [];
    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        out.push(
            <div key={`p-${key++}`} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {renderInline(paragraph.join('\n'))}
            </div>
        );
        paragraph = [];
    };

    for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('- ')) {
            flushParagraph();
            listBuffer.push(trimmed.slice(2));
        } else if (trimmed === '') {
            flushParagraph();
            flushList();
        } else {
            flushList();
            paragraph.push(line);
        }
    }
    flushParagraph();
    flushList();
    return <>{out}</>;
}

export function StructuredText({ text }: { text: string }) {
    // 09.11 фаза 3 (общие файлы): внутри /m подзаголовок «ОБО МНЕ» — Sans 12/600 капсом
    // (как подписи разделов /m), а не Mono в разрядку. На компьютере — прежний Grid House.
    const skin = useInMobileShell();
    if (!text) return null;

    // Без секций — один блок (обратная совместимость с legacy-био).
    if (!text.includes('## ')) {
        return <div>{renderBody(text)}</div>;
    }

    const blocks = text.split(/\n*##\s+/).map(b => b.trim()).filter(Boolean);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {blocks.map((block, idx) => {
                const nl = block.indexOf('\n');
                if (nl === -1) {
                    // Только заголовок без тела — курсивная подпись («_В профессии с 2019_»).
                    const t = block.replace(/^_+|_+$/g, '');
                    return (
                        <div key={idx} style={{ fontStyle: 'italic', fontSize: 14, color: GH.ink60 }}>
                            {t}
                        </div>
                    );
                }
                const heading = block.slice(0, nl).trim();
                const body = block.slice(nl + 1).trim();
                return (
                    <div key={idx}>
                        <div style={{
                            fontFamily: skin ? GH_SANS : GH_MONO, fontSize: 12, fontWeight: skin ? 600 : undefined,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: GH.ink60, marginBottom: 6,
                        }}>
                            {heading}
                        </div>
                        {renderBody(body)}
                    </div>
                );
            })}
        </div>
    );
}
