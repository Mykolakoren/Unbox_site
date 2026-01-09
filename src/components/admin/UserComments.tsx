import { useState } from 'react';
import { MessageSquare, Send, User } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';

interface UserCommentsProps {
    email: string;
}

export function UserComments({ email }: UserCommentsProps) {
    const { users, addUserComment, currentUser } = useUserStore();
    const user = users.find(u => u.email === email);
    const [newComment, setNewComment] = useState('');

    if (!user) return null;

    const handleAddComment = () => {
        if (!newComment.trim()) return;
        addUserComment(email, newComment.trim(), currentUser?.name || 'Admin');
        setNewComment('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAddComment();
        }
    };

    const comments = user.commentHistory || [];

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col">
            <div className="flex items-center gap-2 mb-4 font-medium text-gray-800">
                <MessageSquare size={16} />
                Комментарии и Заметки
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[200px] max-h-[400px] pr-2">
                {/* Legacy Note Support */}
                {user.notes && (
                    <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-sm">
                        <div className="text-xs text-yellow-600 font-bold mb-1 uppercase">Старая заметка</div>
                        <div className="text-gray-700 whitespace-pre-wrap">{user.notes}</div>
                    </div>
                )}

                {comments.length === 0 && !user.notes && (
                    <div className="text-center text-gray-400 text-sm py-8">
                        Нет комментариев
                    </div>
                )}

                {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-3 group">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                            <User size={14} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-baseline justify-between mb-1">
                                <span className="text-sm font-bold text-gray-900">{comment.adminName}</span>
                                <span className="text-xs text-gray-400">
                                    {format(new Date(comment.date), 'd MMM HH:mm', { locale: ru })}
                                </span>
                            </div>
                            <div className="bg-gray-50 rounded-r-xl rounded-bl-xl p-3 text-sm text-gray-700 whitespace-pre-wrap border border-gray-100 group-hover:bg-gray-100 transition-colors">
                                {comment.text}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Input Area */}
            <div className="relative">
                <textarea
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-3 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all resize-none"
                    placeholder="Написать комментарий..."
                    rows={2}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                    className={clsx(
                        "absolute right-2 bottom-2 p-1.5 rounded-lg transition-colors",
                        newComment.trim()
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    )}
                >
                    <Send size={16} />
                </button>
            </div>
            <div className="text-[10px] text-gray-400 mt-1 pl-1">
                Enter для отправки, Shift+Enter для переноса
            </div>
        </div>
    );
}
