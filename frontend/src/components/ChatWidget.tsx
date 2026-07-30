import { useState, useRef, useEffect, FormEvent } from 'react';
import { ChatMessage } from '@/types';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { uid } from '@/context/HRContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const getSessionId = (): string => {
  const existing = localStorage.getItem('luminahr_chat_session');
  if (existing) return existing;
  const id = uid();
  localStorage.setItem('luminahr_chat_session', id);
  return id;
};

export default function ChatWidget(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: "Bonjour ! Je suis Lumina, votre assistante RH. Posez-moi vos questions sur les horaires, la paie, les congés ou toute autre question RH." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text };
    const assistantId = uid();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), message: text }),
      });
      if (!res.ok || !res.body) throw new Error('Erreur réseau');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') { done = true; break; }
          const parsed = JSON.parse(payload) as { delta?: string };
          if (parsed.delta) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + parsed.delta } : m))
            );
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Désolée, je n'arrive pas à répondre pour le moment. Veuillez réessayer." }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {open && (
        <div
          data-testid="chat-widget-panel"
          className="fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-3rem)] h-[480px] rounded-2xl backdrop-blur-xl bg-white/90 border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 bg-slate-900">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white font-heading">Lumina — Assistante IA</p>
              <p className="text-xs text-slate-400">Spécialiste RH pharmacie</p>
            </div>
            <button data-testid="chat-close-button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="chat-messages-list">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  {m.content || '…'}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={send} className="p-3 border-t border-slate-200 flex gap-2">
            <input
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Écrivez votre question…"
              className="flex-1 px-4 py-2.5 rounded-full bg-slate-100 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              data-testid="chat-send-button"
              type="submit"
              disabled={loading}
              className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
      <button
        data-testid="chat-widget-toggle"
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xl hover:bg-emerald-700 hover:scale-105 transition-transform"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </>
  );
}
